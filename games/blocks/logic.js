// Чистая логика игры «Блоки»: поле 8×8, три фигуры на выбор, заполненные ряды и столбцы исчезают, комбо за очистку подряд.
// Без обращений к window и document; случайность передаётся параметром rng (функция, возвращающая число от 0 до 1).
//
// Поле: массив 64 клеток (индекс y * 8 + x), 0 — пусто, 1…7 — цвет занятой клетки.
// Фигура: { id, cells: [[dx, dy], …], color } — клетки от левого верхнего угла фигуры.
//   Blocks.create(rng) → состояние { grid, tray: [фигура | null] ×3, score, combo, quiet, moves, over, got, nextColor }
//   Blocks.canPlace(grid, piece, x, y) — помещается ли фигура левым верхним углом в клетку (x, y)
//   Blocks.place(state, slot, x, y, rng) → { ok, state, placed: [клетки], cleared: { rows, cols, cells }, gained, combo } | { ok: false }
//   Blocks.fitsAnywhere(grid, piece), Blocks.lineScore(lines, combo), Blocks.sanitize(raw), Blocks.plain(state)
//   Blocks.MILESTONES — очки, за которые в партии даётся награда (один раз за партию каждая)
(function (root) {
  var N = 8, COMBO_KEEP = 3, MILESTONES = [1000, 2500, 5000];

  // Набор фигур (как в похожих играх): линии 2–5, квадраты 2×2 и 3×3, прямоугольники 2×3, уголки, Г, Т, S/Z.
  // weight — насколько часто выпадает: крупные и неудобные реже
  var SHAPES = [];
  function add(id, rows, weight) {
    var cells = [];
    rows.forEach(function (row, y) { for (var x = 0; x < row.length; x++) if (row.charAt(x) === '#') cells.push([x, y]); });
    SHAPES.push({ id: id, cells: cells, weight: weight });
  }
  // Повороты на 90°: из одной записи получаются все различные положения
  function rotations(id, rows, weight) {
    var seen = {}, cur = rows, from = SHAPES.length;
    for (var r = 0; r < 4; r++) {
      var key = cur.join('/');
      if (!seen[key]) { seen[key] = true; add(id + r, cur, weight); }
      var h = cur.length, w = cur[0].length, next = [];
      for (var x = 0; x < w; x++) { var line = ''; for (var y = h - 1; y >= 0; y--) line += cur[y].charAt(x); next.push(line); }
      cur = next;
    }
    for (var k = from; k < SHAPES.length; k++) SHAPES[k].weight = weight / (SHAPES.length - from);     // все положения вместе выпадают как одна фигура
  }
  add('dot', ['#'], 2);
  rotations('i2', ['##'], 3);
  rotations('i3', ['###'], 3);
  rotations('i4', ['####'], 2);
  rotations('i5', ['#####'], 1.5);
  add('o2', ['##', '##'], 3);
  add('o3', ['###', '###', '###'], 1.2);
  rotations('r23', ['###', '###'], 1.5);
  rotations('c2', ['#.', '##'], 2);
  rotations('c3', ['#..', '#..', '###'], 1.2);
  rotations('l', ['#.', '#.', '##'], 1.5);
  rotations('j', ['.#', '.#', '##'], 1.5);
  rotations('t', ['###', '.#.'], 1.5);
  rotations('s', ['.##', '##.'], 1.2);
  rotations('z', ['##.', '.##'], 1.2);
  var TOTAL = SHAPES.reduce(function (a, s) { return a + s.weight; }, 0);

  function randomPiece(state, rng) {
    var r = rng() * TOTAL, k = 0;
    while (k < SHAPES.length - 1 && r >= SHAPES[k].weight) { r -= SHAPES[k].weight; k++; }
    var color = state.nextColor % 7 + 1;
    state.nextColor = (state.nextColor + 1 + Math.floor(rng() * 3)) % 7;
    return { id: SHAPES[k].id, cells: SHAPES[k].cells.map(function (c) { return c.slice(); }), color: color };
  }
  function canPlace(grid, piece, x, y) {
    if (!piece) return false;
    for (var i = 0; i < piece.cells.length; i++) {
      var cx = x + piece.cells[i][0], cy = y + piece.cells[i][1];
      if (cx < 0 || cy < 0 || cx >= N || cy >= N || grid[cy * N + cx]) return false;
    }
    return true;
  }
  function fitsAnywhere(grid, piece) {
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) if (canPlace(grid, piece, x, y)) return true;
    return false;
  }
  // Поставить фигуру на копию поля и убрать заполненные линии → { grid, lines }
  function applyVirtual(grid, piece, x, y) {
    var g = grid.slice(), lines = 0, k, j, full;
    piece.cells.forEach(function (c) { g[(y + c[1]) * N + x + c[0]] = 1; });
    var clear = {};
    for (k = 0; k < N; k++) {
      full = true; for (j = 0; j < N; j++) if (!g[k * N + j]) full = false;
      if (full) { lines++; for (j = 0; j < N; j++) clear[k * N + j] = true; }
      full = true; for (j = 0; j < N; j++) if (!g[j * N + k]) full = false;
      if (full) { lines++; for (j = 0; j < N; j++) clear[j * N + k] = true; }
    }
    Object.keys(clear).forEach(function (i) { g[i] = 0; });
    return { grid: g, lines: lines };
  }
  // Лучшее место для фигуры: больше очищенных линий, потом — ближе к уже занятым клеткам (не дробит поле). null — никуда не помещается
  function bestSpot(grid, piece) {
    var best = null;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      if (!canPlace(grid, piece, x, y)) continue;
      var r = applyVirtual(grid, piece, x, y), touch = 0;
      piece.cells.forEach(function (c) {
        var cx = x + c[0], cy = y + c[1];
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var nx = cx + d[0], ny = cy + d[1]; if (nx < 0 || ny < 0 || nx >= N || ny >= N || grid[ny * N + nx]) touch++; });
      });
      var v = r.lines * 100 + touch;
      if (!best || v > best.v) best = { v: v, x: x, y: y, grid: r.grid, lines: r.lines };
    }
    return best;
  }
  // Можно ли поставить все фигуры по очереди (в каком-нибудь порядке), каждую на лучшее место
  function solvable(grid, pieces) {
    if (!pieces.length) return true;
    return pieces.some(function (p, i) {
      var spot = bestSpot(grid, p);
      return spot && solvable(spot.grid, pieces.slice(0, i).concat(pieces.slice(i + 1)));
    });
  }
  function makePiece(shape, color) { return { id: shape.id, cells: shape.cells.map(function (c) { return c.slice(); }), color: color }; }
  // Удобный набор, когда места мало: каждая следующая фигура помещается после предыдущих, лучше всего — та, что закрывает линии
  function helpfulTray(state, rng) {
    var grid = state.grid, tray = [];
    for (var k = 0; k < 3; k++) {
      var options = [];
      SHAPES.forEach(function (sh) {
        var spot = bestSpot(grid, sh);
        if (spot) options.push({ sh: sh, spot: spot, v: spot.lines * 3 + sh.cells.length * 0.2 + rng() * 1.5 });
      });
      if (!options.length) break;
      options.sort(function (a, b) { return b.v - a.v; });
      var pick = options[Math.floor(rng() * Math.min(3, options.length))];       // из трёх лучших — чтобы наборы не повторялись
      tray.push(makePiece(pick.sh, randomPiece(state, rng).color));
      grid = pick.spot.grid;
    }
    while (tray.length < 3) tray.push(randomPiece(state, rng));
    // порядок в лотке перемешиваем: удобная фигура не всегда слева
    for (var i = tray.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = tray[i]; tray[i] = tray[j]; tray[j] = t; }
    return tray;
  }
  // Новые три фигуры. Пока места много — случайные (но все три должны вместе помещаться);
  // когда места мало (меньше TIGHT свободных клеток) или случайные не помещаются — удобные: те, что точно встанут и закрывают линии
  var TIGHT = 34;
  function refill(state, rng) {
    var free = state.grid.filter(function (v) { return !v; }).length;
    if (free >= TIGHT) {
      for (var attempt = 0; attempt < 12; attempt++) {
        var t = [randomPiece(state, rng), randomPiece(state, rng), randomPiece(state, rng)];
        if (solvable(state.grid, t)) { state.tray = t; return; }
      }
    }
    state.tray = helpfulTray(state, rng);
  }

  function create(rng) {
    rng = rng || Math.random;
    var grid = []; for (var i = 0; i < N * N; i++) grid.push(0);
    var s = { grid: grid, tray: [null, null, null], score: 0, combo: 0, quiet: 0, moves: 0, over: false, got: [], nextColor: Math.floor(rng() * 7) };
    refill(s, rng);
    return s;
  }

  // Очки за очистку: n линий за раз — 10·n·(n+1) (одна 20, две 60, три 120), умножаются на комбо
  function lineScore(lines, combo) { return lines ? 10 * lines * (lines + 1) * Math.max(1, combo) : 0; }

  function place(state, slot, x, y, rng) {
    rng = rng || Math.random;
    var piece = state.tray[slot];
    if (state.over || !piece || !canPlace(state.grid, piece, x, y)) return { ok: false };
    var ns = { grid: state.grid.slice(), tray: state.tray.slice(), score: state.score, combo: state.combo, quiet: state.quiet, moves: state.moves + 1, over: false, got: state.got.slice(), nextColor: state.nextColor };
    var placed = piece.cells.map(function (c) { return (y + c[1]) * N + (x + c[0]); });
    placed.forEach(function (i) { ns.grid[i] = piece.color; });
    ns.tray[slot] = null;
    // какие ряды и столбцы заполнены целиком
    var rows = [], cols = [], k;
    for (k = 0; k < N; k++) {
      var fullRow = true, fullCol = true;
      for (var j = 0; j < N; j++) { if (!ns.grid[k * N + j]) fullRow = false; if (!ns.grid[j * N + k]) fullCol = false; }
      if (fullRow) rows.push(k);
      if (fullCol) cols.push(k);
    }
    var cells = {};
    rows.forEach(function (r) { for (var c = 0; c < N; c++) cells[r * N + c] = true; });
    cols.forEach(function (c) { for (var r = 0; r < N; r++) cells[r * N + c] = true; });
    var clearedCells = Object.keys(cells).map(Number);
    clearedCells.forEach(function (i) { ns.grid[i] = 0; });
    var lines = rows.length + cols.length;
    // комбо: очистка подряд (не реже чем раз в COMBO_KEEP ходов) его растит, долгое затишье сбрасывает
    if (lines) { ns.combo += 1; ns.quiet = 0; }
    else { ns.quiet += 1; if (ns.quiet >= COMBO_KEEP) ns.combo = 0; }
    var gained = placed.length + lineScore(lines, ns.combo);
    // поле опустело целиком — большой бонус
    if (lines && ns.grid.every(function (v) { return !v; })) gained += 300;
    ns.score += gained;
    if (ns.tray.every(function (p) { return !p; })) refill(ns, rng);
    ns.over = !ns.tray.some(function (p) { return p && fitsAnywhere(ns.grid, p); });
    return { ok: true, state: ns, placed: placed, cleared: { rows: rows, cols: cols, cells: clearedCells }, gained: gained, combo: ns.combo };
  }

  function newMilestones(state) {
    var out = MILESTONES.filter(function (m) { return state.score >= m && state.got.indexOf(m) < 0; });
    out.forEach(function (m) { state.got.push(m); });
    return out;
  }

  function cleanPiece(p) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.cells) || !p.cells.length || p.cells.length > 9) return null;
    var cells = p.cells.map(function (c) { return [Number(c && c[0]), Number(c && c[1])]; });
    if (cells.some(function (c) { return !(c[0] >= 0 && c[0] < 5 && c[1] >= 0 && c[1] < 5 && c[0] % 1 === 0 && c[1] % 1 === 0); })) return null;
    var color = Number(p.color);
    return { id: String(p.id || '').slice(0, 10), cells: cells, color: color >= 1 && color <= 7 && color % 1 === 0 ? color : 1 };
  }
  // Сохранённая партия: только правильное поле и фигуры, иначе null
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.grid) || raw.grid.length !== N * N || !Array.isArray(raw.tray) || raw.tray.length !== 3) return null;
    var grid = raw.grid.map(Number);
    if (grid.some(function (v) { return !(v >= 0 && v <= 7 && v % 1 === 0); })) return null;
    var tray = raw.tray.map(cleanPiece);
    if (!tray.some(Boolean)) return null;
    var num = function (x) { x = Number(x); return isFinite(x) && x >= 0 && x % 1 === 0 ? x : 0; };
    var s = { grid: grid, tray: tray, score: num(raw.score), combo: num(raw.combo), quiet: num(raw.quiet), moves: num(raw.moves), over: false,
      got: Array.isArray(raw.got) ? raw.got.filter(function (m) { return MILESTONES.indexOf(m) >= 0; }) : [], nextColor: num(raw.nextColor) % 7 };
    s.over = !s.tray.some(function (p) { return p && fitsAnywhere(s.grid, p); });
    return s;
  }
  function plain(state) { return JSON.parse(JSON.stringify(state)); }
  // Размер фигуры в клетках: { w, h }
  function sizeOf(piece) {
    var w = 0, h = 0;
    piece.cells.forEach(function (c) { w = Math.max(w, c[0] + 1); h = Math.max(h, c[1] + 1); });
    return { w: w, h: h };
  }
  // Что очистится, если поставить фигуру в (x, y): { rows, cols } (для подсветки при перетаскивании)
  function preview(grid, piece, x, y) {
    if (!canPlace(grid, piece, x, y)) return null;
    var g = grid.slice();
    piece.cells.forEach(function (c) { g[(y + c[1]) * N + x + c[0]] = 1; });
    var rows = [], cols = [];
    for (var k = 0; k < N; k++) {
      var fr = true, fc = true;
      for (var j = 0; j < N; j++) { if (!g[k * N + j]) fr = false; if (!g[j * N + k]) fc = false; }
      if (fr) rows.push(k);
      if (fc) cols.push(k);
    }
    return { rows: rows, cols: cols };
  }

  root.Blocks = { solvable: solvable, TIGHT: TIGHT, SIZE: N, SHAPES: SHAPES, MILESTONES: MILESTONES, COMBO_KEEP: COMBO_KEEP, create: create, canPlace: canPlace, fitsAnywhere: fitsAnywhere, place: place, lineScore: lineScore, newMilestones: newMilestones, sanitize: sanitize, plain: plain, sizeOf: sizeOf, preview: preview };
})(typeof window !== 'undefined' ? window : globalThis);
