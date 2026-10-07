// Чистая логика игры «Сапёр»: поле, мины, открытие клеток, флажки, победа и поражение, рекорды.
// Без обращений к window и document, поэтому тестируется через node (tests/logic.test.js).
// Случайность передаётся параметром rng (функция, возвращающая число от 0 до 1), чтобы тесты были воспроизводимыми.

// ===== Уровни сложности =====
var LEVELS = {
  novice: { id: 'novice', cols: 9, rows: 9, mines: 10 },
  amateur: { id: 'amateur', cols: 12, rows: 12, mines: 24 },
  expert: { id: 'expert', cols: 16, rows: 16, mines: 40 }
};
var LEVEL_IDS = ['novice', 'amateur', 'expert'];
var MAX_TIME = 99 * 60 + 59; // таймер показывает до 99:59

// ===== Поле =====
// Индекс клетки: row * cols + col
function neighbors(cols, rows, index) {
  var x = index % cols, y = Math.floor(index / cols), out = [];
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      var nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) out.push(ny * cols + nx);
    }
  }
  return out;
}

function createGame(levelId) {
  var level = LEVELS[levelId] || LEVELS.novice;
  var size = level.cols * level.rows;
  var open = [], flag = [];
  for (var i = 0; i < size; i++) { open.push(false); flag.push(false); }
  return {
    level: level.id, cols: level.cols, rows: level.rows, mines: level.mines,
    layout: null,        // массив «есть ли мина»; создаётся при первом открытии (первая клетка всегда безопасна)
    counts: null,        // сколько мин вокруг каждой клетки
    open: open, flag: flag,
    flagCount: 0, openedCount: 0,
    status: 'ready',     // ready → playing → won | lost
    boom: -1             // клетка, на которой подорвались
  };
}

// Расставляет мины, кроме клетки safeIndex
function placeMines(game, safeIndex, rng) {
  rng = rng || Math.random;
  var size = game.cols * game.rows, candidates = [];
  for (var i = 0; i < size; i++) if (i !== safeIndex) candidates.push(i);
  // Частичное перемешивание Фишера — Йетса: берём первые game.mines клеток
  for (var k = 0; k < game.mines; k++) {
    var j = k + Math.floor(rng() * (candidates.length - k));
    var tmp = candidates[k]; candidates[k] = candidates[j]; candidates[j] = tmp;
  }
  var layout = [];
  for (var c = 0; c < size; c++) layout.push(false);
  for (var m = 0; m < game.mines; m++) layout[candidates[m]] = true;
  game.layout = layout;
  game.counts = layout.map(function (_, idx) {
    return neighbors(game.cols, game.rows, idx).filter(function (n) { return layout[n]; }).length;
  });
}

function isOver(game) { return game.status === 'won' || game.status === 'lost'; }

// Сколько мин осталось отметить (может быть отрицательным, если флажков больше)
function minesLeft(game) { return game.mines - game.flagCount; }

// Сколько клеток без мин ещё не открыто
function cellsToOpen(game) { return game.cols * game.rows - game.mines - game.openedCount; }

// ===== Действия =====
// Результат любого действия: { changed, opened: [{ index, dist }], exploded }
function noChange() { return { changed: false, opened: [], exploded: false }; }

function checkWin(game) {
  if (game.status === 'playing' && cellsToOpen(game) === 0) {
    game.status = 'won';
    // После победы все мины помечаются флажками автоматически
    for (var i = 0; i < game.layout.length; i++) {
      if (game.layout[i] && !game.flag[i]) { game.flag[i] = true; game.flagCount++; }
    }
  }
}

// Открывает клетку по индексу; у нуля открывает соседей цепочкой.
// dist — расстояние от нажатой клетки (для анимации «волной»)
function openCell(game, index, rng, startDist) {
  var result = { changed: false, opened: [], exploded: false };
  if (isOver(game) || game.flag[index] || game.open[index]) return result;
  if (game.status === 'ready') { placeMines(game, index, rng); game.status = 'playing'; }
  result.changed = true;
  if (game.layout[index]) {
    game.status = 'lost';
    game.boom = index;
    result.exploded = true;
    return result;
  }
  var queue = [{ index: index, dist: startDist || 0 }];
  game.open[index] = true; game.openedCount++;
  result.opened.push(queue[0]);
  while (queue.length) {
    var cur = queue.shift();
    if (game.counts[cur.index] !== 0) continue;
    neighbors(game.cols, game.rows, cur.index).forEach(function (n) {
      if (game.open[n] || game.flag[n]) return;
      game.open[n] = true; game.openedCount++;
      var item = { index: n, dist: cur.dist + 1 };
      result.opened.push(item);
      queue.push(item);
    });
  }
  return result;
}

function reveal(game, index, rng) {
  var result = openCell(game, index, rng, 0);
  if (result.changed && !result.exploded) checkWin(game);
  return result;
}

function toggleFlag(game, index) {
  if (isOver(game) || game.open[index]) return false;
  game.flag[index] = !game.flag[index];
  game.flagCount += game.flag[index] ? 1 : -1;
  return true;
}

// Флажков вокруг клетки
function flagsAround(game, index) {
  return neighbors(game.cols, game.rows, index).filter(function (n) { return game.flag[n]; }).length;
}

// Закрытые клетки без флажков вокруг открытой цифры, если флажков вокруг ровно столько, сколько указано в цифре
function chordTargets(game, index) {
  if (game.status !== 'playing' || !game.open[index] || !game.counts || game.counts[index] === 0) return [];
  if (flagsAround(game, index) !== game.counts[index]) return [];
  return neighbors(game.cols, game.rows, index).filter(function (n) { return !game.open[n] && !game.flag[n]; });
}

// Двойное нажатие на цифру: открывает остальных соседей. Неверно поставленный флажок приводит к проигрышу
function chord(game, index, rng) {
  var targets = chordTargets(game, index);
  if (!targets.length) return noChange();
  var total = { changed: true, opened: [], exploded: false };
  targets.forEach(function (t) {
    var r = openCell(game, t, rng, 1);
    r.opened.forEach(function (o) { total.opened.push(o); });
    if (r.exploded) total.exploded = true;
  });
  if (!total.exploded) checkWin(game);
  return total;
}

// ===== Вид клетки =====
// 'closed' | 'flag' | 'zero' | 'num' | 'mine' | 'boom' | 'wrong' | 'auto'
function cellKind(game, index) {
  var counts = game.counts, n = counts ? counts[index] : 0;
  if (game.status === 'lost') {
    if (index === game.boom) return 'boom';
    if (game.layout[index] && !game.flag[index]) return 'mine';
    if (game.flag[index] && !game.layout[index]) return 'wrong';
    if (game.flag[index]) return 'flag';
    return game.open[index] ? (n ? 'num' : 'zero') : 'closed';
  }
  if (game.status === 'won') {
    if (game.layout[index]) return 'auto';
    return n ? 'num' : 'zero';
  }
  if (game.flag[index]) return 'flag';
  if (game.open[index]) return n ? 'num' : 'zero';
  return 'closed';
}

// Цифра в клетке (0, если клетка не открыта или мин вокруг нет)
function cellNumber(game, index) {
  return game.counts && (game.open[index] || game.status === 'won') && !game.layout[index] ? game.counts[index] : 0;
}

// ===== Клавиатура =====
// Новая позиция фокуса по стрелке (на краю остаётся на месте)
function moveFocus(cols, rows, index, key) {
  var x = index % cols, y = Math.floor(index / cols);
  if (key === 'ArrowRight') x = Math.min(x + 1, cols - 1);
  else if (key === 'ArrowLeft') x = Math.max(x - 1, 0);
  else if (key === 'ArrowDown') y = Math.min(y + 1, rows - 1);
  else if (key === 'ArrowUp') y = Math.max(y - 1, 0);
  else return index;
  return y * cols + x;
}

// ===== Время и рекорды =====
function formatTime(seconds) {
  var s = Math.max(0, Math.min(MAX_TIME, Math.floor(Number(seconds) || 0)));
  var mm = Math.floor(s / 60), ss = s % 60;
  return (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
}

// Лучшее время по уровням: только положительные числа, остальное null
function sanitizeBests(raw) {
  var out = {};
  LEVEL_IDS.forEach(function (id) {
    var v = raw && typeof raw === 'object' ? raw[id] : null;
    out[id] = typeof v === 'number' && isFinite(v) && v >= 0 && v % 1 === 0 ? v : null;
  });
  return out;
}

// Учитывает результат победы; isRecord — улучшил ли он лучшее время (первая победа тоже рекорд)
function recordResult(bests, levelId, seconds) {
  var clean = sanitizeBests(bests), t = Math.max(0, Math.min(MAX_TIME, Math.floor(seconds)));
  var prev = clean[levelId];
  var isRecord = prev === null || t < prev;
  if (isRecord) clean[levelId] = t;
  return { bests: clean, isRecord: isRecord, best: clean[levelId] };
}

var Minesweeper = {
  LEVELS: LEVELS, LEVEL_IDS: LEVEL_IDS, MAX_TIME: MAX_TIME,
  neighbors: neighbors, createGame: createGame, placeMines: placeMines, isOver: isOver,
  minesLeft: minesLeft, cellsToOpen: cellsToOpen, reveal: reveal, toggleFlag: toggleFlag,
  flagsAround: flagsAround, chordTargets: chordTargets, chord: chord,
  cellKind: cellKind, cellNumber: cellNumber, moveFocus: moveFocus,
  formatTime: formatTime, sanitizeBests: sanitizeBests, recordResult: recordResult
};
