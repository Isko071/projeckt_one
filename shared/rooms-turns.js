// Онлайн-столы для игр без колоды и ставок («Ятзи»): та же схема, что в shared/rooms.js, но проще и без привязки к блэкджеку.
//   Комната лежит в Firestore (rooms/<код>), ведущий игры — браузер создателя (хост). Хост держит состояние, принимает действия игроков
//   (записи rooms/<код>/actions/*), прогоняет их через reduce игры и публикует состояние. Игроки раз в секунду читают комнату.
//   Если игрок не отвечает: через idleMs ему показывается вопрос «Вы ещё играете?» (askMs); «Да» начинает отсчёт заново. Вместе это 2 минуты:
//   без ответа игрок сразу сдаётся (выбывает из-за стола), ход за него никто не делает. Правила Firestore те же, что для блэкджека.
//
//   var rooms = PlatformTurnRooms.create({ fetch, getToken, uid, projectId, db, game, gameId, now, rng, options })
//   Начало игры: хост может начать, когда за столом 2 игрока и больше и прошло startDelayMs (20 с) после последнего входа или выхода (чтобы успели зайти остальные). Само игра не начинается.
//   rooms.createRoom({ size, name, avatar, mode }) → { code, host };  rooms.joinRoom(code, { name, avatar }) → игрок;  rooms.listRooms()
//   Контроллер: poll(), send(action), leave(), stop(), onChange(fn), getView(); у хоста ещё start(), tick(), close()
//   Игра (game): CONFIG { minSeats, maxSeats }, PLAYER_ACTIONS, init(seats, options, rng), reduce(state, action, rng), view(state),
//                waitingSeats(state), progressKey(state, seat). Состояние содержит gameOver.
(function (root) {
  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var DEFAULTS = { pollMs: 1000, heartbeatMs: 5000, staleMs: 30000, idleMs: 100000, askMs: 20000, startDelayMs: 20000, codeLength: 5 };

  function fail(code) { var e = new Error(code); e.code = code; return e; }

  function create(env) {
    var cfg = Object.assign({}, DEFAULTS, env.options || {});
    var now = env.now || function () { return Date.now(); };
    var rng = env.rng || Math.random;
    var game = env.game, gameId = env.gameId;
    var Chat = root.PlatformChat;   // чат стола (shared/chat-logic.js); без него чат просто выключен
    var base = 'https://firestore.googleapis.com/v1/projects/' + env.projectId + '/databases/' + env.db + '/documents';

    // ---------- Firestore (REST) ----------
    function encode(obj) {
      var f = {};
      Object.keys(obj).forEach(function (k) {
        var v = obj[k];
        if (typeof v === 'string') f[k] = { stringValue: v };
        else if (typeof v === 'boolean') f[k] = { booleanValue: v };
        else f[k] = { integerValue: String(Math.floor(v)) };
      });
      return { fields: f };
    }
    function decode(doc) {
      var out = {}, f = (doc && doc.fields) || {};
      Object.keys(f).forEach(function (k) {
        var v = f[k];
        out[k] = v.stringValue !== undefined ? v.stringValue : (v.integerValue !== undefined ? Number(v.integerValue) : v.booleanValue);
      });
      return out;
    }
    function req(method, url, body) {
      return env.getToken().then(function (token) {
        return env.fetch(url, { method: method, headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      });
    }
    function check(res) {
      if (res.status === 401 || res.status === 403) throw fail('denied');
      if (res.status === 409) throw fail('exists');
      if (!res.ok && res.status !== 404) throw fail('http-' + res.status);
      return res;
    }
    // Запись в несуществующую базу или комнату (404) нельзя считать успехом: иначе стол «создаётся», а на деле его нет
    function strict(res) { if (res.status === 404) throw fail('missing'); return check(res); }
    function getDoc(path) {
      return req('GET', base + '/' + path).then(check).then(function (res) { return res.status === 404 ? null : res.json().then(function (d) { return { data: decode(d), name: d.name }; }); });
    }
    function putDoc(path, obj, onlyIfNew) {
      return req('PATCH', base + '/' + path + (onlyIfNew ? '?currentDocument.exists=false' : ''), encode(obj)).then(strict);
    }
    function addDoc(collection, obj) { return req('POST', base + '/' + collection, encode(obj)).then(strict); }
    function listDocs(collection) {
      return req('GET', base + '/' + collection + '?pageSize=100').then(check).then(function (res) {
        return res.status === 404 ? [] : res.json().then(function (d) { return (d.documents || []).map(function (x) { return { name: x.name, data: decode(x) }; }); });
      });
    }
    function delDoc(name) { return req('DELETE', 'https://firestore.googleapis.com/v1/' + name).then(function (res) { if (res.status !== 404) check(res); }); }

    function makeCode() {
      var s = '';
      for (var i = 0; i < cfg.codeLength; i++) s += CODE_CHARS.charAt(Math.floor(rng() * CODE_CHARS.length));
      return s;
    }
    function emitter() {
      var listeners = [];
      return { on: function (fn) { listeners.push(fn); }, emit: function (x) { listeners.forEach(function (fn) { try { fn(x); } catch (e) { /* подписчик не должен ломать остальных */ } }); } };
    }
    function publicMember(m) { return { uid: m.uid, name: m.name, avatar: m.avatar, seat: m.seat }; }

    // ================= Хост =================
    function createRoom(opts) {
      opts = opts || {};
      var size = Math.max(game.CONFIG.minSeats, Math.min(game.CONFIG.maxSeats, Math.floor(opts.size) || game.CONFIG.minSeats));
      var mode = game.CONFIG.modes && game.CONFIG.modes.indexOf(opts.mode) >= 0 ? opts.mode : (game.CONFIG.modes ? game.CONFIG.modes[0] : '');
      var isPrivate = !!opts.private;      // закрытый стол: не показывается в списке, зайти можно только по коду или ссылке
      var code = null, rev = 1, status = 'lobby', full = null, lastBeat = 0, dirty = true, closed = false, lastTick = 0;
      var members = [{ uid: env.uid, name: String(opts.name || '').slice(0, 20), avatar: Number(opts.avatar) || 0, seat: 0 }];
      var chat = Chat ? Chat.createLog() : null, chatLimit = Chat ? Chat.createLimiter() : null;
      function sys(code, name) { if (chat) { chat.add({ kind: 'sys', code: code, name: String(name || ''), ts: now() }); dirty = true; } }
      function addChat(m, text, cid) {   // сообщение игрока: очистка, ограничение частоты, журнал последних 20
        if (!chat) return false;
        var t = Chat.clean(text);
        if (!t || !chatLimit.allow(m.uid, now())) return false;
        chat.add({ kind: 'msg', uid: m.uid, seat: m.seat, name: m.name, text: t, ts: now(), cid: String(cid || '').slice(0, 24) });
        dirty = true;
        return true;
      }
      var readyAt = 0;       // момент последнего входа или выхода, когда за столом уже 2 игрока и больше: от него идёт отсчёт до возможности начать
      var processed = {}, idle = {};     // idle[место] = { key, since, stage: 'idle' | 'asking', until }
      var em = emitter();

      function timersNow() {
        var t = now(), out = [];
        Object.keys(idle).forEach(function (seat) {
          var e = idle[seat];
          out.push({ seat: Number(seat), stage: e.stage, ms: Math.max(0, (e.stage === 'idle' ? e.since + cfg.idleMs : e.until) - t) });
        });
        return out;
      }
      function touchReady() { readyAt = members.length >= game.CONFIG.minSeats ? now() : 0; }
      function startIn() { return status === 'lobby' && readyAt ? Math.max(0, readyAt + cfg.startDelayMs - now()) : -1; }
      function fields() {
        var f = { hostUid: env.uid, game: gameId, status: status, size: size, players: members.length, hostName: members[0].name, mode: mode, private: isPrivate, rev: rev, heartbeat: now(), startIn: startIn(),
          meta: JSON.stringify({ v: 1, game: gameId, size: size, mode: mode, members: members.map(publicMember) }) };
        if (full) f.state = JSON.stringify(game.view(full));
        f.timers = JSON.stringify(timersNow());
        if (chat) f.chat = JSON.stringify(chat.list());
        return f;
      }
      function getView() {
        return { code: code, role: 'host', status: status, size: size, mode: mode, rev: rev, members: members.map(publicMember), state: full ? game.view(full) : null, timers: timersNow(), seat: 0, hostGone: false, closed: closed, startIn: startIn(), receivedAt: now(), chat: chat ? chat.list() : [], private: isPrivate };
      }
      function publish() {
        rev++; dirty = false; lastBeat = now();
        em.emit(getView());
        return putDoc('rooms/' + code, fields());
      }

      function canStart() { return status === 'lobby' && members.length >= game.CONFIG.minSeats && !!readyAt && now() - readyAt >= cfg.startDelayMs; }
      function start() {
        if (!canStart()) return Promise.resolve();
        full = game.init(members.map(function (m, i) { m.seat = i; return { id: m.uid, name: m.name }; }), { mode: mode, tableSize: size }, rng);
        status = 'playing'; dirty = true; sys('start', '');
        return publish();
      }
      // Новая игра за тем же столом: после конца партии хост возвращает стол в комнату ожидания с теми же игроками (вышедшие убираются)
      function rematch() {
        if (status !== 'playing' || !full || !full.gameOver) return Promise.resolve();
        var alive = {};
        full.players.forEach(function (p) { if (p.active) alive[p.id] = true; });
        members = members.filter(function (m) { return m.uid === env.uid || alive[m.uid]; });
        members.forEach(function (m, i) { m.seat = i; });
        full = null; status = 'lobby'; idle = {};
        readyAt = members.length >= game.CONFIG.minSeats ? now() - cfg.startDelayMs : 0;   // те же игроки: ждать 20 секунд не нужно
        sys('again', ''); dirty = true;
        return publish();
      }
      function apply(action) {
        var r = game.reduce(full, action, rng);
        if (!r.ok) return false;
        full = r.state; dirty = true;
        return true;
      }
      function clean(payload) {      // из действия игрока берём только известные поля; место определяет хост
        var out = { type: payload.type };
        if (typeof payload.index === 'number') out.index = payload.index;
        if (typeof payload.cat === 'string') out.cat = payload.cat.slice(0, 30);
        if (Array.isArray(payload.held)) out.held = payload.held.slice(0, 5).map(Boolean);
        return out;
      }

      function handle(a) {
        var uid = a.uid, payload;
        try { payload = JSON.parse(a.payload); } catch (e) { return; }
        if (!payload || typeof payload.type !== 'string' || uid === env.uid) return;
        var m = members.filter(function (x) { return x.uid === uid; })[0];
        if (payload.type === 'hello') {
          if (m || status !== 'lobby' || members.length >= size) return;
          members.push({ uid: uid, name: String(payload.name || '').slice(0, 20), avatar: Number(payload.avatar) || 0, seat: members.length });
          touchReady(); sys('join', String(payload.name || '').slice(0, 20)); dirty = true;
          return;
        }
        if (!m) return;
        if (payload.type === 'chat') { addChat(m, payload.text, payload.cid); return; }
        if (payload.type === 'leave') {
          sys('leave', m.name);
          if (status === 'lobby') { members = members.filter(function (x) { return x.uid !== uid; }); members.forEach(function (x, i) { x.seat = i; }); touchReady(); dirty = true; }
          else if (full) { apply({ type: 'leave', seat: m.seat }); }
          return;
        }
        if (payload.type === 'here') {                      // «Да, я играю»: отсчёт неактивности начинается заново
          var e0 = idle[m.seat];
          if (e0 && e0.stage === 'asking') { e0.stage = 'idle'; e0.since = lastTick; dirty = true; }
          return;
        }
        if (status !== 'playing' || game.PLAYER_ACTIONS.indexOf(payload.type) < 0) return;
        var act = clean(payload); act.seat = m.seat;
        apply(act);
      }

      // Таймеры неактивных: ждём idleMs, спрашиваем «Вы ещё играете?» (askMs); нет ответа — игрок сдаётся. Ходов за него хост не делает
      function auto(t) {
        if (status !== 'playing' || !full) return;
        var waiting = full.gameOver ? [] : game.waitingSeats(full), seen = {};
        waiting.forEach(function (seat) {
          seen[seat] = true;
          var key = game.progressKey(full, seat), e = idle[seat];
          if (!e || e.key !== key) { idle[seat] = { key: key, since: t, stage: 'idle', until: 0 }; dirty = true; return; }
          if (e.stage === 'idle' && t - e.since >= cfg.idleMs) { e.stage = 'asking'; e.until = t + cfg.askMs; dirty = true; return; }
          if (e.stage === 'asking' && t >= e.until) { delete idle[seat]; dirty = true; var gone = members.filter(function (x) { return x.seat === seat; })[0]; sys('out', gone && gone.name); apply({ type: 'leave', seat: seat }); }
        });
        Object.keys(idle).forEach(function (seat) { if (!seen[seat]) { delete idle[seat]; dirty = true; } });
      }

      // Один шаг ведущего: принять действия, прогнать таймеры, опубликовать при изменениях
      function tick(t) {
        if (closed) return Promise.resolve();
        t = t === undefined ? now() : t;
        lastTick = t;
        return listDocs('rooms/' + code + '/actions').then(function (docs) {
          docs.sort(function (a, b) { return (a.data.createdAt - b.data.createdAt) || (a.name < b.name ? -1 : 1); });
          docs.filter(function (d) { return !processed[d.name]; }).forEach(function (d) { processed[d.name] = true; handle(d.data); });
          auto(t);
          return Promise.all(docs.map(function (d) { return delDoc(d.name).catch(function () { /* повторим в следующий раз */ }); })).then(function () {
            if (dirty || t - lastBeat >= cfg.heartbeatMs) return publish();
          });
        });
      }
      function close() {
        closed = true; status = 'closed'; rev++;
        em.emit(getView());
        return putDoc('rooms/' + code, fields());
      }
      function dispatch(action) {            // действия самого хоста (место 0)
        if (action.type === 'chat') { var sent = addChat(members[0], action.text, action.cid); if (sent) em.emit(getView()); return sent; }
        if (action.type === 'leave') { close(); return true; }
        if (status !== 'playing' || game.PLAYER_ACTIONS.indexOf(action.type) < 0) return false;
        var ok = apply(Object.assign(clean(action), { seat: 0 }));
        if (ok) em.emit(getView());
        return ok;
      }

      var attempts = 0;
      function tryCreate() {
        code = makeCode();
        return putDoc('rooms/' + code, fields(), true).catch(function (e) {
          if (e.code === 'exists' && attempts++ < 5) return tryCreate();
          throw e;
        });
      }
      return tryCreate().then(function () {
        return { code: code, host: { code: code, role: 'host', start: start, rematch: rematch, tick: tick, close: close, send: dispatch, leave: close, getView: getView, onChange: em.on, publish: publish } };
      });
    }

    // ================= Игрок =================
    function joinRoom(code, hello) {
      code = String(code || '').toUpperCase().trim();
      var em = emitter(), lastRev = -1, view = null, stopped = false;
      function parseJson(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; } }
      function parse(d) {
        var m = parseJson(d.meta, { members: [] });
        var me = (m.members || []).filter(function (x) { return x.uid === env.uid; })[0];
        var timers = parseJson(d.timers, []);
        return { code: code, role: 'player', status: d.status, size: d.size, mode: d.mode || m.mode, rev: d.rev, members: m.members || [], state: parseJson(d.state, null), timers: Array.isArray(timers) ? timers : [], startIn: typeof d.startIn === 'number' ? d.startIn : -1,
          private: d.private === true, receivedAt: now(), chat: (function () { var c = parseJson(d.chat, []); return Array.isArray(c) ? c : []; })(), seat: me ? me.seat : null, joined: !!me, hostGone: false, closed: d.status === 'closed', heartbeat: d.heartbeat };
      }
      function poll() {
        if (stopped) return Promise.resolve(view);
        return getDoc('rooms/' + code).then(function (doc) {
          if (!doc) { view = Object.assign({}, view || {}, { code: code, closed: true, missing: true }); em.emit(view); return view; }
          var v = parse(doc.data);
          v.hostGone = v.status !== 'closed' && now() - doc.data.heartbeat > cfg.staleMs;
          if (doc.data.rev !== lastRev || (view && view.hostGone !== v.hostGone)) { lastRev = doc.data.rev; view = v; em.emit(v); }
          return view;
        });
      }
      function send(action) {
        return addDoc('rooms/' + code + '/actions', { uid: env.uid, createdAt: now(), payload: JSON.stringify(action) });
      }
      return getDoc('rooms/' + code).then(function (doc) {
        if (!doc) throw fail('not-found');
        if (doc.data.status === 'closed') throw fail('closed');
        if (doc.data.game !== gameId) throw fail('wrong-game');
        var v0 = parse(doc.data);
        if (!v0.joined && doc.data.status !== 'lobby') throw fail('started');
        if (!v0.joined && doc.data.players >= doc.data.size) throw fail('full');
        return (v0.joined ? Promise.resolve() : send({ type: 'hello', name: hello && hello.name, avatar: hello && hello.avatar })).then(function () {
          return { code: code, role: 'player', poll: poll, send: send, leave: function () { stopped = true; return send({ type: 'leave' }); }, stop: function () { stopped = true; }, onChange: em.on, getView: function () { return view; } };
        });
      });
    }

    // Открытые комнаты, которые ждут игроков
    function listRooms() {
      var body = { structuredQuery: { from: [{ collectionId: 'rooms' }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'lobby' } } }, limit: 30 } };
      return req('POST', base + ':runQuery', body).then(strict).then(function (res) { return res.json(); }).then(function (rows) {
        return rows.filter(function (r) { return r.document; }).map(function (r) {
          var d = decode(r.document), name = r.document.name;
          return { code: name.split('/').pop(), game: d.game, size: d.size, players: d.players, hostName: d.hostName || '', mode: d.mode || '', private: d.private === true, stale: now() - d.heartbeat > cfg.staleMs };
        }).filter(function (x) { return x.game === gameId && !x.private && !x.stale && x.players < x.size; });
      });
    }

    return { createRoom: createRoom, joinRoom: joinRoom, listRooms: listRooms, CONFIG: cfg };
  }

  root.PlatformTurnRooms = { create: create, DEFAULTS: DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
