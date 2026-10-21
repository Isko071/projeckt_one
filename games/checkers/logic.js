// Чистая логика русских шашек для двух игроков. Форма та же, что у других игр с сервером столов: init / reduce / view, без DOM и window.
// Правила: доска 8×8, играют на тёмных клетках, у каждого 12 шашек. Белые ходят первыми.
// Простая шашка ходит на одну клетку по диагонали вперёд, бьёт вперёд и назад. Дамка ходит и бьёт на любое расстояние по диагонали.
// Бить обязательно; если взятий несколько, можно выбрать любое, но начатое взятие доводится до конца (серия).
// Сбитые шашки снимаются после хода, и перепрыгнуть одну шашку дважды нельзя. Шашка, дошедшая до последнего ряда, становится дамкой,
// а если это случилось посреди взятия — продолжает бить уже как дамка. Дамка после взятия встаёт на любую свободную клетку за сбитой,
// но если с какой-то из них можно бить дальше — только на такую.
// Победа: у соперника не осталось шашек или ходов. Ничья: 30 ходов подряд (по 15 у каждого) только дамками и без взятий.
//
// Клетка: индекс y * 8 + x (y = 0 — верхний ряд, там стоят чёрные). Фигуры на доске: 0 — пусто, 1 / 2 — белая шашка / дамка, -1 / -2 — чёрная.
//   Checkers.CONFIG, Checkers.PLAYER_ACTIONS
//   Checkers.init(seats, options, rng) → состояние; seats: [{ id, name }] (двое); options.white — место, играющее белыми (иначе случайно по rng)
//   Checkers.reduce(state, action) → { ok, state, events } | { ok: false, error }
//     { type: 'move', seat, path: [откуда, куда, (куда дальше при серии взятий)...] }
//     { type: 'concede', seat }   сдаться; { type: 'leave', seat } — выход из-за стола (до конца партии тоже сдача)
//   Checkers.view(state) → вид стола (скрытого нет); Checkers.legalMoves(state) → ходы того, чья очередь: [{ path, captured }]
//   Checkers.colorOf(state, seat) → 'w' | 'b'; Checkers.waitingSeats(state), Checkers.progressKey(state, seat), Checkers.cleanAction(p)
(function (root) {
  var CONFIG = { minSeats: 2, maxSeats: 2, size: 8, drawQuiet: 30 };
  var PLAYER_ACTIONS = ['move', 'concede'];
  var N = 8, DIRS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function bad(error) { return { ok: false, error: error }; }
  function on(x, y) { return x >= 0 && y >= 0 && x < N && y < N; }
  function dark(i) { return ((i % N) + Math.floor(i / N)) % 2 === 1; }

  function startBoard() {
    var b = [];
    for (var i = 0; i < N * N; i++) {
      var y = Math.floor(i / N);
      b.push(!dark(i) ? 0 : (y <= 2 ? -1 : (y >= 5 ? 1 : 0)));
    }
    return b;
  }

  function init(seats, options, rng) {
    options = options || {};
    var white = options.white === 0 || options.white === 1 ? options.white : ((rng || Math.random)() < 0.5 ? 0 : 1);
    var list = (seats || []).slice(0, 2).map(function (s) { return { id: s.id, name: s.name || '', active: true }; });
    return { v: 1, board: startBoard(), white: white, current: white, turns: 0, quiet: 0, gameOver: false, reason: '', winner: -1, last: null, seats: list };
  }

  function colorOf(state, seat) { return seat === state.white ? 'w' : 'b'; }
  function sideOf(state, seat) { return seat === state.white ? 1 : -1; }      // знак фигур этого игрока
  function seatOfSide(state, side) { return side === 1 ? state.white : 1 - state.white; }
  function lastRow(side) { return side === 1 ? 0 : N - 1; }

  // Все серии взятий фигуры с клетки from (доска с этой фигурой на месте; сбитые пока стоят и перепрыгивать их снова нельзя)
  function captures(board, from, side, king) {
    var out = [];
    (function walk(pos, isKing, path, taken) {
      var x0 = pos % N, y0 = Math.floor(pos / N), found = false;
      DIRS.forEach(function (d) {
        if (isKing) {
          var x = x0 + d[0], y = y0 + d[1];
          while (on(x, y) && board[y * N + x] === 0) { x += d[0]; y += d[1]; }
          if (!on(x, y)) return;
          var over = y * N + x;
          if (board[over] * side >= 0 || taken.indexOf(over) >= 0) return;
          var lands = [], lx = x + d[0], ly = y + d[1];
          while (on(lx, ly) && board[ly * N + lx] === 0) { lands.push(ly * N + lx); lx += d[0]; ly += d[1]; }
          if (!lands.length) return;
          // после взятия дамка встаёт только туда, откуда бьёт дальше, если такие клетки есть
          var cont = lands.filter(function (l) { return canCaptureFrom(board, l, side, true, taken.concat(over)); });
          (cont.length ? cont : lands).forEach(function (l) { found = true; walk(l, true, path.concat(l), taken.concat(over)); });
        } else {
          var ox = x0 + d[0], oy = y0 + d[1], tx = x0 + 2 * d[0], ty = y0 + 2 * d[1];
          if (!on(tx, ty)) return;
          var o = oy * N + ox, t = ty * N + tx;
          if (board[o] * side >= 0 || taken.indexOf(o) >= 0 || board[t] !== 0) return;
          found = true;
          walk(t, ty === lastRow(side), path.concat(t), taken.concat(o));          // дошла до последнего ряда — дальше бьёт как дамка
        }
      });
      if (!found && taken.length) out.push({ path: path, captured: taken });
    })(from, king, [from], []);
    return out;
  }
  // Есть ли взятие с клетки pos (для выбора, куда встать дамке)
  function canCaptureFrom(board, pos, side, king, taken) {
    var x0 = pos % N, y0 = Math.floor(pos / N);
    return DIRS.some(function (d) {
      if (king) {
        var x = x0 + d[0], y = y0 + d[1];
        while (on(x, y) && board[y * N + x] === 0) { x += d[0]; y += d[1]; }
        if (!on(x, y)) return false;
        var over = y * N + x;
        if (board[over] * side >= 0 || taken.indexOf(over) >= 0) return false;
        return on(x + d[0], y + d[1]) && board[(y + d[1]) * N + x + d[0]] === 0;
      }
      var tx = x0 + 2 * d[0], ty = y0 + 2 * d[1];
      if (!on(tx, ty)) return false;
      var o = (y0 + d[1]) * N + x0 + d[0];
      return board[o] * side < 0 && taken.indexOf(o) < 0 && board[ty * N + tx] === 0;
    });
  }

  // Ходы стороны side на доске board: если есть взятия — только они
  function movesOf(board, side) {
    var caps = [], quiet = [];
    for (var i = 0; i < N * N; i++) {
      var p = board[i];
      if (p * side <= 0) continue;
      var king = Math.abs(p) === 2;
      // фигура, которая ходит, на время поиска снимается с доски: дамка может пройти через свою начальную клетку
      var b = board.slice(); b[i] = 0;
      captures(b, i, side, king).forEach(function (c) { caps.push(c); });
      if (caps.length) continue;
      var x0 = i % N, y0 = Math.floor(i / N);
      DIRS.forEach(function (d) {
        if (!king && d[1] !== -side) return;                 // простая ходит только вперёд (белые вверх, чёрные вниз)
        var x = x0 + d[0], y = y0 + d[1];
        while (on(x, y) && board[y * N + x] === 0) {
          quiet.push({ path: [i, y * N + x], captured: [] });
          if (!king) break;
          x += d[0]; y += d[1];
        }
      });
    }
    return caps.length ? caps : quiet;
  }
  function legalMoves(state) {
    if (state.gameOver || state.current < 0) return [];
    return movesOf(state.board, sideOf(state, state.current));
  }

  function finish(ns, winner, reason, events) {
    ns.gameOver = true; ns.winner = winner; ns.reason = reason; ns.current = -1;
    events.push({ type: 'over', winner: winner, reason: reason });
  }

  function reduce(state, action) {
    if (!action || typeof action !== 'object') return bad('bad-action');
    var seat = action.seat;
    if (seat !== 0 && seat !== 1) return bad('bad-seat');
    if (state.gameOver) {
      if (action.type !== 'leave' || !state.seats[seat] || !state.seats[seat].active) return bad('game-over');
      var gone = clone(state); gone.seats[seat].active = false;           // ушёл после конца партии: места за столом больше нет
      return { ok: true, state: gone, events: [] };
    }
    if (!state.seats[seat] || !state.seats[seat].active) return bad('not-seated');
    var ns = clone(state), events = [];
    if (action.type === 'concede' || action.type === 'leave') {
      if (action.type === 'leave') ns.seats[seat].active = false;
      finish(ns, 1 - seat, action.type === 'leave' ? 'left' : 'concede', events);
      return { ok: true, state: ns, events: events };
    }
    if (action.type !== 'move') return bad('unknown-action');
    if (state.current !== seat) return bad('not-your-turn');
    var path = action.path;
    if (!Array.isArray(path) || path.length < 2) return bad('bad-move');
    var mv = legalMoves(state).filter(function (m) { return m.path.length === path.length && m.path.every(function (c, k) { return c === path[k]; }); })[0];
    if (!mv) return bad('illegal');
    var side = sideOf(state, seat), from = path[0], to = path[path.length - 1], piece = ns.board[from], wasMan = Math.abs(piece) === 1;
    ns.board[from] = 0;
    mv.captured.forEach(function (c) { ns.board[c] = 0; });
    var crowned = false;
    // шашка становится дамкой, если прошла последний ряд хоть раз за ход (при взятии могла бить дальше уже дамкой)
    if (wasMan && mv.path.slice(1).some(function (c) { return Math.floor(c / N) === lastRow(side); })) { piece = 2 * side; crowned = true; }
    ns.board[to] = piece;
    ns.turns += 1;
    ns.quiet = mv.captured.length || wasMan ? 0 : ns.quiet + 1;
    ns.last = { seat: seat, path: mv.path.slice(), captured: mv.captured.slice(), crowned: crowned };
    events.push({ type: 'move', seat: seat, path: mv.path, captured: mv.captured, crowned: crowned });
    var foe = 1 - seat;
    ns.current = foe;
    var foeSide = -side, left = ns.board.some(function (p) { return p * foeSide > 0; });
    if (!left) finish(ns, seat, 'pieces', events);
    else if (!movesOf(ns.board, foeSide).length) finish(ns, seat, 'blocked', events);
    else if (ns.quiet >= CONFIG.drawQuiet) finish(ns, -1, 'draw', events);
    return { ok: true, state: ns, events: events };
  }

  function view(state) { return clone(state); }
  function waitingSeats(state) { return state.gameOver || state.current < 0 ? [] : [state.current]; }
  function progressKey(state, seat) { return state.turns + ':' + state.current + ':' + (seat === state.current ? 1 : 0); }
  function cleanAction(p) {
    var out = { type: p.type };
    if (Array.isArray(p.path)) out.path = p.path.slice(0, 16).map(function (c) { return Math.floor(Number(c)); });
    return out;
  }
  // Сколько фигур у стороны: { men, kings }
  function count(state, seat) {
    var side = sideOf(state, seat), men = 0, kings = 0;
    state.board.forEach(function (p) { if (p === side) men++; else if (p === 2 * side) kings++; });
    return { men: men, kings: kings };
  }

  root.Checkers = {
    CONFIG: CONFIG, PLAYER_ACTIONS: PLAYER_ACTIONS, init: init, reduce: reduce, view: view, legalMoves: legalMoves, movesOf: movesOf,
    colorOf: colorOf, sideOf: sideOf, seatOfSide: seatOfSide, waitingSeats: waitingSeats, progressKey: progressKey, cleanAction: cleanAction, count: count, dark: dark, startBoard: startBoard
  };
})(typeof window !== 'undefined' ? window : globalThis);
