// Онлайн-столы покера (стол ведёт сервер, см. server/manager.js): комнаты в «базе» сервера, игроки шлют действия, ведущий (сервер) их применяет.
// Интерфейс как у shared/rooms.js и shared/rooms-turns.js:
//   create({ fetch, getToken, uid, projectId, db, game: Poker, gameId, gameOptions: { variant }, now?, rng?, options? })
//   .createRoom({ size, ante, minBet, smallBlind, bigBlind, private, owner: { uid, name, avatar, chips } }) → { code, host }
//   .joinRoom(code, { name, avatar, chips }) → контроллер игрока (poll, send, leave, stop, onChange, getView)
// Скрытые карты: в документе комнаты общее состояние (`state`, чужие карты скрыты) и карты всех игроков (`hole`, только для сервера):
// сервер перед отправкой убирает `hole` и каждому клиенту кладёт его карты в `mine`.
(function (root) {
  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  // idleMs — время на ход, затем вопрос «Вы ещё играете?» (askMs); без ответа — автоход (чек или сброс); maxStrikes автоходов подряд — выбывание.
  // readyWaitMs — сколько после итога ждут нажатия «Вернуться к столу»; кто не нажал, пропускает следующую раздачу.
  var DEFAULTS = { pollMs: 1000, heartbeatMs: 5000, staleMs: 30000, idleMs: 30000, askMs: 7000, maxStrikes: 3, startDelayMs: 20000, readyWaitMs: 30000, dealDelayMs: 1200, codeLength: 5 };
  var PLAYER_ACTIONS = ['fold', 'check', 'call', 'raise', 'allin'];

  function fail(code) { var e = new Error(code); e.code = code; return e; }
  function int(v, min, max, def) { v = Math.floor(Number(v)); return isFinite(v) && v >= min && v <= max ? v : def; }

  function create(env) {
    var cfg = Object.assign({}, DEFAULTS, env.options || {});
    var now = env.now || function () { return Date.now(); };
    var rng = env.rng || Math.random;
    var game = env.game, gameId = env.gameId, gameOpts = env.gameOptions || {};
    var Chat = root.PlatformChat;
    var base = 'https://firestore.googleapis.com/v1/projects/' + env.projectId + '/databases/' + env.db + '/documents';

    // ---------- Firestore (REST): тот же вид запросов, что у остальных столов ----------
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

    // ================= Ведущий (сервер) =================
    function createRoom(opts) {
      opts = opts || {};
      if (!opts.owner) throw fail('server-only');
      var size = int(opts.size, game.CONFIG.minSeats, game.CONFIG.maxSeats, 4);
      var simple = gameOpts.variant === 'simple';
      var gopts = { variant: simple ? 'simple' : 'classic', tableSize: size };
      if (simple) { gopts.ante = int(opts.ante, 1, 10000, 50); gopts.minBet = int(opts.minBet, 1, 100000, gopts.ante * 2); }
      else { gopts.bigBlind = int(opts.bigBlind, 2, 10000, 100); gopts.smallBlind = int(opts.smallBlind, 1, gopts.bigBlind, Math.floor(gopts.bigBlind / 2)); }
      var isPrivate = !!opts.private;
      var code = null, rev = 1, status = 'lobby', full = null, lastBeat = 0, dirty = true, closed = false, lastTick = 0;
      var ownerUid = String(opts.owner.uid);
      var members = [{ uid: ownerUid, name: String(opts.owner.name || '').slice(0, 20), avatar: Number(opts.owner.avatar) || 0, chips: int(opts.owner.chips, 0, 1e9, 0), seat: 0 }];
      var chat = Chat ? Chat.createLog() : null, chatLimit = Chat ? Chat.createLimiter() : null;
      function sys(code, name) { if (chat) { chat.add({ kind: 'sys', code: code, name: String(name || ''), ts: now() }); dirty = true; } }
      function addChat(m, text, cid) {
        if (!chat) return false;
        var t = Chat.clean(text);
        if (!t || !chatLimit.allow(m.uid, now())) return false;
        chat.add({ kind: 'msg', uid: m.uid, seat: m.seat, name: m.name, text: t, ts: now(), cid: String(cid || '').slice(0, 24) });
        dirty = true;
        return true;
      }
      var readyAt = 0;                 // момент последнего входа или выхода при 2+ игроках: от него идёт отсчёт до начала игры
      var processed = {}, idle = {}, strikes = {}, ready = {}, settledAt = 0, dealAt = 0;
      var em = emitter();

      function passOwner(leavingUid) {
        if (ownerUid !== leavingUid) return;
        var next = members.filter(function (x) { return x.uid !== leavingUid; })[0];
        ownerUid = next ? next.uid : null;
        if (next) sys('owner', next.name);
      }
      function touchReady() { readyAt = members.length >= game.CONFIG.minSeats ? now() : 0; }
      function startIn() { return status === 'lobby' && readyAt ? Math.max(0, readyAt + cfg.startDelayMs - now()) : -1; }
      function readyIn() { return status === 'playing' && full && full.phase === 'settled' && settledAt ? Math.max(0, settledAt + cfg.readyWaitMs - now()) : -1; }
      function timersNow() {
        var t = now(), out = [];
        Object.keys(idle).forEach(function (seat) {
          var e = idle[seat];
          out.push({ seat: Number(seat), stage: e.stage, ms: Math.max(0, (e.stage === 'idle' ? e.since + cfg.idleMs : e.until) - t) });
        });
        return out;
      }
      function privateCards() {
        var map = {};
        if (full) members.forEach(function (m) { var s = full.seats[m.seat]; if (s && s.inHand && s.cards.length) map[m.uid] = s.cards; });
        return map;
      }
      function metaObj() {
        var readyUids = Object.keys(ready);
        return { v: 1, game: gameId, variant: gopts.variant, size: size, owner: ownerUid, ante: gopts.ante || 0, minBet: gopts.minBet || gopts.bigBlind || 0, smallBlind: gopts.smallBlind || 0, bigBlind: gopts.bigBlind || 0,
          members: members.map(publicMember), strikes: strikes, ready: readyUids };
      }
      function fields() {
        var f = { hostUid: env.uid, game: gameId, status: status, size: size, players: members.length, hostName: members[0] ? members[0].name : '', mode: gopts.variant, private: isPrivate, rev: rev, heartbeat: now(),
          startIn: startIn(), readyIn: readyIn(), phase: full ? full.phase : '', meta: JSON.stringify(metaObj()) };
        if (full) { f.state = JSON.stringify(game.view(full, -1)); f.hole = JSON.stringify(privateCards()); }
        f.timers = JSON.stringify(timersNow());
        if (chat) f.chat = JSON.stringify(chat.list());
        return f;
      }
      function getView() {
        return { code: code, role: 'host', status: status, size: size, members: members.map(publicMember), state: full ? game.view(full, -1) : null, closed: closed, owner: ownerUid };
      }
      function publish() {
        rev++; dirty = false; lastBeat = now();
        em.emit(getView());
        return putDoc('rooms/' + code, fields());
      }

      function apply(action) {
        var r = game.reduce(full, action, rng);
        if (!r.ok) return false;
        full = r.state; dirty = true;
        if (full.phase === 'settled' && !settledAt) { settledAt = now(); ready = {}; idle = {}; }
        return true;
      }
      function memberBySeat(seat) { return members.filter(function (m) { return m.seat === seat; })[0]; }
      function canStart() { return status === 'lobby' && members.length >= game.CONFIG.minSeats && !!readyAt && now() - readyAt >= cfg.startDelayMs; }
      function dealHand() {
        if (!apply({ type: 'next', seat: 0 })) return false;
        settledAt = 0; ready = {}; idle = {}; dealAt = 0;
        return true;
      }
      function start() {
        if (!canStart()) return Promise.resolve();
        full = game.init(members.map(function (m, i) { m.seat = i; return { id: m.uid, name: m.name, kind: 'human', chips: m.chips }; }), gopts, rng);
        status = 'playing'; sys('start', '');
        dealHand();
        dirty = true;
        return publish();
      }

      function clean(payload) {
        var out = { type: payload.type };
        if (payload.type === 'raise') out.amount = int(payload.amount, 1, 1e9, 0);
        return out;
      }
      function removeMember(m) {
        members = members.filter(function (x) { return x.uid !== m.uid; });
        delete ready[m.uid]; delete strikes[m.uid];
        passOwner(m.uid);
      }

      function handle(a) {
        var uid = a.uid, payload;
        try { payload = JSON.parse(a.payload); } catch (e) { return; }
        if (!payload || typeof payload.type !== 'string' || uid === env.uid) return;
        var m = members.filter(function (x) { return x.uid === uid; })[0];
        if (payload.type === 'hello') {
          if (m || members.length >= size) return;
          var name = String(payload.name || '').slice(0, 20), chips = int(payload.chips, 0, 1e9, 0);
          if (status === 'lobby') {
            members.push({ uid: uid, name: name, avatar: Number(payload.avatar) || 0, chips: chips, seat: members.length });
            touchReady(); sys('join', name); dirty = true;
          } else if (status === 'playing' && full && (full.phase === 'settled' || full.phase === 'waiting') && chips > 0) {
            var free = -1;
            for (var i = 0; i < full.seats.length; i++) if (!full.seats[i].active) { free = i; break; }
            if (free < 0) return;
            if (!apply({ type: 'join', seat: free, id: uid, name: name, chips: chips, kind: 'human' })) return;
            members.push({ uid: uid, name: name, avatar: Number(payload.avatar) || 0, chips: chips, seat: free });
            ready[uid] = true; sys('join', name); dirty = true;
          }
          return;
        }
        if (!m) return;
        if (payload.type === 'chat') { addChat(m, payload.text, payload.cid); return; }
        if (uid === ownerUid) {
          if (payload.type === 'start') { start(); return; }
          if (payload.type === 'close') { close(); return; }
        }
        if (payload.type === 'leave') {
          sys('leave', m.name);
          if (status === 'lobby') { members = members.filter(function (x) { return x.uid !== uid; }); members.forEach(function (x, i) { x.seat = i; }); touchReady(); passOwner(uid); dirty = true; }
          else { if (full) apply({ type: 'leave', seat: m.seat }); removeMember(m); dirty = true; }
          return;
        }
        if (status !== 'playing' || !full) return;
        if (payload.type === 'ready') {                 // «Вернуться к столу»: готов к следующей раздаче (вернувшийся после пропуска снова в игре)
          ready[uid] = true;
          if (full.seats[m.seat] && full.seats[m.seat].sitOut) apply({ type: 'sitout', seat: m.seat, value: false });
          dirty = true; return;
        }
        if (payload.type === 'here') {                  // «Да, я играю»: отсчёт неактивности начинается заново
          var e0 = idle[m.seat];
          if (e0 && e0.stage === 'asking') { e0.stage = 'idle'; e0.since = lastTick; strikes[uid] = 0; dirty = true; }
          return;
        }
        if (PLAYER_ACTIONS.indexOf(payload.type) < 0) return;
        var act = clean(payload); act.seat = m.seat;
        if (apply(act)) strikes[uid] = 0;
      }

      // Таймеры хода, ожидание готовности после итога и новая раздача
      function auto(t) {
        if (status !== 'playing' || !full) return;
        if (full.phase === 'settled') {
          var cand = members.filter(function (m) { var s = full.seats[m.seat]; return s && s.active && s.chips > 0; });
          var rdy = cand.filter(function (m) { return ready[m.uid]; });
          if (rdy.length >= 2 && (rdy.length === cand.length || t - settledAt >= cfg.readyWaitMs) && t - settledAt >= cfg.dealDelayMs) {
            cand.forEach(function (m) { if (!ready[m.uid]) apply({ type: 'sitout', seat: m.seat, value: true }); });
            dealHand();
          }
          return;
        }
        var waiting = game.waitingSeats(full), seen = {};
        waiting.forEach(function (seat) {
          seen[seat] = true;
          var s = full.seats[seat], key = full.round + ':' + full.phase + ':' + full.currentBet + ':' + s.bet + ':' + s.acted, e = idle[seat];
          if (!e || e.key !== key) { idle[seat] = { key: key, since: t, stage: 'idle', until: 0 }; dirty = true; return; }
          if (e.stage === 'idle' && t - e.since >= cfg.idleMs) { e.stage = 'asking'; e.until = t + cfg.askMs; dirty = true; return; }
          if (e.stage === 'asking' && t >= e.until) {
            delete idle[seat]; dirty = true;
            var mem = memberBySeat(seat);
            apply({ type: 'timeout', seat: seat });
            if (mem) {
              strikes[mem.uid] = (strikes[mem.uid] || 0) + 1;
              if (strikes[mem.uid] >= cfg.maxStrikes) { sys('out', mem.name); if (full) apply({ type: 'leave', seat: seat }); removeMember(mem); }
            }
          }
        });
        Object.keys(idle).forEach(function (seat) { if (!seen[seat]) { delete idle[seat]; dirty = true; } });
      }

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

      var attempts = 0;
      function tryCreate() {
        code = makeCode();
        return putDoc('rooms/' + code, fields(), true).catch(function (e) {
          if (e.code === 'exists' && attempts++ < 5) return tryCreate();
          throw e;
        });
      }
      return tryCreate().then(function () {
        return { code: code, host: { code: code, role: 'host', start: start, isEmpty: function () { return !members.length; }, owner: function () { return ownerUid; }, tick: tick, close: close, getView: getView, onChange: em.on, publish: publish } };
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
        var st = parseJson(d.state, null), mine = parseJson(d.mine, null);
        if (st && me && mine && st.seats && st.seats[me.seat]) st.seats[me.seat].cards = mine;     // свои карты приходят отдельно: в общем состоянии они скрыты
        var timers = parseJson(d.timers, []);
        return { code: code, role: 'player', status: d.status, size: d.size, variant: m.variant, ante: m.ante || 0, minBet: m.minBet || 0, smallBlind: m.smallBlind || 0, bigBlind: m.bigBlind || 0,
          rev: d.rev, phase: d.phase || '', members: m.members || [], state: st, timers: Array.isArray(timers) ? timers : [], startIn: typeof d.startIn === 'number' ? d.startIn : -1, readyIn: typeof d.readyIn === 'number' ? d.readyIn : -1,
          ready: m.ready || [], strikes: m.strikes || {}, private: d.private === true, owner: m.owner || null, receivedAt: now(), chat: (function () { var c = parseJson(d.chat, []); return Array.isArray(c) ? c : []; })(),
          seat: me ? me.seat : null, joined: !!me, hostGone: false, closed: d.status === 'closed', heartbeat: d.heartbeat };
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
        if (!v0.joined && doc.data.status !== 'lobby' && doc.data.phase !== 'settled' && doc.data.phase !== 'waiting') throw fail('started');
        if (!v0.joined && doc.data.players >= doc.data.size) throw fail('full');
        return (v0.joined ? Promise.resolve() : send({ type: 'hello', name: hello && hello.name, avatar: hello && hello.avatar, chips: hello && hello.chips })).then(function () {
          return { code: code, role: 'player', poll: poll, send: send, leave: function () { stopped = true; return send({ type: 'leave' }); }, stop: function () { stopped = true; }, onChange: em.on, getView: function () { return view; } };
        });
      });
    }

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

  root.PlatformPokerRooms = { create: create, DEFAULTS: DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
