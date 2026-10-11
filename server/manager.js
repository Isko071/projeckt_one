// Менеджер столов: держит комнаты в памяти и гоняет для каждой тот же движок, что раньше работал в браузере создателя
// (shared/rooms.js для блэкджека, shared/rooms-turns.js для «Ятзи»). Создатель стола теперь обычный игрок: если он уходит,
// роль «создателя» переходит следующему, а стол живёт, пока за ним есть люди.
// Сокеты сюда не заходят: подключение — любой объект { uid, send(obj) }, поэтому менеджер проверяется тестами без сети.
const { MemStore, decodeFields } = require('./memstore');

const ACTIONS = ['chat', 'leave', 'here', 'again', 'start', 'rematch', 'close', 'bet', 'hit', 'stand', 'double', 'split', 'sitout', 'roll', 'hold', 'score', 'fold', 'check', 'call', 'raise', 'allin', 'ready', 'place', 'unplace', 'shoot', 'radar', 'sub', 'bomber', 'concede'];
const GAMES = ['blackjack', 'yahtzee', 'poker', 'poker-simple', 'battleship'];
const POKER = ['poker', 'poker-simple'];
const STAKE_GAMES = ['yahtzee', 'battleship'];     // в каких играх за столом бывает ставка

function fail(code) { const e = new Error(code); e.code = code; return e; }

class RoomManager {
  constructor(opts) {
    this.engine = opts.engine;
    this.now = opts.now || Date.now;
    this.wallet = opts.wallet || null;     // серверный кошелёк (server/wallet-service.js); без него ставки за столами выключены
    this.cfg = Object.assign({ tickMs: 250, maxRooms: 300, graceMs: 45000, emptyMs: 600000, closedKeepMs: 5000, minStake: 25, maxStake: 100000, strayMs: 10000, engineOptions: {} }, opts.config || {});
    this.rooms = new Map();           // код → { game, host, subs: Set, fields, ticking, again, emptySince, closedAt }
    this.conns = new Set();
    this.graces = new Map();          // uid + код → таймер выхода после обрыва связи
    this.store = new MemStore({ onDoc: (code, f) => this.onDoc(code, f) });
    this.apis = {};
    const base = { fetch: this.store.fetch, getToken: async () => 'server', uid: 'server', projectId: 'p', db: 'd', now: this.now, options: this.cfg.engineOptions };
    this.apis.blackjack = this.engine.PlatformRooms.create(Object.assign({}, base, { game: this.engine.Blackjack, gameOptions: { simple: true } }));
    this.apis.yahtzee = this.engine.PlatformTurnRooms.create(Object.assign({}, base, { game: this.engine.YahtzeeTable, gameId: 'yahtzee' }));
    this.apis.battleship = this.engine.PlatformTurnRooms.create(Object.assign({}, base, { game: this.engine.Battleship, gameId: 'battleship' }));
    // Серверный баланс: стек за покерным столом берётся залогом перед каждой раздачей, а после неё возвращается с итогом
    const pk = this.wallet ? { gate: (code, asks) => this.pokerGate(code, asks), onSettle: (code, list, voided) => this.pokerSettle(code, list, voided) } : {};
    this.apis.poker = this.engine.PlatformPokerRooms.create(Object.assign({}, base, pk, { game: this.engine.Poker, gameId: 'poker', gameOptions: { variant: 'classic' } }));
    this.apis['poker-simple'] = this.engine.PlatformPokerRooms.create(Object.assign({}, base, pk, { game: this.engine.Poker, gameId: 'poker-simple', gameOptions: { variant: 'simple' } }));
    this.timer = null;
    // Журнал событий и счётчики для личного кабинета владельца (в памяти, после перезапуска сервера начинаются заново)
    this.startedAt = this.now();
    this.events = [];
    this.counters = { created: { blackjack: 0, yahtzee: 0, poker: 0, 'poker-simple': 0, battleship: 0 }, joins: 0, leaves: 0, starts: 0, errors: 0, denied: 0, connects: 0, peakConns: 0, peakRooms: 0 };
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
    if (room) { room.fields = doc; room.subs.forEach((c) => c.send({ t: 'doc', code, doc: this.docFor(doc, c.uid) })); if (room.stake) this.watchStake(code, room); }
    else this.pendingDoc = { code, doc };            // документ пришёл раньше, чем комната записана (при создании)
  }
  // Скрытые карты покера: поле `hole` (карты всех игроков) никому не уходит, каждому клиенту кладутся только его карты (`mine`)
  docFor(doc, uid) {
    if (doc && typeof doc.secret === 'string') {          // скрытое у каждого игрока (корабли «Морского боя»): общее поле убирается, свою часть получает владелец
      const out = Object.assign({}, doc);
      delete out.secret;
      try { const own = JSON.parse(doc.secret)[uid]; if (own) out.mine = JSON.stringify(own); } catch (e) { /* без своей части */ }
      return out;
    }
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
      out.push({ code, size: d.size, players: d.players, hostName: d.hostName || '', bots: d.fillBots === true, mode: d.mode || '', game, private: false, stake: d.stake || 0 });
    });
    return out.slice(0, 30);
  }

  async create(conn, game, o) {
    if (GAMES.indexOf(game) < 0) throw fail('bad-game');
    if (this.rooms.size >= this.cfg.maxRooms) throw fail('busy');
    o = o || {};
    let stake = 0;
    if (o.stake !== undefined && o.stake !== null && Number(o.stake) !== 0) {
      stake = Math.floor(Number(o.stake));
      if (STAKE_GAMES.indexOf(game) < 0) throw fail('no-stakes');
      if (!this.wallet) throw fail('stakes-off');
      if (!(stake >= this.cfg.minStake && stake <= this.cfg.maxStake)) throw fail('bad-stake');
    }
    this.pendingDoc = null;
    let chips = o.chips;
    if (this.wallet && POKER.indexOf(game) >= 0) chips = await this.pokerChips(conn.uid, o.ante);
    const res = await this.apis[game].createRoom({
      stake: stake,
      size: o.size, fillBots: o.fillBots, mode: o.mode, private: !!o.private, ante: o.ante, minBet: o.minBet, smallBlind: o.smallBlind, bigBlind: o.bigBlind,
      owner: { uid: conn.uid, name: o.name, avatar: o.avatar, chips: chips }
    });
    const room = { game, host: res.host, subs: new Set(), fields: this.pendingDoc && this.pendingDoc.code === res.code ? this.pendingDoc.doc : null, ticking: false, again: false, emptySince: 0, closedAt: 0, stake: stake, holds: new Map(), settled: false, wasPlaying: false };
    if (stake) {
      const h = await this.takeStake(room, res.code, conn.uid);
      if (!h.ok) { this.store.drop(res.code); throw fail(h.error || 'no-funds'); }
    }
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
      if ((game === 'yahtzee' || game === 'battleship') && d.status !== 'lobby') throw fail('started');
      if (POKER.indexOf(game) >= 0 && d.status !== 'lobby' && d.phase !== 'settled' && d.phase !== 'waiting') throw fail('started');
      if (POKER.indexOf(game) >= 0 && d.players >= d.size) throw fail('full');
      if (d.status === 'lobby' && d.players >= d.size) throw fail('full');
      hello = hello || {};
      if (this.wallet && POKER.indexOf(game) >= 0) hello = Object.assign({}, hello, { chips: await this.pokerChips(conn.uid, d.ante) });
      if (room.stake) { const h = await this.takeStake(room, code, conn.uid); if (!h.ok) throw fail(h.error || 'no-funds'); }
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
    if (room.stake) this.guardStake(room, action);
    this.store.addAction(code, conn.uid, text, this.now());
    if (action.type === 'start') { this.counters.starts++; this.event('start', { game: room.game, code: String(code).toUpperCase(), uid: conn.uid, name: this.nameOf(room, conn.uid) }); }
    this.kick(code);
  }

  // Стол со ставкой: действия, которыми можно было бы увести партию мимо расчёта, принимаются только в нужный момент
  guardStake(room, action) {
    const status = (room.fields || {}).status;
    if ((action.type === 'again' || action.type === 'rematch') && status !== 'lobby' && !room.settled) throw fail('not-over');      // новую партию можно предложить, только когда прошлая подведена
    if (action.type === 'close' && status === 'playing' && !room.settled) throw fail('in-game');                                    // закрыть идущую партию нельзя (проигрыш не отменить): можно сдаться или выйти
    if (action.type === 'start' && (room.restaking || this.members(room).some((m) => !room.holds.has(m.uid) || room.holds.get(m.uid).owed !== undefined))) throw fail('stakes-pending');   // начать можно, когда у всех за столом принята ставка
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

  // ---------- Стеки за покерным столом ----------
  // Стек игрока = его баланс на сервере (то, что приславил браузер, не принимается). Не хватает на начальную ставку: за стол не сесть
  async pokerChips(uid, ante) {
    let bal;
    try { bal = (await this.wallet.load(uid)).balance; } catch (e) { throw fail('ledger'); }
    if (!(bal >= Math.max(1, Math.floor(Number(ante)) || 1))) throw fail('no-funds');
    return bal;
  }
  // Перед раздачей у каждого берётся залог на стек (весь баланс, а не больше): пока идёт раздача, эти аконы нельзя потратить в другой игре
  async pokerGate(code, asks) {
    const room = this.rooms.get(code), out = { chips: {}, retry: [], rejected: [] };
    if (!room) { out.rejected = asks.map((a) => a.uid); return out; }
    for (const a of asks) {
      const old = room.holds.get(a.uid);
      if (old) { if (old.owed !== undefined) out.retry.push(a.uid); else out.chips[a.uid] = old.amount; continue; }      // прошлая выплата ещё не оформлена: ждём
      try {
        const bal = (await this.wallet.load(a.uid)).balance, amount = Math.min(Math.floor(a.chips), bal);
        if (!(amount >= 1)) { out.rejected.push(a.uid); continue; }
        const h = await this.takeStake(room, code, a.uid, amount);
        if (h.ok) out.chips[a.uid] = amount; else if (h.error === 'busy' || h.error === 'ledger') out.retry.push(a.uid); else out.rejected.push(a.uid);
      } catch (e) { out.retry.push(a.uid); }
    }
    return out;
  }
  // Раздача закончена (или отменена): стек со всеми выигрышами и проигрышами возвращается на баланс
  pokerSettle(code, list, voided) {
    const room = this.rooms.get(code);
    if (!room) return;
    list.forEach((x) => { if (room.holds.has(x.uid)) this.queueStake(room, () => this.payStake(room, code, x.uid, Math.max(0, Math.floor(x.chips) || 0), voided ? 'void' : 'hand')); });
  }

  // ---------- Ставки за столом ----------
  // Ставка берётся залогом при входе за стол (и создателем при создании) и до конца партии лежит на сервере; по итогу победитель забирает банк.
  pushWallet(uid, state) { this.conns.forEach((c) => { if (c.uid === uid) c.send({ t: 'wallet', state }); }); }
  queueStake(room, fn) {
    room.job = (room.job || Promise.resolve()).then(fn).catch((e) => { this.counters.errors++; this.event('error', { game: room.game, info: 'stake:' + String((e && e.code) || (e && e.message) || 'error').slice(0, 40) }); });
    return room.job;
  }
  async takeStake(room, code, uid, amount) {
    const sum = amount === undefined ? room.stake : amount, poker = amount !== undefined;
    try {
      const r = await this.wallet.hold(uid, code, sum);
      if (!r.ok) return { ok: false, error: r.error || 'no-funds' };
      room.holds.set(uid, { amount: sum, at: this.now(), seen: poker });
      this.event('stake', { game: room.game, code, uid, info: '-' + sum });
      this.pushWallet(uid, await this.wallet.load(uid));
      return { ok: true };
    } catch (e) { return { ok: false, error: (e && e.code) || 'ledger' }; }
  }
  // Выплата или возврат залога; если запись в хранилище не прошла, ставка остаётся за игроком в долгах (h.owed) и повторяется из sweepStake
  async payStake(room, code, uid, payout, why) {
    const h = room.holds.get(uid);
    if (!h) return;
    h.owed = payout;
    try {
      const r = await this.wallet.release(uid, code, payout);
      if (room.holds.get(uid) === h) room.holds.delete(uid);
      this.event('stake', { game: room.game, code, uid, info: why + (payout ? ' +' + payout : '') });
      if (r.ok) this.pushWallet(uid, await this.wallet.load(uid));
    } catch (e) {
      h.retryAt = this.now() + 5000;
      this.counters.errors++; this.event('error', { game: room.game, code, uid, info: 'pay:' + String((e && e.code) || (e && e.message) || 'error').slice(0, 30) });
    }
  }
  refundAll(code, room) {
    if (!room.holds.size) return;
    const list = Array.from(room.holds.entries());
    this.queueStake(room, async () => { for (const [uid, h] of list) await this.payStake(room, code, uid, h.amount, 'refund'); });
  }
  // Следим за документом стола: конец партии, новая партия за тем же столом, уход из комнаты ожидания, закрытие стола
  watchStake(code, room) {
    const d = room.fields || {}, members = this.members(room), uids = members.map((m) => m.uid);
    room.holds.forEach((h, uid) => { if (uids.indexOf(uid) >= 0) h.seen = true; });
    let st = null; try { st = d.state ? JSON.parse(d.state) : null; } catch (e) { st = null; }
    if (d.status === 'closed') { if (!room.settled) this.refundAll(code, room); return; }
    if (d.status === 'playing' && st && st.gameOver && !room.settled) { room.settled = true; this.queueStake(room, () => this.settleStake(code, room, st, members)); return; }
    if (d.status === 'lobby') {
      if (room.settled) { room.settled = false; room.restaking = true; this.queueStake(room, () => this.restake(code, room, uids)); return; }
      const gone = Array.from(room.holds.entries()).filter(([uid, h]) => h.seen && uids.indexOf(uid) < 0 && h.owed === undefined);
      if (gone.length) this.queueStake(room, async () => { for (const [uid, h] of gone) await this.payStake(room, code, uid, h.amount, 'left'); });
    }
  }
  // Итоги: «Морской бой» — победитель забирает банк; «Ятзи» — банк делят победители среди тех, кто остался за столом (вышедший ставку теряет).
  // Банк только из ставок тех, кто сидел за столом; залог того, кто так и не получил место, возвращается ему
  async settleStake(code, room, st, members) {
    const entries = Array.from(room.holds.entries());
    for (const [uid, h] of entries) if (!h.seen) await this.payStake(room, code, uid, h.amount, 'refund');
    const seen = entries.filter(([, h]) => h.seen).map(([uid]) => uid), pot = entries.filter(([, h]) => h.seen).reduce((a, [, h]) => a + h.amount, 0);
    const seatOf = (u) => { const m = members.filter((x) => x.uid === u)[0]; return m ? m.seat : 99; };
    let winners = [];
    if (room.game === 'battleship') winners = members.filter((m) => m.seat === st.winner).map((m) => m.uid);
    else if (room.game === 'yahtzee') {
      const rows = this.engine.YahtzeeTable.standings(JSON.parse(JSON.stringify(st))).filter((r) => r.active);
      const max = Math.max.apply(null, rows.map((r) => r.total));
      winners = rows.filter((r) => r.total === max).map((r) => (members.filter((m) => m.seat === r.seat)[0] || {}).uid);
    }
    winners = winners.filter((u) => u && seen.indexOf(u) >= 0).sort((a, b) => seatOf(a) - seatOf(b));
    if (!winners.length) { for (const uid of seen) { const h = room.holds.get(uid); if (h) await this.payStake(room, code, uid, h.amount, 'refund'); } return; }
    const share = Math.floor(pot / winners.length), rest = pot - share * winners.length;
    for (const uid of seen) if (winners.indexOf(uid) < 0) await this.payStake(room, code, uid, 0, 'lost');     // проигравшие первыми: при сбое посреди расчёта аконы не появятся из воздуха
    for (let i = 0; i < winners.length; i++) await this.payStake(room, code, winners[i], share + (i < rest ? 1 : 0), 'won');       // остаток по одному первым победителям (по местам)
  }
  // Новая партия за тем же столом: у всех, кто остался, снова берётся ставка; кому не хватает — тот выходит из-за стола
  async restake(code, room, uids) {
    try {
      for (const uid of uids) {
        if (room.holds.has(uid)) continue;
        const h = await this.takeStake(room, code, uid);
        if (!h.ok) this.store.addAction(code, uid, JSON.stringify({ type: 'leave' }), this.now());
      }
    } finally { room.restaking = false; }
    this.kick(code);
  }
  // Залог без места за столом (вход не удался) возвращается; невыплаченные из-за сбоя хранилища выплаты повторяются
  sweepStake(code, room) {
    const uids = this.members(room).map((m) => m.uid), t = this.now();
    const stray = Array.from(room.holds.entries()).filter(([uid, h]) => h.owed === undefined && !h.seen && uids.indexOf(uid) < 0 && t - h.at >= this.cfg.strayMs);
    const owed = Array.from(room.holds.entries()).filter(([, h]) => h.owed !== undefined && (!h.retryAt || t >= h.retryAt));
    if (stray.length || owed.length) this.queueStake(room, async () => {
      for (const [uid, h] of stray) await this.payStake(room, code, uid, h.amount, 'refund');
      for (const [uid, h] of owed) await this.payStake(room, code, uid, h.owed, 'retry');
    });
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
    if (this.wallet && t - (this.lastWalletSweep || 0) >= 60000) {
      this.lastWalletSweep = t;
      this.wallet.refundOrphans(new Set(this.rooms.keys()), 120000).catch(() => {});     // залоги столов, которых нет (прошлый запуск сервера), через 2 минуты возвращаются
      this.wallet.gc();
    }
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
      if (room.stake || room.holds.size) this.sweepStake(code, room);
      this.tickRoom(code);
    });
  }
  remove(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.stake || room.holds.size) this.refundAll(code, room);
    this.event('closed', { game: room.game, code });
    room.subs.forEach((c) => { c.send({ t: 'gone', code }); c.rooms && c.rooms.delete(code); });
    this.rooms.delete(code); this.store.drop(code);
  }

  stats() { return { rooms: this.rooms.size, conns: this.conns.size }; }
}

module.exports = { RoomManager, ACTIONS };
