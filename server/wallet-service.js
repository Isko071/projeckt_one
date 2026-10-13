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

const SEED_CAP = Number(process.env.WALLET_SEED_CAP) || 50000;    // новому игроку засчитывается не больше этого баланса (на случай подделки до первого входа)
const EXPERT_GAP_MS = 60000, EXPERT_PER_DAY = 30;                   // награда эксперта «Сапёра» без дневного предела: не чаще раза в минуту и не больше 30 в сутки (партию сервер не видит)
// Прогресс, принесённый из браузера (баланс, серия), принимается только у аккаунтов, появившихся до этой даты (они играли до серверного баланса): иначе любой новый аккаунт приносил бы себе до SEED_CAP аконов
const SEED_BEFORE = Date.parse(process.env.WALLET_SEED_BEFORE || '2026-10-12T00:00:00Z');
// Топы: победы онлайн (их фиксирует сервер за столом) и быстрые победы в «Сапёре». Партию «Сапёра» сервер не видит, поэтому время принимается, только если оно не меньше правдоподобного
// предела уровня (секунды) и не больше, чем игрок мог играть с момента первого хода (сервер ставит отметку на первом ходе партии) плюс запас
const TOP_WIN_GAMES = ['yahtzee', 'blackjack', 'poker-simple', 'battleship'];
const FAST_MIN = { novice: 3, amateur: 8, expert: 20 }, FAST_MAX = 99 * 60 + 59, FAST_SLACK = 5;
const RATING_MS = Number(process.env.WALLET_RATING_MS) || 10000;     // как часто баланс уходит в рейтинг
const TZ_LOCK_MS = 12 * 3600000, MAX_HOLDS = 3, RID_KEEP = 200, IDLE_MS = 30 * 60000;
const EARN = { minesweeper: ['novice', 'amateur', 'expert'], yahtzee: ['easy', 'hard'] };
const REWARD = { blackjack: { win: 250, blackjack: 400 }, 'battleship-easy': { win: 500 }, 'battleship-expert': { win: 500 } };
const POKER_SRC = 'poker-simple', BOT_STACK = 5000, PK_PHASES = ['preflop', 'flop', 'turn', 'river'];
const COUNT_SOURCES = ['yahtzee', 'minesweeper', 'blackjack', 'battleship', 'battleship-easy', 'battleship-expert', 'mines', 'poker-simple'];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function fail(code) { const e = new Error(code); e.code = code; return e; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

class WalletService {
  constructor(o) {
    this.ledger = o.ledger;
    this.now = o.now || Date.now;
    this.seedBefore = o.seedBefore !== undefined ? o.seedBefore : SEED_BEFORE;
    this.cache = new Map();             // uid → состояние кошелька
    this.holds = new Map();             // 'uid_код' → { uid, code, amount }
    this.queues = new Map();            // uid → хвост очереди операций (на игрока они идут по одной)
    this.shifts = new Map();            // uid → сдвиг дня (по часам игрока)
    this.seeds = new Map();             // uid → прогресс, присланный браузером при первой синхронизации
    this.rounds = new Map();            // uid → раунд «Мин» (с расположением мин: клиенту оно не отдаётся до конца раунда)
    this.rids = new Map();              // uid → идентификаторы уже применённых запросов (повтор того же запроса не начисляет второй раз)
    this.tzs = new Map();               // uid → { tz, since }: часовой пояс игрока меняется не чаще раза в 12 часов (иначе сменой пояса сбрасывались бы дневные пределы)
    this.experts = new Map();           // uid → { last, t0, n }
    this.touched = new Map();           // uid → когда последний раз обращались (для очистки памяти)
    this.holdsLoaded = false;
    this.winQ = new Map();              // 'игра|uid' → побед, ждущих отправки в топ
    this.fastQ = new Map();             // 'уровень|uid' → лучшее время, ждущее отправки
    this.fastBest = new Map();          // uid → лучшие времена игрока ({ novice, amateur, expert })
    this.msStart = new Map();           // uid → когда начата последняя партия «Сапёра»
    this.rated = new Map();             // uid → баланс, который ждёт отправки в рейтинг
    this.ratedLast = new Map();         // uid → что уже отправлено
    this.rateTimer = null;
    this.rng = o.rng || (() => crypto.randomInt(0, 4294967296) / 4294967296);
    const ctx = vm.createContext({ JSON, Math, Date, Object, Array, Number, String, isFinite, parseInt });
    ctx.cur = null; ctx.out = null;
    vm.runInContext('var PlatformStorage = { get: function (k, d) { return cur ? JSON.parse(JSON.stringify(cur)) : d; }, set: function (k, v) { cur = JSON.parse(JSON.stringify(v)); out = cur; return true; } };', ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'wallet.js'), 'utf8'), ctx, { filename: 'shared/wallet.js' });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'games', 'mines', 'logic.js'), 'utf8'), ctx, { filename: 'games/mines/logic.js' });
    ['logic.js', 'bots.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'games', 'poker', f), 'utf8'), ctx, { filename: 'games/poker/' + f }));
    this.ctx = ctx; this.W = ctx.PlatformWallet; this.M = ctx.Mines; this.PK = ctx.Poker; this.Bots = ctx.PokerBots;
    this.pokers = new Map();            // uid → партия «Покера» против ботов (с колодой и картами ботов: клиенту отдаётся только то, что видит игрок)
  }

  // Залоги, оставшиеся в хранилище (от столов, которые пропали вместе с прошлым запуском сервера), читаются при запуске, но возвращаются позже и не здесь:
  // при деплое старый экземпляр ещё минуту-другую живёт и сам выплачивает банки своих столов. Возврат: refundOrphans (из manager.tick)
  async init() {
    try { await this.loadHolds(); } catch (e) { /* хранилище недоступно: повторим из manager.tick, запуск из-за этого не падает */ }
    return this.holds.size;
  }
  async loadHolds() {
    const list = await this.ledger.list('holds');
    list.forEach((h) => { if (!this.holds.has(h.id)) this.holds.set(h.id, h.data); });
    this.holdsLoaded = true;
  }
  // Возвращает залоги столов, которых на этом сервере нет (старше minAgeMs); live — коды столов, живущих сейчас
  async refundOrphans(live, minAgeMs) {
    if (!this.holdsLoaded) { try { await this.loadHolds(); } catch (e) { return 0; } }
    const t = this.now(); let n = 0;
    for (const [key, h] of Array.from(this.holds.entries())) {
      if (live.has(h.code) || t - (h.at || 0) < minAgeMs) continue;
      try { const r = await this.release(h.uid, h.code, h.amount); if (r.ok) n++; } catch (e) { /* повторим в следующий раз */ }
    }
    return n;
  }
  // Забывает кошельки, к которым давно не обращались (состояние лежит в хранилище и перечитается)
  gc() {
    const t = this.now();
    this.touched.forEach((at, uid) => { if (t - at > IDLE_MS && !this.queues.has(uid)) { this.cache.delete(uid); this.rounds.delete(uid); this.pokers.delete(uid); this.fastBest.delete(uid); this.msStart.delete(uid); this.shifts.delete(uid); this.rids.delete(uid); this.touched.delete(uid); } });
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
    if (state) { this.rids.set(uid, Array.isArray(state.rids) ? state.rids.filter((x) => typeof x === 'string').slice(-RID_KEEP) : []); state = this.W.sanitize(state); }
    if (!state) {
      // Новый игрок: прогресс (серия, рекорды, дни, баланс) берётся из его кошелька в браузере, а если браузер его не прислал, баланс из рейтинга
      // Откуда начать: 1) кошелёк в браузере, если в нём есть прогресс; 2) прогресс из облака (снимок игрока) или хотя бы баланс из рейтинга; 3) пустой кошелёк
      const mine = this.seeds.get(uid), since = await this.ledger.accountSince(uid);
      const old = since !== null && since < this.seedBefore;                  // нет документов аккаунта или он новый: перенос прогресса не положен, начинает с обычного старта
      let seed = !old ? null : (mine && typeof mine === 'object' && !this.pristine(mine) ? mine : await this.ledger.seed(uid));
      if (typeof seed === 'number') seed = { balance: seed };
      state = this.W.sanitize(seed && typeof seed === 'object' ? seed : null);
      state.balance = Math.min(state.balance, SEED_CAP); state.peak = Math.max(state.balance, Math.min(state.peak, SEED_CAP));
      // Из присланного (а значит подделываемого) берётся прогресс, а не «заготовки» наград: бонус дня, счётчики дневных пределов и журнал обнуляются
      state.pending = null; state.earned = 0; state.earnDay = null; state.capDay = null; state.capBase = 0; state.capUsed = 0; state.onDay = null; state.onUsed = 0; state.rw = { day: null, used: {} }; state.log = [];
      this.rids.set(uid, []);
      try { await this.ledger.commit([{ op: 'set', coll: 'wallets', id: uid, data: state }]); } catch (e) { throw fail('ledger'); }
    }
    this.seeds.delete(uid);
    this.cache.set(uid, state);
    return state;
  }

  // Выполнить fn(W) над состоянием игрока и записать результат вместе с extra-записями (залоги) одной операцией
  async mutate(uid, fn, extra, rid) {
    const state = await this.load(uid);
    this.touched.set(uid, this.now());
    this.ctx.cur = clone(state); this.ctx.out = null; this.W.forget(); this.W.setDayShift(this.shifts.get(uid) || 0);
    let result;
    try { result = fn(this.W); }
    catch (e) { this.ctx.cur = null; throw e; }
    const next = this.ctx.out ? clone(this.ctx.out) : state;
    this.ctx.cur = null; this.ctx.out = null;
    const changed = JSON.stringify(next) !== JSON.stringify(state);
    const ridList = rid ? (this.rids.get(uid) || []).concat(rid).slice(-RID_KEEP) : null;
    const writes = (changed || ridList ? [{ op: 'set', coll: 'wallets', id: uid, data: ridList ? Object.assign({}, next, { rids: ridList }) : Object.assign({}, next, { rids: this.rids.get(uid) || [] }) }] : []).concat(extra && extra(result) || []);
    if (writes.length) {
      try { await this.ledger.commit(writes); }
      catch (e) { this.forget(uid); throw fail('ledger'); }       // запись могла пройти, а ответ потеряться: всё, что помним про этого игрока, перечитаем из хранилища
    }
    this.cache.set(uid, next);
    this.rate(uid, next.balance);
    if (ridList) this.rids.set(uid, ridList);
    return { state: next, result };
  }

  // После неоднозначной ошибки записи забываем кеш игрока: кошелёк, раунд «Мин» и залоги перечитаются из хранилища
  forget(uid) {
    this.cache.delete(uid); this.rounds.delete(uid); this.pokers.delete(uid); this.fastBest.delete(uid);
    Array.from(this.holds.entries()).forEach(([k, h]) => { if (h.uid === uid) this.holds.delete(k); });
    this.holdsLoaded = false;
  }
  balanceOf(uid) { const s = this.cache.get(uid); return s ? s.balance : null; }

  // ---------- Запросы клиента ----------
  act(uid, m) {
    m = m || {};
    const now = this.now();
    // День игрока считается по его часам: сервер у себя живёт по другому поясу
    let tz = Number.isInteger(m.tz) && m.tz >= -720 && m.tz <= 840 ? m.tz : 0;
    const known = this.tzs.get(uid), serverTz = new Date(now).getTimezoneOffset();
    if (!known) this.tzs.set(uid, { tz, since: now });
    else if (tz !== known.tz && now - known.since >= TZ_LOCK_MS) this.tzs.set(uid, { tz, since: now });
    tz = this.tzs.get(uid).tz;
    this.shifts.set(uid, (serverTz - tz) * 60000);
    const rid = typeof m.rid === 'string' && m.rid.length >= 8 && m.rid.length <= 40 ? m.rid : null;
    if (m.op === 'sync' && m.seed && typeof m.seed === 'object' && !this.cache.has(uid)) this.seeds.set(uid, m.seed);
    return this.run(uid, async () => {
      // Повтор уже применённого запроса (вторая вкладка, потерянный ответ): состояние то же, второй раз не начисляется
      if (rid && m.op !== 'sync') { await this.load(uid); if ((this.rids.get(uid) || []).indexOf(rid) >= 0) return { state: await this.load(uid), result: null, dup: true }; }
      switch (m.op) {
        case 'sync': return this.mutate(uid, () => null);
        case 'markPlayed': return this.mutate(uid, (W) => W.markPlayed(now), null, rid);
        case 'claimDaily': return this.mutate(uid, (W) => W.claimDaily(now), null, rid);
        case 'earn': {
          const levels = has(EARN, m.source) ? EARN[m.source] : null;
          if (!levels || levels.indexOf(m.level) < 0) throw fail('bad-request');
          const expert = m.source === 'minesweeper' && m.level === 'expert';
          if (expert) {
            // Награда эксперта без дневного предела, а партию сервер не видит: чаще раза в минуту и больше 30 в сутки награды не будет (победа всё равно засчитывается)
            let e = this.experts.get(uid);
            if (!e || now - e.t0 >= 86400000) e = { last: 0, t0: now, n: 0 };
            const ok = now - e.last >= EXPERT_GAP_MS && e.n < EXPERT_PER_DAY;
            if (ok) { e.last = now; e.n++; }
            this.experts.set(uid, e);
            if (!ok) return this.mutate(uid, (W) => { W.countWin('minesweeper'); return { granted: 0, capped: true }; }, null, rid);
          }
          const earned = await this.mutate(uid, (W) => W.earn(m.source, W.CONFIG.rewards[m.source][m.level], now, expert), null, rid);
          if (m.source === 'minesweeper') { await this.noteFast(uid, m.level, m.time, now); this.msStart.delete(uid); }      // каждой победе нужна своя отметка начала партии
          return earned;
        }
        case 'reward': {
          const kinds = has(REWARD, m.source) ? REWARD[m.source] : null, kind = m.kind || 'win';
          if (!kinds || typeof kind !== 'string' || !has(kinds, kind)) throw fail('bad-request');
          return this.mutate(uid, (W) => W.reward(m.source, kinds[kind], now), null, rid);
        }
        case 'pokerState': case 'pokerStart': case 'pokerAct': case 'pokerBot': case 'pokerNext': case 'pokerLeave': return this.pokerOp(uid, m, now);
        case 'minesState': case 'minesStart': case 'minesOpen': case 'minesCash': case 'minesAbandon': return this.minesOp(uid, m, now, rid);
        case 'countPlay': case 'countWin':
          if (typeof m.source !== 'string' || COUNT_SOURCES.indexOf(m.source) < 0) throw fail('bad-request');
          if (m.op === 'countPlay' && m.source === 'minesweeper') this.msStart.set(uid, now);
          return this.mutate(uid, (W) => (m.op === 'countPlay' ? W.countPlay(m.source) : W.countWin(m.source)), null, rid);
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
  async minesOp(uid, m, now, rid) {
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
    }, () => [over ? { op: 'delete', coll: 'rounds', id: uid } : { op: 'set', coll: 'rounds', id: uid, data: next }], rid);
    if (over) this.rounds.delete(uid); else this.rounds.set(uid, next);
    return { state: res.state, result: { mines: view(next), rw } };
  }

  // ---------- «Покер: Чожук» против ботов ----------
  // Раздачу ведёт сервер: колода и карты ботов клиенту не уходят, ставки списываются с баланса сразу (одной записью с состоянием партии),
  // выигрыш начисляется по итогу с дневным пределом против ботов. Боты ходят по одному запросу pokerBot: так экран сам держит темп игры.
  async loadPoker(uid) {
    if (this.pokers.has(uid)) return this.pokers.get(uid);
    const r = await this.ledger.get('rounds', uid + '_pk');
    if (r) this.pokers.set(uid, r);
    return r || null;
  }
  pokerView(r, rw) {
    const st = JSON.parse(JSON.stringify(this.PK.view(r.st, 0)));
    return { st, free: !!r.free, spent: r.spent, size: r.size, ante: r.ante, rw: rw || null };
  }
  // Новая раздача за столом: места и ставки; false, если играть не на что
  pokerDeal(r, W, now) {
    const PK = this.PK, st = r.st, min = st.ante;
    r.free = W.capStatus(now).left <= 0;
    const balance = W.getBalance();
    if (!r.free && balance < min) return false;
    st.seats[0].chips = r.free ? Math.max(balance, min * 20) : balance;
    st.seats.forEach((s, i) => { if (i > 0) { s.chips = r.botStack; s.sitOut = false; } });
    const res = PK.reduce(st, { type: 'deal', seat: 0 }, () => this.rng());
    if (!res.ok) return false;
    r.st = JSON.parse(JSON.stringify(res.state)); r.spent = 0;
    W.markPlayed(now); W.countPlay(POKER_SRC);
    return this.pokerSpend(r, W, now);
  }
  // Ставки игрока этой раздачи списываются с баланса по мере роста его вклада в банк
  pokerSpend(r, W, now) {
    const total = r.st.seats[0].total;
    if (total > r.spent) {
      if (!r.free && !W.spend(total - r.spent, POKER_SRC, now)) return false;
      r.spent = total;
    }
    return true;
  }
  // Итог раздачи: выплата (с дневным пределом выигрыша против ботов) и победа в счётчик
  pokerSettle(r, W, now) {
    const me = r.st.seats[0], payout = me.total + me.net;
    let rw = { capped: false, granted: 0 };
    if (payout > 0 && !r.free) { const cr = W.capPayout(POKER_SRC, payout, r.spent, now); rw = { capped: cr.capped, granted: cr.granted }; }
    if (me.net > 0 && !r.free) W.countWin(POKER_SRC);
    r.spent = 0;
    return rw;
  }
  async pokerOp(uid, m, now) {
    const PK = this.PK, rng = () => this.rng(), key = uid + '_pk';
    const intIn = (v, lo, hi, def) => { v = Math.floor(Number(v)); return v >= lo && v <= hi ? v : def; };
    let r = await this.loadPoker(uid);
    if (m.op === 'pokerState') return { state: await this.load(uid), result: { poker: r ? this.pokerView(r) : null } };
    if (m.op === 'pokerLeave') {
      // Уход из-за стола посреди раздачи равен сбросу: поставленное остаётся в банке
      const s = await this.load(uid);
      if (r) { try { await this.ledger.commit([{ op: 'delete', coll: 'rounds', id: key }]); } catch (e) { this.forget(uid); throw fail('ledger'); } this.pokers.delete(uid); }
      return { state: s, result: { poker: null } };
    }
    let next = null, rw = null, dealt = true;
    if (m.op === 'pokerStart') {
      const size = intIn(m.size, 2, 6, 4), ante = intIn(m.ante, 1, 10000, 50), seats = [{ id: 'me', name: String(m.name || '').slice(0, 20), kind: 'human', chips: 0 }];
      // Характеры ботов: экран мог выбрать их заранее (чтобы имена за столом не менялись после раздачи), иначе случайные
      const order = this.Bots.ORDER.slice();
      for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)), t = order[k]; order[k] = order[j]; order[j] = t; }
      const picked = Array.isArray(m.styles) && m.styles.length === size - 1 && m.styles.every((x) => typeof x === 'string' && has(this.Bots.STYLES, x)) ? m.styles : null;
      for (let i = 1; i < size; i++) { const bot = this.Bots.makeBot(i), style = picked ? picked[i - 1] : order[(i - 1) % order.length]; bot.style = style; bot.name = this.Bots.STYLES[style].name; bot.chips = 0; seats.push(JSON.parse(JSON.stringify(bot))); }
      const st = JSON.parse(JSON.stringify(PK.init(seats, { variant: 'simple', tableSize: size, ante, minBet: ante * 2 }, rng)));
      const bal = (await this.load(uid)).balance;
      next = { st, size, ante, free: false, spent: 0, botStack: Math.min(bal, BOT_STACK) };
    } else {
      if (!r) throw fail('no-round');
      next = JSON.parse(JSON.stringify(r));
    }
    const st0 = next.st;
    const res = await this.mutate(uid, (W) => {
      if (m.op === 'pokerStart' || m.op === 'pokerNext') {
        if (m.op === 'pokerNext' && st0.phase !== 'settled') throw fail('bad-request');
        if (m.op === 'pokerStart') W.capStart(now);
        dealt = this.pokerDeal(next, W, now);
        if (dealt && next.st.phase === 'settled') rw = this.pokerSettle(next, W, now);       // раздача закончилась внутри deal (мало фишек): итог подводится сразу
        if (!dealt && m.op === 'pokerNext' && st0.phase !== 'settled') throw fail('bad-request');
        return;
      }
      if (PK_PHASES.indexOf(st0.phase) < 0) throw fail('bad-request');
      let action;
      if (m.op === 'pokerAct') {
        const a = m.action || {}, type = String(a.type);
        if (['fold', 'check', 'call', 'raise', 'allin'].indexOf(type) < 0 || st0.current !== 0) throw fail('bad-request');
        action = { type, seat: 0 };
        if (type === 'raise') action.amount = intIn(a.amount, 1, 1e9, 0);
      } else {
        if (st0.current <= 0) throw fail('bad-request');
        action = this.Bots.nextBotAction(st0, rng);
        const cur = st0.current;
        if (!action || !PK.reduce(st0, action, rng).ok) action = { type: st0.currentBet > st0.seats[cur].bet ? 'fold' : 'check', seat: cur };
      }
      const out = PK.reduce(st0, action, rng);
      if (!out.ok) throw fail('bad-request');
      next.st = JSON.parse(JSON.stringify(out.state));
      if (!this.pokerSpend(next, W, now)) throw fail('no-funds');
      if (next.st.phase === 'settled') rw = this.pokerSettle(next, W, now);
    }, () => (dealt ? [{ op: 'set', coll: 'rounds', id: key, data: next }] : (r ? [{ op: 'delete', coll: 'rounds', id: key }] : [])));
    if (!dealt) { this.pokers.delete(uid); return { state: res.state, result: { poker: null, broke: true } }; }
    this.pokers.set(uid, next);
    return { state: res.state, result: { poker: this.pokerView(next, rw) } };
  }

  // ---------- Топы ----------
  // Победа онлайн (вызывает manager, когда стол подвёл итог): прибавляется к счёту игрока и уходит в топ пачкой
  recordWin(uid, game) {
    if (typeof uid !== 'string' || TOP_WIN_GAMES.indexOf(game) < 0) return;
    const k = game + '|' + uid;
    this.winQ.set(k, (this.winQ.get(k) || 0) + 1);
  }
  async loadFast(uid) {
    if (this.fastBest.has(uid)) return this.fastBest.get(uid);
    let rec = null;
    try { rec = await this.ledger.get('fast', uid); } catch (e) { throw fail('ledger'); }
    const out = {};
    Object.keys(FAST_MIN).forEach((l) => { const v = rec && rec[l]; if (Number.isInteger(v) && v > 0) out[l] = v; });
    this.fastBest.set(uid, out);
    return out;
  }
  // Победа в «Сапёре» со временем: если время правдоподобно и лучше прежнего, оно запоминается и уходит в топ
  async noteFast(uid, level, time, now) {
    if (!has(FAST_MIN, level) || !Number.isInteger(time) || time < FAST_MIN[level] || time > FAST_MAX) return false;
    const start = this.msStart.get(uid);
    if (!start || (now - start) / 1000 < time - FAST_SLACK) return false;          // раньше времени партии выиграть нельзя
    const best = await this.loadFast(uid);
    if (best[level] !== undefined && best[level] <= time) return false;
    const next = Object.assign({}, best, { [level]: time });
    try { await this.ledger.commit([{ op: 'set', coll: 'fast', id: uid, data: next }]); } catch (e) { this.fastBest.delete(uid); return false; }
    this.fastBest.set(uid, next);
    this.fastQ.set(level + '|' + uid, time);
    return true;
  }
  // Отправка накопленного в топы (из того же таймера, что и рейтинг по балансу)
  async flushTops() {
    let sent = 0;
    for (const [k, n] of Array.from(this.winQ.entries())) {
      const [game, uid] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
      this.winQ.delete(k);
      try { await this.ledger.addWins(game, uid, n); sent++; } catch (e) { this.winQ.set(k, (this.winQ.get(k) || 0) + n); }
    }
    for (const [k, t] of Array.from(this.fastQ.entries())) {
      const [level, uid] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
      this.fastQ.delete(k);
      try { await this.ledger.setFast(level, uid, t); sent++; } catch (e) { if (!this.fastQ.has(k)) this.fastQ.set(k, t); }
    }
    return sent;
  }

  // ---------- Рейтинг по балансу ----------
  // Баланс в публичную строку рейтинга (ratings/{uid}) пишет сервер, а не браузер: накопившееся с задержкой и не чаще раза в RATING_MS на игрока.
  // В рейтинге стоит баланс вместе с залогами (аконы за столом никуда не делись)
  rate(uid, balance) { this.rated.set(uid, balance); }
  heldSum(uid) { let n = 0; this.holds.forEach((h) => { if (h.uid === uid) n += h.amount; }); return n; }
  async flushRatings() {
    if (!this.ledger.setRating) return 0;
    let sent = 0;
    for (const [uid, bal] of Array.from(this.rated.entries())) {
      const c = this.cache.get(uid), total = (c ? c.balance : bal) + this.heldSum(uid);
      this.rated.delete(uid);
      if (this.ratedLast.get(uid) === total) continue;
      try { await this.ledger.setRating(uid, total); this.ratedLast.set(uid, total); sent++; }
      catch (e) { if (!this.rated.has(uid)) this.rated.set(uid, bal); }      // повторим в следующий раз
    }
    return sent;
  }
  // Раз в RATING_MS отправляет накопившееся; при запуске записывает в рейтинг балансы всех игроков с кошельком (строки, присланные браузером, перекрываются)
  startRatings() {
    if (this.rateTimer || !this.ledger.setRating) return;
    this.rateTimer = setInterval(() => { this.flushRatings().catch(() => {}); if (this.ledger.addWins) this.flushTops().catch(() => {}); }, RATING_MS);
    if (this.rateTimer.unref) this.rateTimer.unref();
    this.ledger.list('wallets').then((list) => { list.forEach((w) => { if (w.data && typeof w.data.balance === 'number' && !this.rated.has(w.id)) this.rated.set(w.id, w.data.balance); }); }, () => {});
  }
  stopRatings() { if (this.rateTimer) clearInterval(this.rateTimer); this.rateTimer = null; }

  // ---------- Залоги ставок ----------
  async holdRecord(key) { return this.holds.get(key) || (await this.ledger.get('holds', key)); }
  hold(uid, code, amount) {
    amount = Math.floor(Number(amount));
    if (!(amount >= 1) || !isFinite(amount)) return Promise.reject(fail('bad-request'));
    const key = uid + '_' + code;
    return this.run(uid, async () => {
      // После сбоя записи залоги игрока забыты: перечитываем, иначе лимит залогов обходится
      if (!this.holdsLoaded) { try { await this.loadHolds(); } catch (e) { throw fail('ledger'); } }
      // Такой залог уже есть (прошлый выход ещё не оформлен или запись в хранилище была неоднозначной): новый не берём, пусть игрок попробует через секунду
      if (await this.holdRecord(key)) return { ok: false, error: 'busy', balance: this.balanceOf(uid) };
      let mine = 0; this.holds.forEach((h) => { if (h.uid === uid) mine++; });
      if (mine >= MAX_HOLDS) return { ok: false, error: 'busy', balance: this.balanceOf(uid) };
      if ((await this.load(uid)).balance < amount) return { ok: false, error: 'no-funds', balance: this.balanceOf(uid) };          // не хватает: раунд «Мин» при этом не трогаем
      // Раунд «Мин» в процессе сбрасывается (без штрафа): иначе, спрятав баланс в залог, можно было бы открыть мину, не заплатив штраф
      if (await this.loadRound(uid)) { try { await this.ledger.commit([{ op: 'delete', coll: 'rounds', id: uid }]); } catch (e) { this.forget(uid); throw fail('ledger'); } this.rounds.delete(uid); }
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
      const rec = await this.holdRecord(key);
      if (!rec) return { ok: false, balance: this.balanceOf(uid) };
      const r = await this.mutate(uid, (W) => (payout > 0 ? W.add(payout, 'stake', this.now()) : true), () => [{ op: 'delete', coll: 'holds', id: key }]);
      this.holds.delete(key);
      return { ok: true, balance: r.state.balance };
    });
  }
}

module.exports = { WalletService, SEED_CAP };
