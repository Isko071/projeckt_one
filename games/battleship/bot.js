// Бот «Морского боя»: выбирает ход по тому, что видит игрок (отметки на поле соперника и число его уцелевших кораблей), скрытого не знает.
//   BattleshipBot.choose(view, seat, level, rng) → { type, seat, x, y }; view = Battleship.view(state, seat); level: 'easy' | 'expert'
//   Лёгкий: стреляет наугад, после попадания добивает по соседним клеткам, иногда применяет оружие в случайном месте.
//   Эксперт: считает, в скольких расстановках оставшихся кораблей занята каждая клетка (раненые и найденные радаром клетки сильно повышают вес),
//   стреляет в самую вероятную; радар, бомбардировщик и подлодку ставит туда, где суммарный вес выше всего.
(function (root) {
  var LEVELS = ['easy', 'expert'];

  function free(marks) { var out = []; marks.forEach(function (m, i) { if (m === 0 || m === 4) out.push(i); }); return out; }
  function pickOf(list, rng) { return list[Math.floor(rng() * list.length)]; }
  function act(type, seat, idx, size) { return { type: type, seat: seat, x: idx % size, y: Math.floor(idx / size) }; }
  function available(arsenal) { return ['radar', 'sub', 'bomber'].filter(function (w) { return arsenal && arsenal[w] > 0; }); }

  function easy(view, seat, rng) {
    var size = view.size, foe = view.seats[1 - seat], marks = foe.marks, arm = view.seats[seat].arsenal, near = [];
    marks.forEach(function (m, h) {
      if (m !== 2) return;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var x = h % size + d[0], y = Math.floor(h / size) + d[1], i = y * size + x;
        if (x >= 0 && y >= 0 && x < size && y < size && (marks[i] === 0 || marks[i] === 4)) near.push(i);
      });
    });
    var pool = near.length ? near : free(marks), idx = pickOf(pool, rng), avail = available(arm);
    if (avail.length && !near.length && rng() < 0.3) return act(pickOf(avail, rng), seat, idx, size);
    return act('shoot', seat, idx, size);
  }

  // Вес каждой клетки: сколько расстановок оставшихся кораблей её занимает (раненые клетки в расстановке повышают вес в разы)
  function density(view, seat) {
    var size = view.size, foe = view.seats[1 - seat], marks = foe.marks, w = marks.map(function () { return 0; }), lens = [];
    Object.keys(foe.left || {}).forEach(function (len) { for (var k = 0; k < foe.left[len]; k++) lens.push(Number(len)); });
    lens.forEach(function (len) {
      [[1, 0], [0, 1]].forEach(function (d) {
        for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
          var cells = [], ok = true, hits = 0, seen = 0;
          for (var i = 0; i < len && ok; i++) {
            var cx = x + d[0] * i, cy = y + d[1] * i;
            if (cx >= size || cy >= size) { ok = false; break; }
            var c = cy * size + cx, m = marks[c];
            if (m === 1 || m === 3) ok = false; else { cells.push(c); if (m === 2) hits++; if (m === 4) seen++; }
          }
          if (!ok) continue;
          var weight = Math.pow(40, hits) * Math.pow(12, seen);
          cells.forEach(function (c) { if (marks[c] === 0 || marks[c] === 4) w[c] += weight; });
        }
      });
    });
    return w;
  }
  function best(indexes, score, rng) {
    var top = -1, tied = [];
    indexes.forEach(function (i) { var s = score(i); if (s > top + 1e-9) { top = s; tied = [i]; } else if (Math.abs(s - top) <= 1e-9) tied.push(i); });
    return pickOf(tied, rng);
  }

  function expert(view, seat, rng) {
    var size = view.size, foe = view.seats[1 - seat], marks = foe.marks, arm = view.seats[seat].arsenal, dens = density(view, seat);
    var pending = marks.some(function (m) { return m === 2; }), cand = free(marks), avail = available(arm);
    function area(idx) {
      var x = idx % size, y = Math.floor(idx / size), s = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) s += dens[ny * size + nx];
      }
      return s;
    }
    var all = marks.map(function (m, i) { return i; });
    if (avail.indexOf('bomber') >= 0 && rng() < 0.55) return act('bomber', seat, best(all, area, rng), size);
    if (!pending && avail.indexOf('radar') >= 0 && rng() < 0.5) return act('radar', seat, best(all, area, rng), size);
    if (!pending && avail.indexOf('sub') >= 0 && rng() < 0.4) {
      var col = function (idx) { var x = idx % size, s = 0; for (var y = 0; y < size; y++) s += dens[y * size + x]; return s; };
      return act('sub', seat, best(cand, function (i) { return col(i) * 1000 + dens[i]; }, rng), size);
    }
    var seen = cand.filter(function (i) { return marks[i] === 4; });         // радар уже нашёл здесь корабль: бьём наверняка
    return act('shoot', seat, best(seen.length ? seen : cand, function (i) { return dens[i]; }, rng), size);
  }

  function choose(view, seat, level, rng) {
    rng = rng || Math.random;
    return level === 'expert' ? expert(view, seat, rng) : easy(view, seat, rng);
  }

  root.BattleshipBot = { LEVELS: LEVELS, choose: choose, density: density };
})(typeof window !== 'undefined' ? window : globalThis);
