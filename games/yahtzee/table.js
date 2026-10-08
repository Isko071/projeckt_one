// Ятзи за онлайн-столом на 2–6 игроков: чистая логика в форме init / reduce / view (как у блэкджека, см. docs/multiplayer.md).
// Два режима:
//   'turns' — по очереди: ходит один игрок, остальные ждут;
//   'sync'  — одновременно: все бросают и записывают очки каждый в своём темпе, но следующий раунд (клетка) начинается,
//             только когда все активные игроки записали очки в текущем раунде.
// Кубики у каждого игрока свои, их видят все (скрытой информации в «Ятзи» нет). Броски делает ведущий стола (rng), поэтому подтасовать нельзя.
// Зависит от logic.js (глобальный объект Yahtzee), без обращений к window и document.
(function (root) {
  var Y = root.Yahtzee;
  var CONFIG = { minSeats: 2, maxSeats: 6, modes: ['turns', 'sync'] };
  var PLAYER_ACTIONS = ['roll', 'hold', 'score'];
  var FRESH_DICE = [1, 1, 1, 1, 1];

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function filled(p) { return Y.CATEGORIES.length - Y.openCategories(p).length; }
  function activeSeats(st) { var out = []; st.players.forEach(function (p, i) { if (p.active) out.push(i); }); return out; }

  function makePlayer(seat) {
    var p = Y.createPlayer(seat.name || '');
    p.id = seat.id; p.active = true; p.done = false;
    p.dice = FRESH_DICE.slice(); p.held = [false, false, false, false, false]; p.rollsUsed = 0;
    return p;
  }

  // seats: [{ id, name }], options: { mode: 'turns' | 'sync' }
  function init(seats, options) {
    var mode = options && options.mode === 'sync' ? 'sync' : 'turns';
    var list = seats.slice(0, CONFIG.maxSeats);
    return { mode: mode, round: 1, current: mode === 'turns' ? 0 : -1, gameOver: false, reason: '', players: list.map(makePlayer) };
  }

  function canAct(st, seat) {
    var p = st.players[seat];
    if (!p || !p.active || st.gameOver) return false;
    return st.mode === 'turns' ? st.current === seat : !p.done;
  }

  function nextActive(st, from) {
    var n = st.players.length;
    for (var k = 1; k <= n; k++) { var i = (from + k) % n; if (st.players[i].active && !Y.isPlayerDone(st.players[i])) return i; }
    return -1;
  }

  // После любого изменения: конец игры, смена хода или нового раунда
  function settle(st) {
    var act = activeSeats(st);
    if (act.length < 2) { st.gameOver = true; st.reason = 'alone'; st.current = -1; }
    else if (act.every(function (i) { return Y.isPlayerDone(st.players[i]); })) { st.gameOver = true; st.reason = 'finished'; st.current = -1; }
    if (st.gameOver) return;
    if (st.mode === 'turns') {
      var cur = st.players[st.current];
      if (!cur || !cur.active || cur.done) st.current = nextActive(st, Math.max(0, st.current));
    } else if (act.every(function (i) { return st.players[i].done || Y.isPlayerDone(st.players[i]); })) {
      // все записали очки: запоминаем, кто куда записал (окно «Раунд завершён»), и начинаем следующий раунд
      var rows = act.filter(function (i) { return st.players[i].done && st.players[i].last; }).map(function (i) { return { seat: i, cat: st.players[i].last.cat, pts: st.players[i].last.pts }; });
      st.recapId = (st.recapId || 0) + 1;
      st.recap = { id: st.recapId, round: Math.max.apply(null, act.map(function (i) { return filled(st.players[i]); })), rows: rows };
      act.forEach(function (i) { st.players[i].done = false; });
    }
    var least = Math.min.apply(null, act.map(function (i) { return filled(st.players[i]); }));
    st.round = Math.min(Y.CATEGORIES.length, (st.mode === 'turns' && st.current >= 0 ? filled(st.players[st.current]) : least) + 1);
  }

  function endTurn(st, seat) {
    var p = st.players[seat];
    p.dice = FRESH_DICE.slice(); p.held = [false, false, false, false, false]; p.rollsUsed = 0;
    p.done = true;
    if (st.mode === 'turns') { st.current = nextActive(st, seat); p.done = false; }
  }

  function doRoll(p, rng) {
    if (p.rollsUsed >= Y.MAX_ROLLS) return false;
    if (p.rollsUsed === 0) p.held = [false, false, false, false, false];
    for (var i = 0; i < 5; i++) if (!p.held[i]) p.dice[i] = 1 + Math.floor(rng() * 6);
    p.rollsUsed++;
    return true;
  }

  function doScore(st, seat, cat) {
    var p = st.players[seat];
    if (p.rollsUsed < 1 || Y.allowedCategories(p, p.dice).indexOf(cat) < 0) return false;
    var pts = Y.possibleScore(p, cat, p.dice);
    if (Y.earnsYahtzeeBonus(p, p.dice)) p.yahtzeeBonuses++;
    p.scores[cat] = pts;
    p.last = { cat: cat, pts: pts };           // куда игрок записал очки в этом раунде (для окна итогов раунда)
    endTurn(st, seat);
    return true;
  }

  // Результат: { ok, state, error }
  function reduce(state, action, rng) {
    rng = rng || Math.random;
    var st = clone(state), seat = action && action.seat, p = st.players[seat];
    function bad(error) { return { ok: false, error: error, state: state }; }
    if (!action || !p) return bad('bad-seat');
    if (action.type === 'leave') {
      if (!p.active) return bad('not-active');
      p.active = false;
      if (!st.gameOver) settle(st);          // после конца игры итог уже подведён
      return { ok: true, state: st };
    }
    if (st.gameOver) return bad('game-over');
    if (!canAct(st, seat)) return bad('not-your-turn');
    if (action.type === 'roll') {
      // фиксация кубиков копится на экране игрока и приходит вместе с броском: так нет задержки сети на каждое нажатие
      if (Array.isArray(action.held) && action.held.length === 5 && p.rollsUsed >= 1 && p.rollsUsed < Y.MAX_ROLLS) p.held = action.held.map(Boolean);
      if (!doRoll(p, rng)) return bad('no-rolls');
    } else if (action.type === 'hold') {
      var i = action.index;
      if (typeof i !== 'number' || i < 0 || i > 4 || i !== Math.floor(i) || p.rollsUsed < 1 || p.rollsUsed >= Y.MAX_ROLLS) return bad('bad-hold');
      p.held[i] = !p.held[i];
    } else if (action.type === 'score') {
      if (!doScore(st, seat, action.cat)) return bad('bad-category');
    } else return bad('bad-action');
    settle(st);
    return { ok: true, state: st };
  }

  // Что видит стол: всё состояние (кубики открыты) без служебных полей
  function view(state) { return clone(state); }

  // Места, от которых сейчас ждут действие
  function waitingSeats(st) {
    if (st.gameOver) return [];
    return activeSeats(st).filter(function (i) { return canAct(st, i); });
  }

  // Ключ «прогресса» места: пока он не меняется, игрок «молчит»
  function progressKey(st, seat) {
    var p = st.players[seat];
    return st.mode + ':' + filled(p) + ':' + p.rollsUsed + ':' + p.held.map(function (h) { return h ? 1 : 0; }).join('');
  }

  // Итоги: по убыванию очков; победители помечены (если все вышли, кроме одного, победил он)
  function standings(st) {
    var rows = st.players.map(function (p, i) { return { seat: i, name: p.name, total: Y.totalScore(p), active: p.active, winner: false }; });
    var pool = st.reason === 'alone' ? rows.filter(function (r) { return r.active; }) : rows;
    var max = Math.max.apply(null, pool.map(function (r) { return r.total; }));
    pool.forEach(function (r) { r.winner = r.total === max; });
    return rows.sort(function (a, b) { return b.total - a.total; });
  }

  root.YahtzeeTable = { CONFIG: CONFIG, PLAYER_ACTIONS: PLAYER_ACTIONS, init: init, reduce: reduce, view: view, waitingSeats: waitingSeats, progressKey: progressKey, canAct: canAct, standings: standings };
})(typeof window !== 'undefined' ? window : globalThis);
