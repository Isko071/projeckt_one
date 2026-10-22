// Компьютерный соперник для шашек. Работает только с видом стола (Checkers.view) и ходами по правилам (Checkers.movesOf).
//   CheckersBot.choose(view, seat, level, rng, ms) → { type: 'move', seat, path }
//   level: 'easy' — почти наугад (взятия обязательны и так, из них берёт побольше); 'medium' — на 3 полухода вперёд, иногда ошибается;
//          'expert' (на экране «Сложный») — перебор вглубь, сколько успеет за 0,8 с (альфа-бета)
(function (root) {
  var C = root.Checkers, N = 8;

  function apply(board, mv, side) {
    var b = board.slice(), from = mv.path[0], to = mv.path[mv.path.length - 1], p = b[from];
    b[from] = 0;
    mv.captured.forEach(function (c) { b[c] = 0; });
    var last = side === 1 ? 0 : N - 1;
    if (Math.abs(p) === 1 && mv.path.slice(1).some(function (c) { return Math.floor(c / N) === last; })) p = 2 * side;
    b[to] = p;
    return b;
  }
  // Оценка позиции для стороны side: материал (дамка втрое дороже), продвижение простых, центр, охрана своего последнего ряда
  function evaluate(board, side) {
    var s = 0;
    for (var i = 0; i < N * N; i++) {
      var p = board[i];
      if (!p) continue;
      var own = p * side > 0 ? 1 : -1, y = Math.floor(i / N), x = i % N, v;
      if (Math.abs(p) === 2) v = 300;
      else {
        var adv = p > 0 ? (N - 1 - y) : y;                      // сколько рядов прошла простая
        v = 100 + adv * 4 + ((p > 0 && y === N - 1) || (p < 0 && y === 0) ? 6 : 0);
      }
      if (x >= 2 && x <= 5 && y >= 2 && y <= 5) v += 4;
      s += own * v;
    }
    return s;
  }

  // Перебор «за себя / за соперника»; после заданной глубины продолжаем только взятия (иначе бот не видит размен), но не дальше 6 полуходов
  function search(board, side, depth, alpha, beta, budget) {
    var moves = C.movesOf(board, side);
    if (!moves.length) return -100000 + (10 - depth);           // ходов нет — проигрыш (чем позже, тем лучше для проигрывающего)
    if (--budget.left <= 0 || ((budget.left & 255) === 0 && Date.now() > budget.until)) budget.left = 0;
    if ((depth <= 0 && !moves[0].captured.length) || depth <= -6 || budget.left <= 0) return evaluate(board, side);
    moves.sort(function (a, b) { return b.captured.length - a.captured.length; });
    for (var k = 0; k < moves.length; k++) {
      var v = -search(apply(board, moves[k], side), -side, depth - 1, -beta, -alpha, budget);
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return alpha;
  }

  // Перебор с углублением: глубина растёт, пока хватает времени (ms) и не больше maxDepth; оценки ходов последней досчитанной глубины
  function scoreMoves(board, side, moves, ms, maxDepth) {
    var best = null, budget = { left: 400000, until: Date.now() + ms };
    for (var depth = 2; depth <= maxDepth; depth++) {
      var scored = [];
      for (var k = 0; k < moves.length; k++) scored.push({ m: moves[k], v: -search(apply(board, moves[k], side), -side, depth - 1, -1e9, 1e9, budget) });
      if (budget.left <= 0 && best) break;                      // глубина не досчитана: оставляем прошлый результат
      best = scored;
      var top = Math.max.apply(null, scored.map(function (x) { return x.v; }));
      if (budget.left <= 0 || Math.abs(top) > 50000) break;
    }
    return best;
  }
  // Случайный из ходов, которые не хуже лучшего больше чем на slack (чтобы партии не повторялись, а средний иногда ошибался)
  function pickNear(scored, slack, rng) {
    var top = Math.max.apply(null, scored.map(function (x) { return x.v; }));
    var pool = scored.filter(function (x) { return x.v >= top - slack; });
    return pool[Math.floor(rng() * pool.length)].m;
  }

  // level: 'easy' — лёгкий, 'medium' — средний, 'expert' — сложный. ms — сколько можно думать сложному (по умолчанию 800 мс)
  function choose(view, seat, level, rng, ms) {
    rng = rng || Math.random;
    var side = C.sideOf(view, seat), moves = C.movesOf(view.board, side);
    if (!moves.length) return { type: 'concede', seat: seat };
    var pick;
    if (moves.length === 1) pick = moves[0];
    else if (level === 'expert') pick = pickNear(scoreMoves(view.board, side, moves, ms || 800, 12), 2, rng);
    else if (level === 'medium') {
      // средний: смотрит на 3 полухода вперёд (и доигрывает размены), выбирает из почти равных; иногда (каждый пятый ход) играет небрежнее
      pick = pickNear(scoreMoves(view.board, side, moves, 150, 3), rng() < 0.2 ? 60 : 8, rng);
    } else {
      // лёгкий: из взятий берёт самое длинное, иначе случайный ход; иногда (каждый третий) — без раздумий
      var max = Math.max.apply(null, moves.map(function (m) { return m.captured.length; }));
      var pool = rng() < 0.67 ? moves.filter(function (m) { return m.captured.length === max; }) : moves;
      pick = pool[Math.floor(rng() * pool.length)];
    }
    return { type: 'move', seat: seat, path: pick.path.slice() };
  }

  root.CheckersBot = { choose: choose, evaluate: evaluate };
})(typeof window !== 'undefined' ? window : globalThis);
