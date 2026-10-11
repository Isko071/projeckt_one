// Серверный кошелёк: у каждого игрока состояние кошелька хранится в ledger (коллекция wallets), а считает его тот же код, что и в браузере
// (shared/wallet.js: дневные пределы наград, серия дней, бонус дня). Клиент не может сказать «добавь мне N»: сервер принимает только
// заранее известные запросы (награда за победу в такой-то игре, ставка за столом) и сам подставляет суммы.
//
//   const svc = new WalletService({ ledger }); await svc.init();
//   await svc.act(uid, { op: 'sync' | 'markPlayed' | 'claimDaily' | 'earn' | 'reward' | 'countPlay' | 'countWin', ... }) → { state, result }
//   await svc.hold(uid, code, amount)            → { ok } | { ok:false, error:'no-funds' }   залог ставки за столом
//   await svc.release(uid, code, payout)         → вернуть залог/выплатить выигрыш (payout может быть 0 — залог сгорел)
//   svc.balanceOf(uid)                           → баланс из кеша (после sync/act)
//   «Мины» целиком на сервере (act: minesState | minesStart | minesOpen | minesCash | minesAbandon): мины раскладывает сервер, клиент видит только открытые клетки,
//   награду и штраф считает сервер по правилам games/mines/logic.js → { state, result: { mines: вид раунда, rw: { granted, lost } } }
//
// Предел защиты: победу в одиночной игре клиент объявляет сам (сервер не видит партию), поэтому ограничивают её дневные пределы наград.
// Сервер рассчитан на один работающий экземпляр: состояние игроков кешируется в памяти.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const SEED_CAP = Number(process.env.WALLET_SEED_CAP) || 100000;   // новому игроку засчитывается не больше этого баланса (на случай подделки до первого входа)
const EARN = { minesweeper: ['novice', 'amateur', 'expert'], yahtzee: ['easy', 'hard'] };
const REWARD = { blackjack: { win: 250, blackjack: 400 }, 'battleship-easy': { win: 500 }, 'battleship-expert': { win: 500 } };
const COUNT_SOURCES = ['yahtzee', 'minesweeper', 'blackjack', 'battleship-easy', 'battleship-expert', 'mines', 'poker-simple'];

function fail(code) { const e = new Error(code); e.code = code; return e; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

class WalletService {
  constructor(o) {
    this.ledger = o.ledger;
    this.now = o.now || Date.now;
    this.cache = new Map();             // uid → состояние кошелька
    this.holds = new Map();             // 'uid_код' → { uid, code, amount }
    this.queues = new Map();            // uid → хвост очереди операций (на игрока они идут по одной)
    this.shifts = new Map();            // uid → сдвиг дня (по часам игрока)
    this.seeds = new Map();             // uid → прогресс, присланный браузером при первой синхронизации
    this.rounds = new Map();            // uid → раунд «Мин» (с расположением мин: клиенту оно не отдаётся до конца раунда)
    this.rng = o.rng || (() => crypto.randomInt(0, 4294967296) / 4294967296);
    const ctx = vm.createContext({ JSON, Math, Date, Object, Array, Number, String, isFinite, parseInt });
    ctx.cur = null; ctx.out = null;
    vm.runInContext('var PlatformStorage = { get: function (k, d) { return cur ? JSON.parse(JSON.stringify(cur)) : d; }, set: function (k, v) { cur = JSON.parse(JSON.stringify(v)); out = cur; return true; } };', ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'wallet.js'), 'utf8'), ctx, { filename: 'shared/wallet.js' });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'games', 'mines', 'logic.js'), 'utf8'), ctx, { filename: 'games/mines/logic.js' });
    this.ctx = ctx; this.W = ctx.PlatformWallet; this.M = ctx.Mines;
  }

  // При запуске возвращает залоги, оставшиеся от столов, которые пропали вместе с прошлым запуском сервера
  async init() {
    const list = await this.ledger.list('holds');
    for (const h of list) {
      this.holds.set(h.id, h.data);
      await this.release(h.data.uid, h.data.code, h.data.amount);
    }
    return list.length;
  }

  // Очередь на игрока: операции с одним кошельком не пересекаются
  run(uid, fn) {
    const prev = this.queues.get(uid) || Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    this.queues.set(uid, tail);
    tail.then(() => { if (this.queues.get(uid) === tail) this.queues.delete(uid); });
    return next;
  }

  // Кошелёк «как у нового игрока»: прогресса в нём нет, начинать с него незачем
  pristine(s) {
    const c = this.W.sanitize(s);
    return c.streak === 0 && c.best === 0 && !c.playDay && !c.days.length && !Object.keys(c.wins).length && !Object.keys(c.plays).length && c.balance === this.W.CONFIG.start && !c.pending;
  }
  async load(uid) {
    if (this.cache.has(uid)) return this.cache.get(uid);
    let state = await this.ledger.get('wallets', uid);
    if (!state) {
      // Новый игрок: прогресс (серия, рекорды, дни, баланс) берётся из его кошелька в браузере, а если браузер его не прислал, баланс из рейтинга
      // Откуда начать: 1) кошелёк в браузере, если в нём есть прогресс; 2) прогресс из облака (снимок игрока) или хотя бы баланс из рейтинга; 3) пустой кошелёк
      const mine = this.seeds.get(uid);
      let seed = mine && typeof mine === 'object' && !this.pristine(mine) ? mine : await this.ledger.seed(uid);
      if (typeof seed === 'number') seed = { balance: seed };
      state = this.W.sanitize(seed && typeof seed === 'object' ? seed : null);
      state.balance = Math.min(state.balance, SEED_CAP); state.peak = Math.max(state.balance, Math.min(state.peak, SEED_CAP));
      try { await this.ledger.commit([{ op: 'set', coll: 'wallets', id: uid, data: state }]); } catch (e) { throw fail('ledger'); }
    }
    this.seeds.delete(uid);
    this.cache.set(uid, state);
    return state;
  }

  // Выполнить fn(W) над состоянием игрока и записать результат вместе с extra-записями (залоги) одной операцией
  async mutate(uid, fn, extra) {
    const state = await this.load(uid);
    this.ctx.cur = clone(state); this.ctx.out = null; this.W.forget(); this.W.setDayShift(this.shifts.get(uid) || 0);
    let result;
    try { result = fn(this.W); }
    catch (e) { this.ctx.cur = null; throw e; }
    const next = this.ctx.out ? clone(this.ctx.out) : state;
    this.ctx.cur = null; this.ctx.out = null;
    const changed = JSON.stringify(next) !== JSON.stringify(state);
    const writes = (changed ? [{ op: 'set', coll: 'wallets', id: uid, data: next }] : []).concat(extra && extra(result) || []);
    if (writes.length) {
      try { await this.ledger.commit(writes); }
      catch (e) { this.cache.delete(uid); throw fail('ledger'); }
    }
    this.cache.set(uid, next);
    return { state: next, result };
  }

  balanceOf(uid) { const s = this.cache.get(uid); return s ? s.balance : null; }

  // ---------- Запросы клиента ----------
  act(uid, m) {
    m = m || {};
    const now = this.now();
    // День игрока считается по его часам: сервер у себя живёт по другому поясу
    const tz = Number.isInteger(m.tz) && m.tz >= -840 && m.tz <= 840 ? m.tz : 0, serverTz = new Date(now).getTimezoneOffset();
    this.shifts.set(uid, (serverTz - tz) * 60000);
    if (m.op === 'sync' && m.seed && typeof m.seed === 'object' && !this.cache.has(uid)) this.seeds.set(uid, m.seed);
    return this.run(uid, async () => {
      switch (m.op) {
        case 'sync': return this.mutate(uid, () => null);
        case 'markPlayed': return this.mutate(uid, (W) => W.markPlayed(now));
        case 'claimDaily': return this.mutate(uid, (W) => W.claimDaily(now));
        case 'earn': {
          const levels = EARN[m.source];
          if (!levels || levels.indexOf(m.level) < 0) throw fail('bad-request');
          return this.mutate(uid, (W) => W.earn(m.source, W.CONFIG.rewards[m.source][m.level], now, m.source === 'minesweeper' && m.level === 'expert'));
        }
        case 'reward': {
          const kinds = REWARD[m.source], kind = m.kind || 'win';
          if (!kinds || !kinds[kind]) throw fail('bad-request');
          return this.mutate(uid, (W) => W.reward(m.source, kinds[kind], now));
        }
        case 'minesState': case 'minesStart': case 'minesOpen': case 'minesCash': case 'minesAbandon': return this.minesOp(uid, m, now);
        case 'countPlay': case 'countWin':
          if (COUNT_SOURCES.indexOf(m.source) < 0) throw fail('bad-request');
          return this.mutate(uid, (W) => (m.op === 'countPlay' ? W.countPlay(m.source) : W.countWin(m.source)));
        default: throw fail('bad-request');
      }
    });
  }

  // ---------- «Мины» ----------
  async loadRound(uid) {
    if (this.rounds.has(uid)) return this.rounds.get(uid);
    const r = await this.ledger.get('rounds', uid);
    if (r) this.rounds.set(uid, r);
    return r || null;
  }
  async minesOp(uid, m, now) {
    const M = this.M;
    const view = (round) => JSON.parse(JSON.stringify(M.view(round)));
    if (m.op === 'minesState') {
      const round = await this.loadRound(uid), s = await this.load(uid);
      return { state: s, result: { mines: round ? view(round) : null, rw: null } };
    }
    if (m.op === 'minesAbandon') {
      const s = await this.load(uid);
      if (await this.loadRound(uid)) {
        try { await this.ledger.commit([{ op: 'delete', coll: 'rounds', id: uid }]); } catch (e) { throw fail('ledger'); }
        this.rounds.delete(uid);
      }
      return { state: s, result: { mines: null, rw: null } };
    }
    if (m.op === 'minesStart') {
      const mines = M.clampMines(m.mines), s = await this.load(uid);
      if (s.balance < M.lossFor(mines)) throw fail('no-funds');
      const round = JSON.parse(JSON.stringify(M.init(mines, this.rng)));
      try { await this.ledger.commit([{ op: 'set', coll: 'rounds', id: uid, data: round }]); } catch (e) { throw fail('ledger'); }
      this.rounds.set(uid, round);
      return { state: s, result: { mines: view(round), rw: null } };
    }
    // открыть клетку или забрать накопленное
    const round = await this.loadRound(uid);
    if (!round || round.status !== 'playing') throw fail('no-round');
    const action = m.op === 'minesCash' ? { type: 'cashout' } : { type: 'open', index: m.index };
    const r = M.reduce(round, action);
    if (!r.ok) throw fail('bad-request');
    const next = JSON.parse(JSON.stringify(r.state)), over = next.status !== 'playing', first = action.type === 'open' && round.openedCount === 0;
    let rw = { granted: 0, lost: 0 };
    const res = await this.mutate(uid, (W) => {
      if (first) { W.markPlayed(now); W.countPlay('mines'); }
      if (!over) return;
      if (next.payout > 0) { W.add(next.payout, 'mines', now); W.countWin('mines'); rw = { granted: next.payout, lost: 0 }; }
      else { const take = Math.min(M.lossFor(next.mines), W.getBalance()); if (take > 0) W.spend(take, 'mines', now); rw = { granted: 0, lost: take }; }
    }, () => [over ? { op: 'delete', coll: 'rounds', id: uid } : { op: 'set', coll: 'rounds', id: uid, data: next }]);
    if (over) this.rounds.delete(uid); else this.rounds.set(uid, next);
    return { state: res.state, result: { mines: view(next), rw } };
  }

  // ---------- Залоги ставок ----------
  hold(uid, code, amount) {
    amount = Math.floor(Number(amount));
    if (!(amount >= 1)) return Promise.reject(fail('bad-request'));
    const key = uid + '_' + code;
    return this.run(uid, async () => {
      if (this.holds.has(key)) return { ok: true, balance: this.balanceOf(uid) };
      let ok = false;
      const rec = { uid, code, amount, at: this.now() };
      const r = await this.mutate(uid, (W) => { ok = W.spend(amount, 'stake', this.now()); return ok; }, () => (ok ? [{ op: 'set', coll: 'holds', id: key, data: rec }] : []));
      if (!ok) return { ok: false, error: 'no-funds', balance: r.state.balance };
      this.holds.set(key, rec);
      return { ok: true, balance: r.state.balance };
    });
  }
  release(uid, code, payout) {
    const key = uid + '_' + code;
    payout = Math.max(0, Math.floor(Number(payout)) || 0);
    return this.run(uid, async () => {
      if (!this.holds.has(key)) return { ok: false, balance: this.balanceOf(uid) };
      const r = await this.mutate(uid, (W) => (payout > 0 ? W.add(payout, 'stake', this.now()) : true), () => [{ op: 'delete', coll: 'holds', id: key }]);
      this.holds.delete(key);
      return { ok: true, balance: r.state.balance };
    });
  }
}

module.exports = { WalletService, SEED_CAP };
