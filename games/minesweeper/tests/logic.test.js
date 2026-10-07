// Запуск: node --test games/minesweeper/tests/logic.test.js
// Логика берётся из games/minesweeper/logic.js (без DOM, выполняется в изолированном контексте vm)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
const M = vm.runInNewContext(code + ';Minesweeper');
const plain = (x) => JSON.parse(JSON.stringify(x));

// Воспроизводимый генератор случайных чисел
function seeded(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Партия с заданным расположением мин (для проверки правил без случайности)
function withMines(levelId, mineIndexes) {
  const g = M.createGame(levelId);
  g.layout = g.open.map((_, i) => mineIndexes.indexOf(i) >= 0);
  g.mines = mineIndexes.length;
  g.counts = g.layout.map((_, i) => M.neighbors(g.cols, g.rows, i).filter((n) => g.layout[n]).length);
  g.status = 'playing';
  return g;
}
const at = (g, x, y) => y * g.cols + x;

test('уровни: классические размеры и число мин', () => {
  assert.deepEqual(plain(M.LEVELS.novice), { id: 'novice', cols: 9, rows: 9, mines: 10 });
  assert.deepEqual(plain(M.LEVELS.amateur), { id: 'amateur', cols: 12, rows: 12, mines: 24 });
  assert.deepEqual(plain(M.LEVELS.expert), { id: 'expert', cols: 16, rows: 16, mines: 40 });
  assert.deepEqual(plain(M.LEVEL_IDS), ['novice', 'amateur', 'expert']);
  M.LEVEL_IDS.forEach((id) => assert.ok(M.LEVELS[id].mines < M.LEVELS[id].cols * M.LEVELS[id].rows));
});

test('соседи: угол — 3, край — 5, середина — 8; связь взаимная', () => {
  assert.equal(M.neighbors(9, 9, 0).length, 3);
  assert.equal(M.neighbors(9, 9, 80).length, 3);
  assert.equal(M.neighbors(9, 9, 4).length, 5);
  assert.equal(M.neighbors(9, 9, 40).length, 8);
  for (let i = 0; i < 81; i++) {
    M.neighbors(9, 9, i).forEach((n) => assert.ok(M.neighbors(9, 9, n).indexOf(i) >= 0));
  }
});

test('новая партия: все клетки закрыты, мин ещё нет, неизвестный уровень — новичок', () => {
  const g = M.createGame('amateur');
  assert.equal(g.cols * g.rows, 144);
  assert.equal(g.status, 'ready');
  assert.equal(g.layout, null);
  assert.equal(g.open.filter(Boolean).length, 0);
  assert.equal(M.minesLeft(g), 24);
  assert.equal(M.cellsToOpen(g), 144 - 24);
  assert.equal(M.createGame('что-то').level, 'novice');
});

test('расстановка: ровно нужное число мин, цифры совпадают, расстановка воспроизводима', () => {
  M.LEVEL_IDS.forEach((id) => {
    const g = M.createGame(id);
    M.placeMines(g, 5, seeded(42));
    assert.equal(g.layout.filter(Boolean).length, g.mines);
    g.layout.forEach((mine, i) => {
      const expected = M.neighbors(g.cols, g.rows, i).filter((n) => g.layout[n]).length;
      assert.equal(g.counts[i], expected);
    });
    const g2 = M.createGame(id);
    M.placeMines(g2, 5, seeded(42));
    assert.deepEqual(plain(g2.layout), plain(g.layout), 'тот же seed — та же расстановка');
    const g3 = M.createGame(id);
    M.placeMines(g3, 5, seeded(43));
    assert.notDeepEqual(plain(g3.layout), plain(g.layout), 'другой seed — другая расстановка');
  });
});

test('первое нажатие всегда безопасно: любая клетка, много расстановок', () => {
  M.LEVEL_IDS.forEach((id) => {
    const size = M.LEVELS[id].cols * M.LEVELS[id].rows;
    for (let first = 0; first < size; first += 1) {
      for (const seed of [1, 2, 3]) {
        const g = M.createGame(id);
        const r = M.reveal(g, first, seeded(seed * 1000 + first));
        assert.equal(r.exploded, false, id + ': взрыв на первом нажатии в клетке ' + first);
        assert.equal(g.status === 'playing' || g.status === 'won', true);
        assert.equal(g.layout[first], false);
      }
    }
  });
});

test('открытие цифры: открывается только она, ход начинается', () => {
  const g2 = withMines('novice', [10]);
  const r = M.reveal(g2, 0);
  assert.equal(r.changed, true);
  assert.equal(g2.counts[0], 1);
  assert.deepEqual(plain(r.opened), [{ index: 0, dist: 0 }]);
  assert.equal(M.cellNumber(g2, 0), 1);
});

test('открытие нуля: цепочка открывает пустую область и её цифровую границу, но не мины', () => {
  const g = withMines('novice', [at({ cols: 9 }, 8, 8)]);
  const r = M.reveal(g, 0);
  assert.equal(g.open[at(g, 8, 8)], false, 'мина не открыта');
  assert.equal(g.status, 'won', 'при единственной мине в углу открывается всё остальное и победа');
  assert.equal(r.opened.length, 80);
  assert.equal(M.cellsToOpen(g), 0);
});

test('цепочка не проходит через флажки и считает расстояния для анимации', () => {
  const g = withMines('novice', [at({ cols: 9 }, 8, 8)]);
  M.toggleFlag(g, at(g, 4, 0));
  const r = M.reveal(g, 0);
  assert.equal(g.open[at(g, 4, 0)], false, 'клетка под флажком не открыта');
  const dists = {};
  r.opened.forEach((o) => { dists[o.index] = o.dist; });
  assert.equal(dists[0], 0);
  assert.equal(dists[1], 1);
  assert.ok(dists[at(g, 3, 0)] >= 3);
  r.opened.forEach((o) => assert.ok(o.dist >= 0));
});

test('мина: поражение, клетка взрыва запоминается, дальше действия не проходят', () => {
  const g = withMines('novice', [20, 30]);
  const r = M.reveal(g, 20);
  assert.equal(r.exploded, true);
  assert.equal(g.status, 'lost');
  assert.equal(g.boom, 20);
  assert.equal(M.isOver(g), true);
  assert.equal(M.reveal(g, 5).changed, false);
  assert.equal(M.toggleFlag(g, 5), false);
  assert.equal(M.chord(g, 5).changed, false);
});

test('флажки: ставятся и снимаются, считаются, под флажком клетка не открывается', () => {
  const g = withMines('novice', [20]);
  assert.equal(M.toggleFlag(g, 3), true);
  assert.equal(g.flagCount, 1);
  assert.equal(M.minesLeft(g), 0);
  assert.equal(M.reveal(g, 3).changed, false, 'флажок защищает клетку');
  assert.equal(M.toggleFlag(g, 3), true);
  assert.equal(g.flagCount, 0);
  M.toggleFlag(g, 1); M.toggleFlag(g, 2);
  assert.equal(M.minesLeft(g), -1, 'флажков может быть больше мин');
  M.reveal(g, 70);
  assert.equal(M.toggleFlag(g, 70), false, 'на открытую клетку флажок не ставится');
});

test('победа: все клетки без мин открыты, мины помечаются флажками автоматически', () => {
  const g = withMines('novice', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // верхняя строка и ещё одна
  for (let i = 0; i < 81; i++) if (!g.layout[i]) M.reveal(g, i);
  assert.equal(g.status, 'won');
  assert.equal(g.flagCount, 10);
  assert.equal(M.minesLeft(g), 0);
  for (let i = 0; i < 81; i++) if (g.layout[i]) assert.equal(M.cellKind(g, i), 'auto');
  assert.equal(M.reveal(g, 40).changed, false, 'после победы ходы не принимаются');
});

test('двойное нажатие на цифру: открывает соседей при верном числе флажков', () => {
  const g = withMines('novice', [at({ cols: 9 }, 0, 0)]);
  M.reveal(g, at(g, 1, 1)); // цифра 1
  assert.equal(g.counts[at(g, 1, 1)], 1);
  assert.deepEqual(plain(M.chordTargets(g, at(g, 1, 1))), [], 'пока флажков нет — подсказки нет');
  assert.equal(M.chord(g, at(g, 1, 1)).changed, false);
  M.toggleFlag(g, at(g, 0, 0));
  const targets = M.chordTargets(g, at(g, 1, 1));
  assert.equal(targets.length, 7, 'остальные 7 соседей');
  const r = M.chord(g, at(g, 1, 1));
  assert.equal(r.changed, true);
  assert.equal(r.exploded, false);
  targets.forEach((t) => assert.equal(g.open[t], true));
});

test('двойное нажатие: неверный флажок приводит к взрыву; лишние и недостающие флажки не работают', () => {
  const g = withMines('novice', [at({ cols: 9 }, 0, 0)]);
  M.reveal(g, at(g, 1, 1));
  M.toggleFlag(g, at(g, 2, 2)); // флажок не на мине
  const r = M.chord(g, at(g, 1, 1));
  assert.equal(r.exploded, true);
  assert.equal(g.status, 'lost');
  assert.equal(g.boom, at(g, 0, 0));
  const h = withMines('novice', [at({ cols: 9 }, 0, 0)]);
  M.reveal(h, at(h, 1, 1));
  M.toggleFlag(h, at(h, 0, 0)); M.toggleFlag(h, at(h, 2, 2));
  assert.equal(M.chord(h, at(h, 1, 1)).changed, false, 'флажков больше, чем в цифре');
  assert.equal(M.chord(h, at(h, 5, 5)).changed, false, 'закрытая клетка');
});

test('вид клеток в обычной партии', () => {
  const g = withMines('novice', [0]);
  M.reveal(g, at(g, 1, 1));
  M.toggleFlag(g, 0);
  assert.equal(M.cellKind(g, 0), 'flag');
  assert.equal(M.cellKind(g, at(g, 1, 1)), 'num');
  assert.equal(M.cellKind(g, at(g, 8, 8)), 'closed');
  const z = withMines('novice', [0]);
  M.reveal(z, at(z, 8, 8));
  assert.equal(M.cellKind(z, at(z, 8, 8)), 'zero');
  assert.equal(M.cellNumber(z, at(z, 8, 8)), 0);
});

test('вид клеток после поражения: взрыв, мины, неверный флажок, верный флажок', () => {
  const g = withMines('novice', [10, 20, 30]);
  M.toggleFlag(g, 30);       // верный
  M.toggleFlag(g, 50);       // неверный
  M.reveal(g, 70);           // открыта
  M.reveal(g, 10);           // взрыв
  assert.equal(M.cellKind(g, 10), 'boom');
  assert.equal(M.cellKind(g, 20), 'mine');
  assert.equal(M.cellKind(g, 30), 'flag');
  assert.equal(M.cellKind(g, 50), 'wrong');
  assert.ok(['num', 'zero'].indexOf(M.cellKind(g, 70)) >= 0);
  assert.equal(M.cellKind(g, 1), 'closed');
});

test('клавиатура: стрелки двигают фокус и не выходят за поле', () => {
  assert.equal(M.moveFocus(9, 9, 0, 'ArrowLeft'), 0);
  assert.equal(M.moveFocus(9, 9, 0, 'ArrowUp'), 0);
  assert.equal(M.moveFocus(9, 9, 0, 'ArrowRight'), 1);
  assert.equal(M.moveFocus(9, 9, 0, 'ArrowDown'), 9);
  assert.equal(M.moveFocus(9, 9, 80, 'ArrowRight'), 80);
  assert.equal(M.moveFocus(9, 9, 80, 'ArrowDown'), 80);
  assert.equal(M.moveFocus(9, 9, 40, 'Enter'), 40, 'другие клавиши не двигают');
});

test('время: мм:сс, границы и неверные значения', () => {
  assert.equal(M.formatTime(0), '00:00');
  assert.equal(M.formatTime(9), '00:09');
  assert.equal(M.formatTime(59), '00:59');
  assert.equal(M.formatTime(60), '01:00');
  assert.equal(M.formatTime(74), '01:14');
  assert.equal(M.formatTime(3599), '59:59');
  assert.equal(M.formatTime(999999), '99:59', 'не больше 99:59');
  assert.equal(M.formatTime(-5), '00:00');
  assert.equal(M.formatTime(NaN), '00:00');
  assert.equal(M.formatTime(12.9), '00:12');
});

test('рекорды: первая победа — рекорд, быстрее — рекорд, медленнее и равное — нет', () => {
  let b = M.sanitizeBests(null);
  assert.deepEqual(plain(b), { novice: null, amateur: null, expert: null });
  let r = M.recordResult(b, 'novice', 80);
  assert.equal(r.isRecord, true); assert.equal(r.best, 80);
  r = M.recordResult(r.bests, 'novice', 90);
  assert.equal(r.isRecord, false); assert.equal(r.best, 80);
  r = M.recordResult(r.bests, 'novice', 80);
  assert.equal(r.isRecord, false);
  r = M.recordResult(r.bests, 'novice', 61);
  assert.equal(r.isRecord, true); assert.equal(r.best, 61);
  assert.equal(r.bests.amateur, null, 'другие уровни не затронуты');
  assert.equal(M.recordResult(r.bests, 'expert', 100000).best, M.MAX_TIME);
});

test('рекорды: испорченные сохранённые данные очищаются', () => {
  assert.deepEqual(plain(M.sanitizeBests({ novice: 74, amateur: 'x', expert: -3, лишнее: 1 })), { novice: 74, amateur: null, expert: null });
  assert.deepEqual(plain(M.sanitizeBests({ novice: 1.5, amateur: NaN, expert: 0 })), { novice: null, amateur: null, expert: 0 });
  assert.deepEqual(plain(M.sanitizeBests('мусор')), { novice: null, amateur: null, expert: null });
  assert.deepEqual(plain(M.sanitizeBests([1, 2, 3])), { novice: null, amateur: null, expert: null });
});

test('полная партия «по знанию»: открыв все безопасные клетки, выигрываем на любом уровне', () => {
  M.LEVEL_IDS.forEach((id, k) => {
    const g = M.createGame(id);
    const rng = seeded(100 + k);
    M.reveal(g, 0, rng);
    for (let i = 0; i < g.cols * g.rows; i++) if (!g.layout[i]) M.reveal(g, i, rng);
    assert.equal(g.status, 'won', id);
    assert.equal(M.cellsToOpen(g), 0);
    assert.equal(g.flagCount, g.mines);
  });
});

test('статус и инварианты на случайных ходах', () => {
  const rng = seeded(7);
  for (let round = 0; round < 40; round++) {
    const g = M.createGame(M.LEVEL_IDS[round % 3]);
    const size = g.cols * g.rows;
    for (let step = 0; step < 60 && !M.isOver(g); step++) {
      const i = Math.floor(rng() * size);
      const action = rng();
      if (action < 0.6) M.reveal(g, i, rng); else if (action < 0.85) M.toggleFlag(g, i); else M.chord(g, i, rng);
      assert.equal(g.flag.filter(Boolean).length, g.flagCount, 'счётчик флажков');
      assert.equal(g.open.filter(Boolean).length, g.openedCount, 'счётчик открытых');
      if (g.layout) g.open.forEach((o, idx) => { if (o && g.layout[idx]) assert.fail('открыта мина'); });
    }
  }
});
