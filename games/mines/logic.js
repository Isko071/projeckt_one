// Чистая логика игры «Мины»: поле 5×5 (25 клеток), игрок выбирает число мин от 1 до 24 и открывает клетки по одной.
// Каждая безопасная клетка приносит аконы. При 1–4 минах каждая клетка стоит 50. При 5–24 минах цена растёт: первая клетка стоит 50 + 10 за каждую мину сверх четырёх
// (5 мин — 60, 12 — 130, 24 — 250), и каждая следующая открытая клетка в раунде на 20 дороже предыдущей.
// Попал на мину — накопленное за раунд сгорает и с баланса списывается штраф: 700 аконов при 1–10 минах (лёгкое поле, награда мала) и 200 при 11–24. Чтобы играть, на балансе должно быть не меньше штрафа. Дневного предела наград нет. Забрать накопленное можно в любой момент после первой клетки;
// если открыты все безопасные клетки, накопленное забирается само.
// Без window и document: тестируется в node. Мины раскладываются сразу при начале раунда (rng — функция 0..1).
//
//   Mines.init(mines, rng)              → состояние раунда
//   Mines.reduce(state, action)         → { ok, state, events } | { ok: false, error };  action: { type: 'open', index } | { type: 'cashout' }
//   Mines.view(state)                   → то, что видно игроку: мины открыты только после конца раунда
//   Mines.rewardFor(mines, n) — цена n-й клетки раунда, Mines.cellReward(mines) — первой, Mines.safeCells(mines), Mines.maxReward(mines), Mines.lossFor(mines) — штраф за мину
//   status: 'playing' | 'lost' | 'cashed' | 'cleared';  payout — сколько аконов раунд принёс (0 при проигрыше)
(function (root) {
  var CONFIG = { size: 5, cells: 25, minMines: 1, maxMines: 24, baseReward: 50, flatMax: 4, perMineStep: 10, cellStep: 20, lossLow: 700, lossHigh: 200, lowMax: 10 };

  function bad(error) { return { ok: false, error: error }; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function clampMines(n) { n = Math.floor(Number(n)); return isFinite(n) ? Math.max(CONFIG.minMines, Math.min(CONFIG.maxMines, n)) : CONFIG.minMines; }

  // Цена n-й открытой безопасной клетки раунда (n с единицы)
  function rewardFor(mines, n) {
    mines = clampMines(mines);
    if (mines <= CONFIG.flatMax) return CONFIG.baseReward;
    return CONFIG.baseReward + CONFIG.perMineStep * (mines - CONFIG.flatMax) + CONFIG.cellStep * (Math.max(1, Math.floor(n) || 1) - 1);
  }
  function cellReward(mines) { return rewardFor(mines, 1); }                 // цена первой клетки
  function safeCells(mines) { return CONFIG.cells - clampMines(mines); }
  function maxReward(mines) { var s = 0; for (var n = 1; n <= safeCells(mines); n++) s += rewardFor(mines, n); return s; }
  function lossFor(mines) { return clampMines(mines) <= CONFIG.lowMax ? CONFIG.lossLow : CONFIG.lossHigh; }

  function init(mines, rng) {
    mines = clampMines(mines);
    rng = rng || Math.random;
    var idx = [], layout = [], i;
    for (i = 0; i < CONFIG.cells; i++) { idx.push(i); layout.push(false); }
    for (i = idx.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    for (i = 0; i < mines; i++) layout[idx[i]] = true;
    var opened = []; for (i = 0; i < CONFIG.cells; i++) opened.push(false);
    return { v: 1, mines: mines, layout: layout, opened: opened, openedCount: 0, earned: 0, status: 'playing', hit: -1, payout: 0 };
  }

  function reduce(state, action) {
    if (!action || typeof action !== 'object') return bad('bad-action');
    if (state.status !== 'playing') return bad('round-over');
    var ns = clone(state), events = [];
    if (action.type === 'open') {
      var i = Number(action.index);
      if (!isFinite(i) || Math.floor(i) !== i || i < 0 || i >= CONFIG.cells) return bad('bounds');
      if (ns.opened[i]) return bad('already-open');
      ns.opened[i] = true;
      if (ns.layout[i]) {
        ns.status = 'lost'; ns.hit = i; ns.payout = 0;
        events.push({ type: 'mine', index: i, lost: ns.earned });
        return { ok: true, state: ns, events: events };
      }
      ns.openedCount++; ns.earned += rewardFor(ns.mines, ns.openedCount);
      events.push({ type: 'safe', index: i, earned: ns.earned });
      if (ns.openedCount >= safeCells(ns.mines)) { ns.status = 'cleared'; ns.payout = ns.earned; events.push({ type: 'cleared', payout: ns.payout }); }
      return { ok: true, state: ns, events: events };
    }
    if (action.type === 'cashout') {
      if (ns.openedCount < 1) return bad('nothing-to-take');
      ns.status = 'cashed'; ns.payout = ns.earned;
      events.push({ type: 'cashed', payout: ns.payout });
      return { ok: true, state: ns, events: events };
    }
    return bad('bad-action');
  }

  // Вид для игрока: пока раунд идёт, места мин не видны (опасные клетки скрыты)
  function view(state) {
    var over = state.status !== 'playing';
    return {
      v: state.v, mines: state.mines, opened: state.opened.slice(), openedCount: state.openedCount, earned: state.earned, status: state.status, hit: state.hit, payout: state.payout,
      next: rewardFor(state.mines, state.openedCount + 1), left: safeCells(state.mines) - state.openedCount, layout: over ? state.layout.slice() : null
    };
  }

  root.Mines = { CONFIG: CONFIG, init: init, reduce: reduce, view: view, cellReward: cellReward, rewardFor: rewardFor, safeCells: safeCells, maxReward: maxReward, lossFor: lossFor, clampMines: clampMines };
})(typeof window !== 'undefined' ? window : globalThis);
