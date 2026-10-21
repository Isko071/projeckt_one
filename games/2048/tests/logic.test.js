// Запуск: node --test games/2048/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ JSON, Math, Object, Array, Number, String, Error });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8'), ctx);
const G = ctx.G2048;
const plain = (x) => JSON.parse(JSON.stringify(x));
function seeded(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
// Поле из строк: 0 — пусто
function board(rows) {
  const tiles = []; let id = 1;
  rows.forEach((r, y) => r.forEach((v, x) => { if (v) tiles.push({ id: id++, v, i: y * 4 + x }); }));
  return { size: 4, tiles, nextId: id, score: 0, moves: 0, maxTile: Math.max(0, ...tiles.map((t) => t.v)), over: false, got: [] };
}
function grid(s) { const g = [0, 0, 0, 0].map(() => [0, 0, 0, 0]); s.tiles.forEach((t) => { g[Math.floor(t.i / 4)][t.i % 4] = t.v; }); return g; }
const never = () => 0.95;          // новая плитка — четвёрка в первой пустой клетке

test('новая партия: две плитки 2 или 4 в разных клетках', () => {
  for (let k = 0; k < 50; k++) {
    const s = G.create(seeded(k + 1));
    assert.equal(s.tiles.length, 2);
    assert.notEqual(s.tiles[0].i, s.tiles[1].i);
    s.tiles.forEach((t) => assert.ok(t.v === 2 || t.v === 4));
    assert.equal(s.score, 0);
  }
});

test('сдвиг влево: плитки съезжают к краю, одинаковые сливаются один раз, очки за слияния', () => {
  const s = board([[2, 2, 2, 2], [0, 4, 0, 4], [2, 0, 4, 8], [8, 8, 16, 0]]);
  const r = G.move(s, 'left', () => 0);
  assert.equal(r.ok, true);
  const g = grid(r.state);
  assert.deepEqual(g[0].slice(0, 2), [4, 4], '2 2 2 2 → 4 4 (каждая плитка сливается не больше раза)');
  assert.deepEqual(g[1].slice(0, 1), [8]);
  assert.deepEqual(g[2].slice(0, 3), [2, 4, 8]);
  assert.deepEqual(g[3].slice(0, 2), [16, 16], '8 8 16 → 16 16, а не 32');
  assert.equal(r.gained, 4 + 4 + 8 + 16);
  assert.equal(r.state.score, 32);
  assert.equal(r.state.tiles.filter((t) => t.fresh).length, 1, 'после хода новая плитка');
});

test('все четыре направления', () => {
  const s = board([[2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 0]]);
  assert.deepEqual(grid(G.move(s, 'right', never).state)[0].slice(3), [4]);
  assert.equal(grid(G.move(s, 'up', never).state)[0][0], 4);
  assert.equal(grid(G.move(s, 'down', never).state)[3][0], 4);
  assert.equal(grid(G.move(s, 'left', never).state)[0][0], 4);
});

test('ход без изменений не считается: нет новой плитки, состояние то же', () => {
  const s = board([[2, 4, 8, 16], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.equal(G.move(s, 'left', never).ok, false);
  assert.equal(G.move(s, 'up', never).ok, false);
  assert.equal(G.move(s, 'down', never).ok, true);
  assert.equal(G.move(s, 'diag', never).ok, false);
});

test('анимация: каждая плитка прошлого поля знает, куда поехала; слитые едут в клетку слияния', () => {
  const s = board([[0, 2, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  const r = G.move(s, 'left', never);
  assert.deepEqual(plain(r.slides).sort((a, b) => a.id - b.id), [{ id: 1, to: 0 }, { id: 2, to: 0 }]);
  const m = r.state.tiles.find((t) => t.merged);
  assert.equal(m.v, 4); assert.equal(m.i, 0);
  assert.ok(m.id > 2, 'у новой плитки новый номер');
});

test('конец игры: поле заполнено и соседей с одинаковым числом нет', () => {
  const full = board([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]);
  assert.equal(G.canMove(full), false);
  const one = board([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 4]]);
  assert.equal(G.canMove(one), true);
  // последний ход заполняет поле без пар — партия закончена
  const almost = board([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [0, 2, 4, 8]]);
  const r = G.move(almost, 'right', () => 0);
  assert.equal(r.ok, false, 'в этой строке ехать некуда');
  const r2 = G.move(board([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [8, 2, 4, 0]]), 'right', () => 0);
  assert.equal(r2.ok, true);
  assert.equal(r2.state.tiles.length, 16);
  assert.equal(r2.state.over, !G.canMove(r2.state));
  assert.equal(G.move(Object.assign({}, full, { over: true }), 'left', never).ok, false);
});

test('вехи 512, 1024, 2048: каждая один раз за партию', () => {
  const s = board([[256, 256, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  const r = G.move(s, 'left', never);
  assert.deepEqual(plain(G.newMilestones(r.state)), [512]);
  assert.deepEqual(plain(G.newMilestones(r.state)), [], 'второй раз за ту же плитку не даётся');
  const big = board([[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  const r2 = G.move(big, 'left', never);
  assert.deepEqual(plain(G.newMilestones(r2.state)), [512, 1024, 2048], 'плитки меньше уже собранной тоже засчитываются, раз за партию не получены');
});

test('сохранённая партия: правильная восстанавливается, испорченная — нет', () => {
  const s = G.create(seeded(7));
  const back = G.sanitize(JSON.parse(JSON.stringify(G.plain(s))));
  assert.deepEqual(plain(grid(back)), plain(grid(s)));
  assert.equal(G.sanitize(null), null);
  assert.equal(G.sanitize({ tiles: [{ id: 1, v: 3, i: 0 }] }), null, 'не степень двойки');
  assert.equal(G.sanitize({ tiles: [{ id: 1, v: 2, i: 0 }, { id: 2, v: 2, i: 0 }] }), null, 'две плитки в одной клетке');
  assert.equal(G.sanitize({ tiles: [{ id: 1, v: 2, i: 16 }] }), null);
  assert.ok(G.sanitize({ tiles: [{ id: 5, v: 2, i: 0 }], nextId: 1 }).nextId > 5, 'номера новых плиток не повторяют старые');
});

test('долгая случайная партия: инварианты держатся', () => {
  const rng = seeded(99);
  let s = G.create(rng), moves = 0;
  while (!s.over && moves < 5000) {
    const dir = G.DIRS[Math.floor(rng() * 4)];
    const r = G.move(s, dir, rng);
    if (!r.ok) continue;
    const sum0 = s.tiles.reduce((a, t) => a + t.v, 0), sum1 = r.state.tiles.reduce((a, t) => a + t.v, 0);
    const fresh = r.state.tiles.find((t) => t.fresh);
    assert.equal(sum1 - (fresh ? fresh.v : 0), sum0, 'сумма плиток не меняется при слияниях');
    assert.equal(new Set(r.state.tiles.map((t) => t.i)).size, r.state.tiles.length);
    s = r.state; moves++;
  }
  assert.ok(s.over, 'партия заканчивается');
});
