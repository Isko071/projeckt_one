// Серверный кошелёк: у каждого игрока состояние кошелька хранится в ledger (коллекция wallets), а считает его тот же код, что и в браузере
// (shared/wallet.js: дневные пределы наград, серия дней, бонус дня). Клиент не может сказать «добавь мне N»: сервер принимает только
// заранее известные запросы (награда за победу в такой-то игре, ставка за столом) и сам подставляет суммы.
//
//   const svc = new WalletService({ ledger }); await svc.init();
//   await svc.act(uid, { op: 'sync' | 'markPlayed' | 'claimDaily' | 'earn' | 'reward' | 'countPlay' | 'countWin', ... }) → { state, result }
//   await svc.hold(uid, code, amount)            → { ok } | { ok:false, error:'no-funds' }   залог ставки за столом
//   await svc.release(uid, code, payout)         → вернуть залог/выплатить выигрыш (payout может быть 0 — залог сгорел)
//   svc.balanceOf(uid)                           → баланс из кеша (после sync/act)
//
// Предел защиты: победу в одиночной игре клиент объявляет сам (сервер не видит партию), поэтому ограничивают её дневные пределы наград.
// Сервер рассчитан на один работающий экземпляр: состояние игроков кешируется в памяти.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SEED_CAP = 10000;                 // новому игроку выдаётся не больше этого, даже если в облаке опубликован больший баланс
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
    const ctx = vm.createContext({ JSON, Math, Date, Object, Array, Number, String, isFinite, parseInt });
    ctx.cur = null; ctx.out = null;
    vm.runInContext('var PlatformStorage = { get: function (k, d) { return cur ? JSON.parse(JSON.stringify(cur)) : d; }, set: function (k, v) { cur = JSON.parse(JSON.stringify(v)); out = cur; return true; } };', ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'wallet.js'), 'utf8'), ctx, { filename: 'shared/wallet.js' });
    this.ctx = ctx; this.W = ctx.PlatformWallet;
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

  async load(uid) {
    if (this.cache.has(uid)) return this.cache.get(uid);
    let state = await this.ledger.get('wallets', uid);
    if (!state) {
      const seed = await this.ledger.seed(uid);
      state = this.W.sanitize(seed === null ? null : { balance: Math.min(seed, SEED_CAP) });
    }
    this.cache.set(uid, state);
    return state;
  }

  // Выполнить fn(W) над состоянием игрока и записать результат вместе с extra-записями (залоги) одной операцией
  async mutate(uid, fn, extra) {
    const state = await this.load(uid);
    this.ctx.cur = clone(state); this.ctx.out = null; this.W.forget();
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
        case 'countPlay': case 'countWin':
          if (COUNT_SOURCES.indexOf(m.source) < 0) throw fail('bad-request');
          return this.mutate(uid, (W) => (m.op === 'countPlay' ? W.countPlay(m.source) : W.countWin(m.source)));
        default: throw fail('bad-request');
      }
    });
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
