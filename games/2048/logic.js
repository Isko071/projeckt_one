// Чистая логика игры 2048: поле 4×4, сдвиг плиток, слияние одинаковых, новая плитка после хода, конец игры.
// Без обращений к window и document; случайность передаётся параметром rng (функция, возвращающая число от 0 до 1).
//
// Плитка: { id, v, i } — номер (для анимации), значение, клетка (индекс y * 4 + x).
//   G2048.create(rng) → состояние { size, tiles, nextId, score, moves, maxTile, over, got }
//   G2048.move(state, dir, rng) → { ok, state, slides: [{ id, to }], gained } | { ok: false } (ход ничего не меняет)
//     dir: 'up' | 'down' | 'left' | 'right'; slides — куда поехала каждая плитка прошлого поля (слитые едут в клетку слияния)
//   G2048.canMove(state) — есть ли хоть один ход; G2048.sanitize(raw) — проверка сохранённой партии
//   G2048.MILESTONES — плитки, за которые в партии даётся награда (один раз за партию каждая)
(function (root) {
  var SIZE = 4, DIRS = ['up', 'down', 'left', 'right'], MILESTONES = [512, 1024, 2048];

  function emptyCells(tiles) {
    var used = {}, out = [];
    tiles.forEach(function (t) { used[t.i] = true; });
    for (var i = 0; i < SIZE * SIZE; i++) if (!used[i]) out.push(i);
    return out;
  }
  // Новая плитка в случайной пустой клетке: 2 (в 90% случаев) или 4
  function spawn(state, rng) {
    var free = emptyCells(state.tiles);
    if (!free.length) return null;
    var t = { id: state.nextId++, v: rng() < 0.9 ? 2 : 4, i: free[Math.floor(rng() * free.length)] };
    state.tiles.push(t);
    return t;
  }
  function create(rng) {
    rng = rng || Math.random;
    var s = { size: SIZE, tiles: [], nextId: 1, score: 0, moves: 0, maxTile: 0, over: false, got: [] };
    spawn(s, rng); spawn(s, rng);
    s.maxTile = Math.max.apply(null, s.tiles.map(function (t) { return t.v; }));
    return s;
  }

  // Линии клеток по направлению хода: каждая линия начинается с клетки, к которой плитки едут
  function lines(dir) {
    var out = [];
    for (var a = 0; a < SIZE; a++) {
      var line = [];
      for (var b = 0; b < SIZE; b++) {
        if (dir === 'left') line.push(a * SIZE + b);
        else if (dir === 'right') line.push(a * SIZE + (SIZE - 1 - b));
        else if (dir === 'up') line.push(b * SIZE + a);
        else line.push((SIZE - 1 - b) * SIZE + a);
      }
      out.push(line);
    }
    return out;
  }

  function move(state, dir, rng) {
    if (DIRS.indexOf(dir) < 0 || state.over) return { ok: false };
    rng = rng || Math.random;
    var at = {};
    state.tiles.forEach(function (t) { at[t.i] = t; });
    var ns = { size: SIZE, tiles: [], nextId: state.nextId, score: state.score, moves: state.moves, maxTile: state.maxTile, over: false, got: state.got.slice() };
    var slides = [], gained = 0, changed = false;
    lines(dir).forEach(function (line) {
      var row = line.map(function (c) { return at[c]; }).filter(Boolean), pos = 0, k = 0;
      while (k < row.length) {
        var t = row[k], u = row[k + 1], to = line[pos];
        if (u && u.v === t.v) {                                             // слияние: обе плитки едут в клетку to, на их месте новая
          var m = { id: ns.nextId++, v: t.v * 2, i: to, merged: true };
          ns.tiles.push(m);
          slides.push({ id: t.id, to: to }, { id: u.id, to: to });
          gained += m.v;
          changed = true;
          k += 2;
        } else {
          ns.tiles.push({ id: t.id, v: t.v, i: to });
          slides.push({ id: t.id, to: to });
          if (t.i !== to) changed = true;
          k += 1;
        }
        pos++;
      }
    });
    if (!changed) return { ok: false };
    ns.score += gained;
    ns.moves += 1;
    var fresh = spawn(ns, rng);
    if (fresh) fresh.fresh = true;
    ns.tiles.forEach(function (t) { if (t.v > ns.maxTile) ns.maxTile = t.v; });
    ns.over = !canMove(ns);
    return { ok: true, state: ns, slides: slides, gained: gained };
  }

  function canMove(state) {
    if (state.tiles.length < SIZE * SIZE) return true;
    var at = {};
    state.tiles.forEach(function (t) { at[t.i] = t.v; });
    for (var i = 0; i < SIZE * SIZE; i++) {
      var x = i % SIZE;
      if (x < SIZE - 1 && at[i] === at[i + 1]) return true;
      if (i + SIZE < SIZE * SIZE && at[i] === at[i + SIZE]) return true;
    }
    return false;
  }

  // Новые для этой партии плитки-вехи (за них награда): отмечаются в state.got
  function newMilestones(state) {
    var out = MILESTONES.filter(function (m) { return state.maxTile >= m && state.got.indexOf(m) < 0; });
    out.forEach(function (m) { state.got.push(m); });
    return out;
  }

  // Сохранённая партия: только правильные плитки в разных клетках, иначе null
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tiles)) return null;
    var seen = {}, tiles = [], maxId = 0;
    for (var k = 0; k < raw.tiles.length; k++) {
      var t = raw.tiles[k], v = t && Number(t.v), i = t && Number(t.i), id = t && Number(t.id);
      if (!(v >= 2 && (v & (v - 1)) === 0 && v <= 131072) || !(i >= 0 && i < SIZE * SIZE && i % 1 === 0) || seen[i] || !(id >= 1 && id % 1 === 0)) return null;
      seen[i] = true; maxId = Math.max(maxId, id);
      tiles.push({ id: id, v: v, i: i });
    }
    if (!tiles.length) return null;
    var num = function (x) { x = Number(x); return isFinite(x) && x >= 0 && x % 1 === 0 ? x : 0; };
    var s = { size: SIZE, tiles: tiles, nextId: Math.max(num(raw.nextId), maxId + 1), score: num(raw.score), moves: num(raw.moves), maxTile: 0, over: false,
      got: Array.isArray(raw.got) ? raw.got.filter(function (m) { return MILESTONES.indexOf(m) >= 0; }) : [] };
    tiles.forEach(function (t) { if (t.v > s.maxTile) s.maxTile = t.v; });
    s.over = !canMove(s);
    return s;
  }
  // Для сохранения: без пометок анимации
  function plain(state) {
    return { size: SIZE, tiles: state.tiles.map(function (t) { return { id: t.id, v: t.v, i: t.i }; }), nextId: state.nextId, score: state.score, moves: state.moves, maxTile: state.maxTile, over: state.over, got: state.got.slice() };
  }

  root.G2048 = { SIZE: SIZE, DIRS: DIRS, MILESTONES: MILESTONES, create: create, move: move, canMove: canMove, newMilestones: newMilestones, sanitize: sanitize, plain: plain, lines: lines };
})(typeof window !== 'undefined' ? window : globalThis);
