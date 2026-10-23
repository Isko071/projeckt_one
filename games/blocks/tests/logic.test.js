// Запуск: node --test games/blocks/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ JSON, Math, Object, Array, Number, String, Error });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8'), ctx);
const B = ctx.Blocks;
const plain = (x) => JSON.parse(JSON.stringify(x));
function seeded(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const piece = (rows, color) => { const cells = []; rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') cells.push([x, y]); })); return { id: 't', cells, color: color || 1 }; };
function state(gridRows, tray) {
  const grid = new Array(64).fill(0);
  (gridRows || []).forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') grid[y * 8 + x] = 2; }));
  return { grid, tray: tray || [piece(['#']), piece(['#']), piece(['#'])], score: 0, combo: 0, quiet: 0, moves: 0, over: false, got: [], nextColor: 0 };
}

test('новая партия: пустое поле и три фигуры; набор фигур без повторов', () => {
  const s = B.create(seeded(1));
  assert.equal(s.grid.filter(Boolean).length, 0);
  assert.equal(s.tray.filter(Boolean).length, 3);
  const keys = B.SHAPES.map((sh) => JSON.stringify(sh.cells));
  assert.equal(new Set(keys).size, keys.length, 'одинаковых положений фигур нет');
  assert.ok(B.SHAPES.some((sh) => sh.cells.length === 9), 'есть квадрат 3×3');
  assert.ok(B.SHAPES.some((sh) => sh.cells.length === 5 && sh.id.startsWith('i5')), 'есть линия из 5');
});

test('фигура ставится только целиком в свободные клетки и в пределах поля', () => {
  const s = state(['#.......']);
  const L = piece(['#.', '##']);
  assert.equal(B.canPlace(s.grid, L, 0, 0), false, 'клетка занята');
  assert.equal(B.canPlace(s.grid, L, 1, 0), true);
  assert.equal(B.canPlace(s.grid, L, 7, 0), false, 'выходит за край');
  assert.equal(B.canPlace(s.grid, L, 6, 6), true);
  assert.equal(B.canPlace(s.grid, L, 6, 7), false);
});

test('ход: клетки заняты, очки за клетки, фигура уходит из лотка; после трёх — новые три', () => {
  let s = state([], [piece(['##']), piece(['#']), piece(['###'])]);
  let r = B.place(s, 0, 0, 0, seeded(2));
  assert.equal(r.ok, true);
  assert.equal(r.gained, 2);
  assert.equal(r.state.tray[0], null);
  assert.equal(B.place(r.state, 0, 3, 3).ok, false, 'пустой слот');
  r = B.place(r.state, 1, 5, 5, seeded(2));
  r = B.place(r.state, 2, 0, 7, seeded(2));
  assert.equal(r.state.tray.filter(Boolean).length, 3, 'лоток заполнился заново');
  assert.equal(r.state.score, 6);
});

test('очистка: ряд и столбец одновременно (крест), очки за две линии', () => {
  const s = state(['###.####', '...#....', '...#....', '...#....', '...#....', '...#....', '...#....', '...#....'], [piece(['#']), piece(['#']), piece(['#'])]);
  const r = B.place(s, 0, 3, 0);
  assert.deepEqual(plain(r.cleared.rows), [0]);
  assert.deepEqual(plain(r.cleared.cols), [3]);
  assert.equal(r.cleared.cells.length, 15, 'общая клетка считается один раз');
  assert.equal(r.state.grid.filter(Boolean).length, 0);
  assert.equal(r.combo, 1);
  assert.equal(r.gained, 1 + B.lineScore(2, 1) + 300, 'клетка + две линии + бонус за пустое поле');
});

test('комбо: очистка подряд растит множитель, три хода без очистки сбрасывают', () => {
  let s = state(['.#######', '.#######', '.#######', '........', '........', '........', '........', '........'], [piece(['#']), piece(['#']), piece(['#'])]);
  s.grid[60] = 3;                                            // поле не опустеет целиком (без бонуса)
  let r = B.place(s, 0, 0, 0); assert.equal(r.combo, 1); assert.equal(r.gained, 1 + 20);
  r = B.place(r.state, 1, 0, 1); assert.equal(r.combo, 2); assert.equal(r.gained, 1 + 40);
  r = B.place(r.state, 2, 0, 2); assert.equal(r.combo, 3); assert.equal(r.gained, 1 + 60);
  let st = r.state; st.tray = [piece(['#']), piece(['#']), piece(['#'])];
  r = B.place(st, 0, 7, 7); assert.equal(r.combo, 3, 'один ход без очистки комбо не сбрасывает');
  r = B.place(r.state, 1, 6, 7); r = B.place(r.state, 2, 5, 7);
  assert.equal(r.state.combo, 0, 'после трёх ходов без очистки комбо сброшено');
});

test('конец игры: ни одна фигура лотка никуда не помещается', () => {
  const rows = []; for (let y = 0; y < 8; y++) rows.push(y % 2 ? '#.#.#.#.' : '.#.#.#.#');
  const s = state(rows, [piece(['##']), piece(['##']), piece(['#'])]);
  const r = B.place(s, 2, 0, 0);
  assert.equal(r.ok, true);
  assert.equal(r.state.over, true, 'остались только двойные, а места для них нет');
  assert.equal(B.place(r.state, 0, 2, 0).ok, false);
});

test('новые фигуры: если хоть какая-то фигура может поместиться, хоть одна из трёх помещается', () => {
  const rng = seeded(5);
  let checked = 0;
  for (let k = 0; k < 300; k++) {
    const rows = []; for (let y = 0; y < 8; y++) rows.push([...'########'].map(() => (rng() < 0.8 ? '#' : '.')).join(''));
    const s = state(rows, [piece(['#']), null, null]);
    const free = s.grid.findIndex((v) => !v);
    if (free < 0) continue;
    const r = B.place(s, 0, free % 8, Math.floor(free / 8), rng);   // лоток опустел — выдаются новые три
    if (B.SHAPES.some((sh) => B.fitsAnywhere(r.state.grid, sh))) {
      checked++;
      assert.ok(r.state.tray.some((p) => B.fitsAnywhere(r.state.grid, p)), 'среди новых есть помещающаяся');
      assert.equal(r.state.over, false);
    }
  }
  assert.ok(checked > 50);
});

test('вехи 1000, 2500, 5000: каждая один раз за партию', () => {
  const s = state(); s.score = 2600;
  assert.deepEqual(plain(B.newMilestones(s)), [1000, 2500]);
  assert.deepEqual(plain(B.newMilestones(s)), []);
  s.score = 5000;
  assert.deepEqual(plain(B.newMilestones(s)), [5000]);
});

test('сохранённая партия: правильная восстанавливается, испорченная — нет', () => {
  const s = B.create(seeded(9));
  const back = B.sanitize(JSON.parse(JSON.stringify(B.plain(s))));
  assert.deepEqual(plain(back.grid), plain(s.grid));
  assert.equal(back.tray.length, 3);
  assert.equal(B.sanitize(null), null);
  assert.equal(B.sanitize({ grid: [1, 2], tray: [] }), null);
  assert.equal(B.sanitize(Object.assign(B.plain(s), { grid: new Array(64).fill(9) })), null);
  assert.equal(B.sanitize(Object.assign(B.plain(s), { tray: [{ cells: [[7, 7]] }, s.tray[1], null] })).tray[0], null, 'фигура за пределами 5×5 отброшена');
});

test('подсветка: что очистится, если поставить фигуру сюда', () => {
  const s = state(['.#######']);
  assert.deepEqual(plain(B.preview(s.grid, piece(['#']), 0, 0)), { rows: [0], cols: [] });
  assert.equal(B.preview(s.grid, piece(['#']), 1, 0), null, 'нельзя поставить');
});

test('долгие случайные партии: очки не уменьшаются, клетки в порядке, партии заканчиваются', () => {
  for (let g = 0; g < 20; g++) {
    const rng = seeded(100 + g);
    let s = B.create(rng), n = 0;
    while (!s.over && n < 2000) {
      const options = [];
      s.tray.forEach((p, slot) => { if (p) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (B.canPlace(s.grid, p, x, y)) options.push([slot, x, y]); });
      assert.ok(options.length, 'партия не закончена — значит есть ход');
      const o = options[Math.floor(rng() * options.length)];
      const r = B.place(s, o[0], o[1], o[2], rng);
      assert.equal(r.ok, true);
      assert.ok(r.state.score >= s.score);
      s = r.state; n++;
    }
    assert.ok(s.over);
  }
});

test('мало места: новые фигуры удобные — все три можно поставить по очереди (если на поле вообще есть куда)', () => {
  const rng = seeded(21);
  let tight = 0;
  for (let k = 0; k < 120; k++) {
    // плотное поле со свободными участками
    const rows = []; for (let y = 0; y < 8; y++) rows.push([...'########'].map(() => (rng() < 0.62 ? '#' : '.')).join(''));
    const s = state(rows, [piece(['#']), null, null]);
    const free = s.grid.findIndex((v) => !v);
    if (free < 0) continue;
    const r = B.place(s, 0, free % 8, Math.floor(free / 8), rng);
    const empty = r.state.grid.filter((v) => !v).length;
    if (empty >= B.TIGHT || empty < 4) continue;
    tight++;
    assert.ok(B.solvable(r.state.grid, r.state.tray.filter(Boolean)), 'все три встают по очереди');
  }
  assert.ok(tight > 30, 'проверено тесных полей: ' + tight);
});
