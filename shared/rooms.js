// Онлайн-столы без своего сервера: комната лежит в Firestore, ведущий игры — браузер создателя комнаты.
//   Создатель (хост) держит полное состояние игры (в том числе колоду и закрытую карту), принимает действия игроков,
//   прогоняет их через reduce игры и публикует в комнату только «вид стола» (view): без колоды и закрытой карты.
//   Остальные игроки раз в секунду читают комнату и шлют свои действия отдельными записями. Ведущий сам ходит за ботов,
//   раздаёт, переходит к следующей раздаче и по таймеру делает «стоп» или пропуск за молчащих игроков.
//   Честность держится на хосте: он видит колоду. Для игр на виртуальные аконы это приемлемо; для настоящего соревнования
//   игру нужно перенести на сервер (см. docs/multiplayer.md).
//
//   var rooms = PlatformRooms.create({ fetch, getToken, uid, projectId, db, game, now, rng, options })
//   rooms.createRoom({ size, fillBots, name, avatar, chips }) → хост: { code, host }
//   rooms.joinRoom(code, { name, avatar, chips })              → игрок
//   rooms.listRooms()                                          → открытые комнаты в ожидании: [{ code, size, players, hostName, bots }]
//   Контроллер (host или игрок): poll(), send(action), leave(), onChange(fn), getView(); у хоста ещё start(), tick(), close()
//   Игра (game): init(seats, options, rng), reduce(state, action, rng), view(state), readyToDeal, nextBotAction (с генератором случайных чисел), makeBot, waitingSeats.
(function (root) {
  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  // Таймеры молчащего игрока: idleMs (30 с) на ход или ставку, затем вопрос «Вы играете?» на askMs (7 с);
  // ответ «играю» даёт ещё extendMs (15 с); без ответа и по окончании этого времени ставится «стоп» (или пропуск раздачи).
  var DEFAULTS = { pollMs: 1000, heartbeatMs: 5000, staleMs: 30000, idleMs: 30000, askMs: 7000, extendMs: 15000, dealDelayMs: 1500, nextDelayMs: 10000, botDelayMs: 900, maxStrikes: 3, startDelayMs: 20000, codeLength: 5 };
  var PLAYER_ACTIONS = ['bet', 'hit', 'stand', 'double', 'split', 'sitout'];

  function fail(code) { var e = new Error(code); e.code = code; return e; }

  function create(env) {
    var cfg = Object.assign({}, DEFAULTS, env.options || {});
    var now = env.now || function () { return Date.now(); };
    var rng = env.rng || Math.random;
    var game = env.game;
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
      return req('GET', base + '/' + path).then(check).then(function (res) { return res.status === 404 ? null : res.json().then(function (d) { return { data: decode(d), name: d.name, createTime: d.createTime }; }); });
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

    // ---------- Общее ----------
    function emitter() {
      var listeners = [];
      return { on: function (fn) { listeners.push(fn); }, emit: function (x) { listeners.forEach(function (fn) { try { fn(x); } catch (e) { /* подписчик не должен ломать остальных */ } }); } };
    }

    // ================= Хост =================
    function createRoom(opts) {
      opts = opts || {};
      var size = Math.max(2, Math.min(game.CONFIG.maxSeats, Math.floor(opts.size) || 2));
      var code = null, rev = 1, status = 'lobby', full = null, lastBeat = 0, dirty = true, closed = false;
      var members = [{ uid: env.uid, name: opts.name || '', avatar: opts.avatar || 0, chips: opts.chips, seat: 0 }];
      var fillBots = opts.fillBots !== false;
      var readyAt = 0;       // момент последнего входа или выхода, когда за столом уже 2 человека и больше (отсчёт до возможности начать)
      var processed = {}, strikes = {}, pendingJoins = [];
      var wait = { key: '', since: 0 }, autoAt = 0, nextBotNo = 1, idle = {};   // idle[место] = { key, since, stage: 'idle' | 'asking' | 'extended', until }
      var em = emitter();

      function meta() {
        return JSON.stringify({ v: 1, game: 'blackjack', size: size, fillBots: fillBots, round: full ? full.round : 0,
          members: members.map(function (m) { return { uid: m.uid, name: m.name, avatar: m.avatar, seat: m.seat }; }) });
      }
      function touchReady() { readyAt = members.length >= 2 ? now() : 0; }
      function startIn() { return status === 'lobby' && readyAt ? Math.max(0, readyAt + cfg.startDelayMs - now()) : -1; }
      function fields() {
        var f = { hostUid: env.uid, game: 'blackjack', status: status, size: size, players: members.length, hostName: members[0].name, fillBots: fillBots, rev: rev, heartbeat: now(), startIn: startIn(), meta: meta() };
        if (full) f.state = JSON.stringify(game.view(full));
        f.timers = JSON.stringify(timersNow());
        return f;
      }
      // Таймеры ожидающих мест: сколько осталось до вопроса (stage idle), до автоматического хода (asking, extended)
      function timersNow() {
        var t = now(), out = [];
        Object.keys(idle).forEach(function (seat) {
          var e = idle[seat];
          out.push({ seat: Number(seat), stage: e.stage, ms: Math.max(0, (e.stage === 'idle' ? e.since + cfg.idleMs : e.until) - t) });
        });
        return out;
      }
      function publish() {
        rev++; lastBeat = now(); dirty = false;
        em.emit(getView());
        return putDoc('rooms/' + code, fields());
      }
      function getView() {
        return { code: code, role: 'host', status: status, size: size, fillBots: fillBots, rev: rev, members: members.map(function (m) { return { uid: m.uid, name: m.name, avatar: m.avatar, seat: m.seat }; }), state: full ? game.view(full) : null, timers: timersNow(), seat: 0, hostGone: false, closed: closed, startIn: startIn(), receivedAt: now() };
      }

      function seatsForStart() {
        var seats = members.map(function (m) { return { id: m.uid, name: m.name, chips: m.chips, kind: 'human' }; });
        if (fillBots) for (var i = seats.length; i < size; i++) { var bn = nextBotNo++; seats.push(Object.assign({ id: 'bot' + bn, name: 'Bot ' + bn, chips: game.CONFIG.startChips, kind: 'bot' }, game.makeBot ? game.makeBot(bn - 1) : {})); }
        return seats;
      }
      // Начать можно с ботами сразу; без ботов нужно 2 человека и startDelayMs после последнего входа или выхода
      function canStart() { return status === 'lobby' && (fillBots || (members.length >= 2 && !!readyAt && now() - readyAt >= cfg.startDelayMs)); }
      function start() {
        if (!canStart()) return Promise.resolve();
        var seats = seatsForStart();
        full = game.init(seats, Object.assign({ tableSize: size }, env.gameOptions || {}), rng);
        members.forEach(function (m, i) { m.seat = i; });
        status = 'playing'; dirty = true;
        return publish();
      }

      function apply(action) {
        var r = game.reduce(full, action, rng);
        if (!r.ok) return false;
        full = r.state; dirty = true;
        return true;
      }
      function memberBySeat(seat) { return members.filter(function (m) { return m.seat === seat; })[0]; }

      function handle(a) {
        var uid = a.uid, payload;
        try { payload = JSON.parse(a.payload); } catch (e) { return; }
        if (!payload || typeof payload.type !== 'string' || uid === env.uid) return;
        var m = members.filter(function (x) { return x.uid === uid; })[0];
        if (payload.type === 'hello') {
          if (m) return;
          if (status === 'lobby') {
            if (members.length >= size) return;
            members.push({ uid: uid, name: String(payload.name || '').slice(0, 20), avatar: Number(payload.avatar) || 0, chips: Math.max(0, Math.floor(Number(payload.chips) || 0)), seat: members.length });
            touchReady(); dirty = true;
          } else if (status === 'playing' && members.length < size + 20) {
            members.push({ uid: uid, name: String(payload.name || '').slice(0, 20), avatar: Number(payload.avatar) || 0, chips: Math.max(0, Math.floor(Number(payload.chips) || 0)), seat: null });
            pendingJoins.push(uid); dirty = true;
          }
          return;
        }
        if (!m) return;
        if (payload.type === 'leave') {
          strikes[uid] = 0;
          if (status === 'lobby') { members = members.filter(function (x) { return x.uid !== uid; }); members.forEach(function (x, i) { x.seat = i; }); touchReady(); dirty = true; }
          else if (m.seat !== null) { apply({ type: 'leave', seat: m.seat }); members = members.filter(function (x) { return x.uid !== uid; }); /* место освободится после раздачи */ }
          else { members = members.filter(function (x) { return x.uid !== uid; }); pendingJoins = pendingJoins.filter(function (x) { return x !== uid; }); dirty = true; }
          return;
        }
        if (payload.type === 'here') {           // «Да, я играю»: после вопроса даём ещё extendMs
          var e0 = m.seat !== null && idle[m.seat];
          if (e0 && e0.stage === 'asking') { e0.stage = 'extended'; e0.until = lastTick + cfg.extendMs; dirty = true; }
          return;
        }
        if (status !== 'playing' || m.seat === null || PLAYER_ACTIONS.indexOf(payload.type) < 0) return;
        payload.seat = m.seat;                    // место определяет хост, а не игрок
        if (apply(payload)) strikes[uid] = 0;
      }

      // Автоматика стола: боты, раздача, следующая раздача, таймеры, подсадка игроков
      function auto(t) {
        if (status !== 'playing' || t < autoAt) return;
        var st = full;
        var waitingNow = game.waitingSeats(full);
        Object.keys(idle).forEach(function (seat) { if (waitingNow.indexOf(Number(seat)) < 0) { delete idle[seat]; dirty = true; } });
        if (st.phase === 'betting') {
          // подсаживаем ждущих на свободные места
          while (pendingJoins.length) {
            var uid = pendingJoins[0], mm = members.filter(function (x) { return x.uid === uid; })[0];
            var free = -1;
            for (var i = 0; i < full.seats.length; i++) if (!full.seats[i].active || (full.seats[i].kind === 'bot')) { if (!full.seats[i].active) { free = i; break; } }
            if (free < 0) {            // нет свободного места: вытесняем бота
              for (var j = 0; j < full.seats.length; j++) if (full.seats[j].kind === 'bot' && full.seats[j].active) { apply({ type: 'leave', seat: j }); free = j; break; }
            }
            if (!mm) { pendingJoins.shift(); continue; }
            if (free < 0) break;
            if (!apply({ type: 'join', seat: free, id: mm.uid, name: mm.name, chips: mm.chips, kind: 'human' })) break;
            mm.seat = free; pendingJoins.shift();
          }
          var bot = game.nextBotAction(full, rng);
          if (bot) { apply(bot); autoAt = t + cfg.botDelayMs; return; }
          if (game.readyToDeal(full)) {
            var first = -1;
            for (var k = 0; k < full.seats.length; k++) if (full.seats[k].active && full.seats[k].bet > 0) { first = k; break; }
            if (wait.key !== 'deal') { wait = { key: 'deal', since: t }; }
            if (t - wait.since >= cfg.dealDelayMs && apply({ type: 'deal', seat: first })) { wait = { key: '', since: t }; autoAt = t + cfg.botDelayMs; }
            return;
          }
        } else if (st.phase === 'playing') {
          var b = game.nextBotAction(full, rng);
          if (b) { apply(b); autoAt = t + cfg.botDelayMs; return; }
        } else if (st.phase === 'settled') {
          if (wait.key !== 'next') wait = { key: 'next', since: t };
          if (t - wait.since >= cfg.nextDelayMs) {
            // освободившиеся места закрываем, у игроков, которые ушли, убираем запись
            var seated = {};
            if (apply({ type: 'next', seat: firstActive(full) })) { wait = { key: '', since: t }; full.seats.forEach(function (s) { if (s.active) seated[s.id] = true; }); members.forEach(function (x) { if (x.seat !== null && !seated[x.uid]) { x.seat = null; } }); members = members.filter(function (x) { return x.seat !== null || pendingJoins.indexOf(x.uid) >= 0 || x.uid === env.uid; }); }
          }
          return;
        }
        // таймеры молчащих людей: ждём idleMs, спрашиваем «Вы играете?» (askMs), при ответе даём ещё extendMs
        var waiting = game.waitingSeats(full), seen = {};
        waiting.forEach(function (seat) {
          seen[seat] = true;
          var s = full.seats[seat];
          var key = full.phase + ':' + full.round + ':' + (full.phase === 'playing' ? full.hand + ':' + s.hands.reduce(function (n, h) { return n + h.cards.length; }, 0) : s.bet);
          var e = idle[seat];
          if (!e || e.key !== key) { idle[seat] = { key: key, since: t, stage: 'idle', until: 0 }; dirty = true; return; }
          if (e.stage === 'idle' && t - e.since >= cfg.idleMs) { e.stage = 'asking'; e.until = t + cfg.askMs; dirty = true; return; }
          if ((e.stage === 'asking' || e.stage === 'extended') && t >= e.until) {
            var mem = memberBySeat(seat);
            delete idle[seat]; dirty = true;
            apply({ type: 'timeout', seat: seat });
            if (mem) { strikes[mem.uid] = (strikes[mem.uid] || 0) + 1; if (strikes[mem.uid] >= cfg.maxStrikes) apply({ type: 'leave', seat: seat }); }
          }
        });
        Object.keys(idle).forEach(function (seat) { if (!seen[seat]) { delete idle[seat]; dirty = true; } });
      }
      function firstActive(st) { for (var i = 0; i < st.seats.length; i++) if (st.seats[i].active) return i; return 0; }

      // Один шаг ведущего: принять действия, прогнать автоматику, опубликовать при изменениях
      var lastTick = 0;
      function tick(t) {
        if (closed) return Promise.resolve();
        t = t === undefined ? now() : t;
        lastTick = t;
        return listDocs('rooms/' + code + '/actions').then(function (docs) {
          docs.sort(function (a, b) { return (a.data.createdAt - b.data.createdAt) || (a.name < b.name ? -1 : 1); });
          var fresh = docs.filter(function (d) { return !processed[d.name]; });
          fresh.forEach(function (d) { processed[d.name] = true; handle(d.data); });
          auto(t);
          var cleanup = Promise.all(docs.map(function (d) { return delDoc(d.name).catch(function () { /* повторим в следующий раз */ }); }));
          return cleanup.then(function () {
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
        if (status !== 'playing') return false;
        if (action.type === 'leave') { close(); return true; }
        if (PLAYER_ACTIONS.indexOf(action.type) < 0) return false;
        var ok = apply(Object.assign({}, action, { seat: 0 }));
        if (ok) { strikes[env.uid] = 0; }
        return ok;
      }

      return (function begin() {
        var attempts = 0;
        function tryCreate() {
          code = makeCode();
          return putDoc('rooms/' + code, fields(), true).catch(function (e) {
            if (e.code === 'exists' && attempts++ < 5) return tryCreate();
            throw e;
          });
        }
        return tryCreate().then(function () {
          return { code: code, host: { code: code, role: 'host', start: start, tick: tick, close: close, send: dispatch, leave: close, getView: getView, onChange: em.on, publish: publish,
            setBots: function (on) { fillBots = !!on; dirty = true; } } };
        });
      })();
    }

    // ================= Игрок =================
    function joinRoom(code, hello) {
      code = String(code || '').toUpperCase().trim();
      var em = emitter(), lastRev = -1, view = null, stopped = false;
      function parseTimers(s) { try { var a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
      function parse(d) {
        var m; try { m = JSON.parse(d.meta); } catch (e) { m = { members: [] }; }
        var me = (m.members || []).filter(function (x) { return x.uid === env.uid; })[0];
        var st = null; if (d.state) { try { st = JSON.parse(d.state); } catch (e) { st = null; } }
        return { code: code, role: 'player', status: d.status, size: d.size, fillBots: m.fillBots !== false, rev: d.rev, members: m.members || [], state: st, timers: parseTimers(d.timers), startIn: typeof d.startIn === 'number' ? d.startIn : -1, receivedAt: now(), seat: me ? me.seat : null, joined: !!me, hostGone: false, closed: d.status === 'closed', heartbeat: d.heartbeat };
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
        if (doc.data.game !== 'blackjack') throw fail('wrong-game');
        var v0 = parse(doc.data);
        if (!v0.joined && doc.data.players >= doc.data.size && doc.data.status === 'lobby') throw fail('full');
        return (v0.joined ? Promise.resolve() : send({ type: 'hello', name: hello && hello.name, avatar: hello && hello.avatar, chips: hello && hello.chips })).then(function () {
          return { code: code, role: 'player', poll: poll, send: send, leave: function () { stopped = true; return send({ type: 'leave' }); }, stop: function () { stopped = true; }, onChange: em.on, getView: function () { return view; } };
        });
      });
    }

    // Открытые комнаты, которые ждут игроков
    function listRooms() {
      var body = { structuredQuery: { from: [{ collectionId: 'rooms' }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'lobby' } } }, limit: 20 } };
      return req('POST', base + ':runQuery', body).then(strict).then(function (res) { return res.json(); }).then(function (rows) {
        return rows.filter(function (r) { return r.document; }).map(function (r) {
          var d = decode(r.document), name = r.document.name;
          return { code: name.split('/').pop(), size: d.size, players: d.players, hostName: d.hostName || '', bots: d.fillBots === true, game: d.game, stale: now() - d.heartbeat > cfg.staleMs };
        }).filter(function (x) { return x.game === 'blackjack' && !x.stale && x.players < x.size; });
      });
    }

    return { createRoom: createRoom, joinRoom: joinRoom, listRooms: listRooms, CONFIG: cfg };
  }

  root.PlatformRooms = { create: create, DEFAULTS: DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
