// Онлайн-столы через сервер игр (WebSocket). Тот же интерфейс, что у PlatformRooms / PlatformTurnRooms (shared/rooms.js, rooms-turns.js):
// createRoom / joinRoom / listRooms и контроллер стола. Сервер сам ведёт стол, поэтому создатель — обычный игрок (role 'player', server: true),
// а «кто создатель» берётся из вида стола (view.owner); создатель может начать игру (start) и запустить новую (rematch).
// Чтобы не дублировать разбор документа комнаты, внутри используется тот же клиентский контроллер игрока: ему вместо Firestore подсовывается
// «поддельный fetch», который отдаёт последний документ комнаты, присланный сервером, а действия игрока отправляет по сокету.
//
// create({ url, WebSocket?, getToken, uid, engine, engineEnv?, game }):
//   engine — PlatformRooms или PlatformTurnRooms; engineEnv — доп. поля для его create (game, gameOptions, gameId);
//   game — 'blackjack' | 'yahtzee' (что показывать в списке и создавать).
// api.onStatus(fn) — состояние связи: 'connecting' | 'open' | 'down' (для плашки «Сервер просыпается…»).
(function (root) {
  var CALL_MS = 20000;

  function fail(code) { var e = new Error(code); e.code = code; return e; }

  function encodeDoc(doc, name) {
    var f = {};
    Object.keys(doc).forEach(function (k) {
      var v = doc[k];
      if (typeof v === 'string') f[k] = { stringValue: v };
      else if (typeof v === 'boolean') f[k] = { booleanValue: v };
      else f[k] = { integerValue: String(Math.floor(Number(v) || 0)) };
    });
    return { name: name, fields: f };
  }

  function create(env) {
    var WS = env.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    var uid = env.uid;
    var now = env.now || function () { return Date.now(); };
    var docs = {};                     // код → { doc, at } последний документ комнаты от сервера
    var waiters = [];                  // ожидание нужного документа
    var rooms = {};                    // код → { ctrl-часть: poll, stopped, hello }
    var pend = {}, seq = 0, ws = null, ready = null, state = 'down', retry = 0, retryTimer = null, statusFns = [], closedByUs = false;

    function setState(s) { if (state === s) return; state = s; statusFns.forEach(function (fn) { try { fn(s); } catch (e) { /* подписчик не должен ломать связь */ } }); }
    function active() { return Object.keys(rooms).some(function (c) { return !rooms[c].stopped; }); }

    // ---------- Соединение ----------
    function connect() {
      if (ready) return ready;
      if (!WS) return Promise.reject(fail('no-websocket'));
      setState('connecting');
      ready = new Promise(function (resolve, reject) {
        var done = false;
        env.getToken().then(function (token) {
          var sock;
          try { sock = new WS(env.url); } catch (e) { reject(fail('offline')); return; }
          ws = sock;
          sock.onopen = function () { sock.send(JSON.stringify({ t: 'auth', token: token })); };
          sock.onmessage = function (ev) {
            var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
            if (m.t === 'ready') { done = true; retry = 0; setState('open'); resolve(sock); resubscribe(); }
            else if (m.t === 'denied') { done = true; closedByUs = true; reject(fail('denied')); }
            else if (m.t === 'doc') gotDoc(m.code, m.doc);
            else if (m.t === 'gone') goneRoom(m.code);
            else if (m.id && pend[m.id]) { var p = pend[m.id]; delete pend[m.id]; clearTimeout(p.timer); if (m.ok) p.res(m); else p.rej(fail(m.error || 'error')); }
          };
          sock.onclose = function () {
            if (ws === sock) { ws = null; ready = null; }
            Object.keys(pend).forEach(function (id) { var p = pend[id]; delete pend[id]; clearTimeout(p.timer); p.rej(fail('offline')); });
            if (!done) reject(fail('offline'));
            if (closedByUs) { closedByUs = false; setState('down'); return; }
            setState('down');
            if (active()) scheduleRetry();
          };
          sock.onerror = function () { /* закрытие обработает onclose */ };
        }, function () { ready = null; setState('down'); reject(fail('denied')); });
      });
      ready.catch(function () { ready = null; });
      return ready;
    }
    function scheduleRetry() {
      if (retryTimer) return;
      var wait = Math.min(10000, 1000 * Math.pow(2, retry++));
      retryTimer = setTimeout(function () { retryTimer = null; if (active()) connect().catch(function () { if (active()) scheduleRetry(); }); }, wait);
    }
    // После обрыва заново заходим за свои столы: сервер держит место, пока не истёк срок ожидания
    function resubscribe() {
      Object.keys(rooms).forEach(function (code) {
        if (rooms[code].stopped) return;
        call({ t: 'join', game: env.game, code: code, hello: rooms[code].hello }).catch(function (e) {
          if (e && (e.code === 'not-found' || e.code === 'closed')) goneRoom(code);
        });
      });
    }
    function call(msg) {
      return connect().then(function (sock) {
        return new Promise(function (res, rej) {
          var id = ++seq;
          pend[id] = { res: res, rej: rej, timer: setTimeout(function () { delete pend[id]; rej(fail('timeout')); }, CALL_MS) };
          try { sock.send(JSON.stringify(Object.assign({ id: id }, msg))); } catch (e) { delete pend[id]; rej(fail('offline')); }
        });
      });
    }
    // Быстрая отправка без ответа (закрытие вкладки)
    function fire(msg) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); } catch (e) { /* страница закрывается */ } }

    // ---------- Документы ----------
    function gotDoc(code, doc) {
      docs[code] = { doc: doc, at: now() };
      var r = rooms[code];
      if (r && !r.stopped && r.poll) r.poll().catch(function () { /* следующий опрос повторит */ });
      waiters = waiters.filter(function (w) { if (w.code === code && w.test(doc)) { w.done(doc); return false; } return true; });
    }
    function goneRoom(code) {
      var d = docs[code];
      if (d) docs[code] = { doc: Object.assign({}, d.doc, { status: 'closed', rev: (Number(d.doc.rev) || 0) + 1 }), at: now() };
      else docs[code] = { doc: { status: 'closed', rev: 1, game: env.game, meta: '{}', heartbeat: now() }, at: now() };
      var r = rooms[code];
      if (r && !r.stopped && r.poll) r.poll().catch(function () { /* ничего */ });
    }
    function waitDoc(code, test, ms) {
      var cur = docs[code];
      if (cur && test(cur.doc)) return Promise.resolve(cur.doc);
      return new Promise(function (res, rej) {
        var w = { code: code, test: test, done: function (d) { clearTimeout(t); res(d); } };
        var t = setTimeout(function () { waiters = waiters.filter(function (x) { return x !== w; }); rej(fail('timeout')); }, ms || 8000);
        waiters.push(w);
      });
    }
    function isMember(doc) { try { return JSON.parse(doc.meta).members.some(function (m) { return m.uid === uid; }); } catch (e) { return false; } }

    // ---------- «Поддельный Firestore» для внутреннего контроллера ----------
    function fakeFetch(url, init) {
      var method = (init && init.method) || 'GET';
      var rel = url.split('/documents/')[1] || '';
      var parts = rel.split('?')[0].split('/').filter(Boolean);
      var res = function (status, body) { return Promise.resolve({ ok: status < 300, status: status, json: function () { return Promise.resolve(body || {}); } }); };
      if (parts[0] !== 'rooms') return res(404);
      var code = parts[1];
      if (parts.length === 2 && method === 'GET') {
        var d = docs[code];
        if (!d) return res(404);
        // сервер и браузер живут по разным часам: «свежесть» считаем по времени получения документа
        return res(200, encodeDoc(Object.assign({}, d.doc, { heartbeat: d.at }), 'projects/p/databases/d/documents/rooms/' + code));
      }
      if (parts[2] === 'actions' && method === 'POST') {
        var payload;
        try { payload = JSON.parse(JSON.parse(init.body).fields.payload.stringValue); } catch (e) { return res(400); }
        if (payload.type === 'hello') return res(200);        // вход уже сделан отдельным запросом join
        return call({ t: 'act', code: code, action: payload }).then(function () { return res(200); }, function (e) { return res(e && e.code === 'not-member' ? 403 : 500); });
      }
      return res(404);
    }
    var inner = env.engine.create(Object.assign({ fetch: fakeFetch, getToken: function () { return Promise.resolve('server'); }, uid: uid, projectId: 'p', db: 'd', now: now }, env.engineEnv || {}));

    function act(code, action) { return call({ t: 'act', code: code, action: action }); }

    function wrap(code, hello, ctrl) {
      var r = rooms[code] = { stopped: false, hello: hello, poll: ctrl.poll };
      function stopLocal() { r.stopped = true; ctrl.stop(); }
      return Object.assign({}, ctrl, {
        server: true,
        stop: stopLocal,
        leave: function () { stopLocal(); delete rooms[code]; fire({ t: 'leave', code: code }); return Promise.resolve(); },
        close: function () { return this.leave(); },
        start: function () { return act(code, { type: 'start' }); },
        rematch: function () { return act(code, { type: 'rematch' }); },
        tick: function () { return Promise.resolve(); },
        send: function (action) { return ctrl.send(action); }
      });
    }

    // ---------- Интерфейс, как у Firestore-версии ----------
    function enter(code, hello) {
      return waitDoc(code, isMember, 8000).then(function () { return inner.joinRoom(code, hello); }).then(function (ctrl) {
        var c = wrap(code, hello, ctrl);
        return ctrl.poll().then(function () { return c; }, function () { return c; });
      });
    }
    function joinRoom(code, hello) {
      code = String(code || '').toUpperCase().trim();
      return call({ t: 'join', game: env.game, code: code, hello: hello }).then(function () { return enter(code, hello); });
    }
    function createRoom(opts) {
      opts = opts || {};
      var hello = { name: opts.name, avatar: opts.avatar, chips: opts.chips };
      return call({ t: 'create', game: env.game, opts: opts }).then(function (r) { return enter(r.code, hello).then(function (c) { return { code: r.code, host: c }; }); });
    }
    function listRooms() { return call({ t: 'list', game: env.game }).then(function (r) { return r.rooms || []; }); }

    return {
      createRoom: createRoom, joinRoom: joinRoom, listRooms: listRooms,
      onStatus: function (fn) { statusFns.push(fn); },
      status: function () { return state; },
      connect: connect,
      shutdown: function () { closedByUs = true; if (retryTimer) clearTimeout(retryTimer); try { ws && ws.close(); } catch (e) { /* уже закрыт */ } }
    };
  }

  root.PlatformRoomsWS = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
