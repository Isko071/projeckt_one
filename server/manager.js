// Менеджер столов: держит комнаты в памяти и гоняет для каждой тот же движок, что раньше работал в браузере создателя
// (shared/rooms.js для блэкджека, shared/rooms-turns.js для «Ятзи»). Создатель стола теперь обычный игрок: если он уходит,
// роль «создателя» переходит следующему, а стол живёт, пока за ним есть люди.
// Сокеты сюда не заходят: подключение — любой объект { uid, send(obj) }, поэтому менеджер проверяется тестами без сети.
const { MemStore, decodeFields } = require('./memstore');

const ACTIONS = ['chat', 'leave', 'here', 'again', 'start', 'rematch', 'close', 'bet', 'hit', 'stand', 'double', 'split', 'sitout', 'roll', 'hold', 'score', 'fold', 'check', 'call', 'raise', 'allin', 'ready'];
const GAMES = ['blackjack', 'yahtzee', 'poker', 'poker-simple'];
const POKER = ['poker', 'poker-simple'];

function fail(code) { const e = new Error(code); e.code = code; return e; }

class RoomManager {
  constructor(opts) {
    this.engine = opts.engine;
    this.now = opts.now || Date.now;
    this.cfg = Object.assign({ tickMs: 250, maxRooms: 300, graceMs: 45000, emptyMs: 600000, closedKeepMs: 5000, engineOptions: {} }, opts.config || {});
    this.rooms = new Map();           // код → { game, host, subs: Set, fields, ticking, again, emptySince, closedAt }
    this.conns = new Set();
    this.graces = new Map();          // uid + код → таймер выхода после обрыва связи
    this.store = new MemStore({ onDoc: (code, f) => this.onDoc(code, f) });
    this.apis = {};
    const base = { fetch: this.store.fetch, getToken: async () => 'server', uid: 'server', projectId: 'p', db: 'd', now: this.now, options: this.cfg.engineOptions };
    this.apis.blackjack = this.engine.PlatformRooms.create(Object.assign({}, base, { game: this.engine.Blackjack, gameOptions: { simple: true } }));
    this.apis.yahtzee = this.engine.PlatformTurnRooms.create(Object.assign({}, base, { game: this.engine.YahtzeeTable, gameId: 'yahtzee' }));
    this.apis.poker = this.engine.PlatformPokerRooms.create(Object.assign({}, base, { game: this.engine.Poker, gameId: 'poker', gameOptions: { variant: 'classic' } }));
    this.apis['poker-simple'] = this.engine.PlatformPokerRooms.create(Object.assign({}, base, { game: this.engine.Poker, gameId: 'poker-simple', gameOptions: { variant: 'simple' } }));
    this.timer = null;
    // Журнал событий и счётчики для личного кабинета владельца (в памяти, после перезапуска сервера начинаются заново)
    this.startedAt = this.now();
    this.events = [];
    this.counters = { created: { blackjack: 0, yahtzee: 0, 'poker-simple': 0 }, joins: 0, leaves: 0, starts: 0, errors: 0, denied: 0, connects: 0, peakConns: 0, peakRooms: 0 };
  }

  event(type, o) {
    o = o || {};
    this.events.push({ t: this.now(), type: type, game: o.game || '', code: o.code || '', uid: o.uid ? String(o.uid).slice(0, 8) : '', name: o.name || '', info: o.info || '' });
    if (this.events.length > (this.cfg.eventLimit || 300)) this.events.shift();
  }
  nameOf(room, uid) { const m = this.members(room).filter((x) => x.uid === uid)[0]; return m ? m.name : ''; }
  // Данные для кабинета: сводка, живые столы и последние события (новые сверху)
  adminReport() {
    const tables = [];
    this.rooms.forEach((room, code) => {
      const d = room.fields || {};
      tables.push({ code, game: room.game, status: d.status || '', size: d.size || 0, players: this.members(room).map((m) => m.name || '—'), private: d.private === true, mode: d.mode || '', online: room.subs.size });
    });
    const t = this.now();
    return {
      now: t, startedAt: this.startedAt, uptimeMs: t - this.startedAt, rooms: this.rooms.size, conns: this.conns.size,
      counters: JSON.parse(JSON.stringify(this.counters)), tables, events: this.events.slice().reverse()
    };
  }

  start() { if (!this.timer) this.timer = setInterval(() => this.tick(), this.cfg.tickMs); return this; }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.graces.forEach((t) => clearTimeout(t)); this.graces.clear(); }

  // ---------- Документы комнат ----------
  onDoc(code, fields) {
    const room = this.rooms.get(code);
    const doc = decodeFields(fields);
    if (room) { room.fields = doc; room.subs.forEach((c) => c.send({ t: 'doc', code, doc: this.docFor(doc, c.uid) })); }
    else this.pendingDoc = { code, doc };            // документ пришёл раньше, чем комната записана (при создании)
  }
  // Скрытые карты покера: поле `hole` (карты всех игроков) никому не уходит, каждому клиенту кладутся только его карты (`mine`)
  docFor(doc, uid) {
    if (!doc || typeof doc.hole !== 'string') return doc;
    const out = Object.assign({}, doc);
    delete out.hole;
    try { const mine = JSON.parse(doc.hole)[uid]; if (mine) out.mine = JSON.stringify(mine); } catch (e) { /* без своих карт */ }
    return out;
  }
  members(room) { try { return JSON.parse(room.fields.meta).members || []; } catch (e) { return []; } }
  isMember(room, uid) { return this.members(room).some((m) => m.uid === uid); }

  // ---------- Запросы клиентов ----------
  list(game) {
    const out = [];
    this.rooms.forEach((room, code) => {
      const d = room.fields;
      if (!d || room.game !== game || d.status !== 'lobby' || d.private === true || d.players >= d.size) return;
      out.push({ code, size: d.size, players: d.players, hostName: d.hostName || '', bots: d.fillBots === true, mode: d.mode || '', game, private: false });
    });
    return out.slice(0, 30);
  }

  async create(conn, game, o) {
    if (GAMES.indexOf(game) < 0) throw fail('bad-game');
    if (this.rooms.size >= this.cfg.maxRooms) throw fail('busy');
    o = o || {};
    this.pendingDoc = null;
    const res = await this.apis[game].createRoom({
      size: o.size, fillBots: o.fillBots, mode: o.mode, private: !!o.private, ante: o.ante, minBet: o.minBet, smallBlind: o.smallBlind, bigBlind: o.bigBlind,
      owner: { uid: conn.uid, name: o.name, avatar: o.avatar, chips: o.chips }
    });
    const room = { game, host: res.host, subs: new Set(), fields: this.pendingDoc && this.pendingDoc.code === res.code ? this.pendingDoc.doc : null, ticking: false, again: false, emptySince: 0, closedAt: 0 };
    this.rooms.set(res.code, room);
    this.counters.created[game]++;
    this.counters.peakRooms = Math.max(this.counters.peakRooms, this.rooms.size);
    this.event('create', { game, code: res.code, uid: conn.uid, name: String(o.name || '').slice(0, 20), info: o.private ? 'closed' : '' });
    this.subscribe(room, res.code, conn);
    return res.code;
  }

  async join(conn, game, code, hello) {
    code = String(code || '').toUpperCase().trim();
    const room = this.rooms.get(code);
    if (!room) throw fail('not-found');
    if (room.game !== game) throw fail('wrong-game');
    const d = room.fields || {};
    if (d.status === 'closed') throw fail('closed');
    const member = this.isMember(room, conn.uid);
    if (!member) {
      if (game === 'yahtzee' && d.status !== 'lobby') throw fail('started');
      if (POKER.indexOf(game) >= 0 && d.status !== 'lobby' && d.phase !== 'settled' && d.phase !== 'waiting') throw fail('started');
      if (POKER.indexOf(game) >= 0 && d.players >= d.size) throw fail('full');
      if (d.status === 'lobby' && d.players >= d.size) throw fail('full');
      hello = hello || {};
      this.store.addAction(code, conn.uid, JSON.stringify({ type: 'hello', name: hello.name, avatar: hello.avatar, chips: hello.chips }), this.now());
      this.counters.joins++;
      this.event('join', { game, code, uid: conn.uid, name: String(hello.name || '').slice(0, 20) });
      this.kick(code);
    }
    this.cancelGrace(conn.uid, code);
    this.subscribe(room, code, conn);
    return code;
  }

  act(conn, code, action) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (!room) throw fail('not-found');
    if (!this.isMember(room, conn.uid)) throw fail('not-member');
    if (!action || ACTIONS.indexOf(action.type) < 0) throw fail('bad-action');
    const text = JSON.stringify(action);
    if (text.length > 2000) throw fail('too-big');
    this.store.addAction(code, conn.uid, text, this.now());
    if (action.type === 'start') { this.counters.starts++; this.event('start', { game: room.game, code: String(code).toUpperCase(), uid: conn.uid, name: this.nameOf(room, conn.uid) }); }
    this.kick(code);
  }

  leave(conn, code) {
    code = String(code || '').toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return;
    if (this.isMember(room, conn.uid)) { this.counters.leaves++; this.event('leave', { game: room.game, code, uid: conn.uid, name: this.nameOf(room, conn.uid) }); this.store.addAction(code, conn.uid, JSON.stringify({ type: 'leave' }), this.now()); this.kick(code); }
    room.subs.delete(conn); conn.rooms && conn.rooms.delete(code);
    this.cancelGrace(conn.uid, code);
  }

  // Связь оборвалась: даём время вернуться (мобильный интернет, засыпающая вкладка), потом игрок выходит из-за стола
  disconnect(conn) {
    this.conns.delete(conn);
    (conn.rooms ? Array.from(conn.rooms) : []).forEach((code) => {
      const room = this.rooms.get(code);
      if (!room) return;
      room.subs.delete(conn);
      const key = conn.uid + ':' + code;
      this.cancelGrace(conn.uid, code);
      this.graces.set(key, setTimeout(() => {
        this.graces.delete(key);
        const back = Array.from(room.subs).some((c) => c.uid === conn.uid);
        if (!back) { const r = this.rooms.get(code); if (r && this.isMember(r, conn.uid)) { this.counters.leaves++; this.event('leave', { game: r.game, code, uid: conn.uid, name: this.nameOf(r, conn.uid), info: 'timeout' }); this.store.addAction(code, conn.uid, JSON.stringify({ type: 'leave' }), this.now()); this.kick(code); } }
      }, this.cfg.graceMs));
    });
  }
  cancelGrace(uid, code) { const key = uid + ':' + code; if (this.graces.has(key)) { clearTimeout(this.graces.get(key)); this.graces.delete(key); } }

  subscribe(room, code, conn) {
    room.subs.add(conn); conn.rooms = conn.rooms || new Set(); conn.rooms.add(code); this.conns.add(conn);
    this.counters.peakConns = Math.max(this.counters.peakConns, this.conns.size);
    if (room.fields) conn.send({ t: 'doc', code, doc: this.docFor(room.fields, conn.uid) });
  }

  // ---------- Ход времени ----------
  kick(code) { const room = this.rooms.get(code); if (room) room.again = true, setImmediate(() => this.tickRoom(code)); }
  async tickRoom(code) {
    const room = this.rooms.get(code);
    if (!room || room.ticking) return;
    room.ticking = true;
    try { do { room.again = false; await room.host.tick(); } while (room.again); }
    catch (e) { /* следующий такт повторит */ }
    room.ticking = false;
  }
  tick() {
    const t = this.now();
    Array.from(this.rooms.keys()).forEach((code) => {
      const room = this.rooms.get(code), d = room.fields || {};
      if (d.status === 'closed') {
        if (!room.closedAt) room.closedAt = t;
        if (t - room.closedAt >= this.cfg.closedKeepMs) this.remove(code);
        return;
      }
      if (room.host.isEmpty()) { this.remove(code); return; }
      if (!room.subs.size) { if (!room.emptySince) room.emptySince = t; if (t - room.emptySince >= this.cfg.emptyMs) this.remove(code); }
      else room.emptySince = 0;
      this.tickRoom(code);
    });
  }
  remove(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    this.event('closed', { game: room.game, code });
    room.subs.forEach((c) => { c.send({ t: 'gone', code }); c.rooms && c.rooms.delete(code); });
    this.rooms.delete(code); this.store.drop(code);
  }

  stats() { return { rooms: this.rooms.size, conns: this.conns.size }; }
}

module.exports = { RoomManager, ACTIONS };
