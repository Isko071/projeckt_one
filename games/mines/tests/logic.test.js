// Запуск: node --test games/mines/tests/logic.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ Math, JSON, Object, Array, Number, isFinite });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8'), ctx);
const M = ctx.Mines;
const plain = (x) => JSON.parse(JSON.stringify(x));
function seeded(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const minesOf = (st) => st.layout.reduce((n, m) => n + (m ? 1 : 0), 0);
const firstSafe = (st) => st.layout.findIndex((m, i) => !m && !st.opened[i]);
const firstMine = (st) => st.layout.findIndex((m) => m);

test('награда за клетку: 10 × число мин; число мин ограничено 1…24', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 12, 24].map(M.cellReward), [10, 20, 30, 40, 50, 120, 240]);
  assert.equal(M.cellReward(0), 10); assert.equal(M.cellReward(99), 240); assert.equal(M.cellReward('x'), 10);
  assert.equal(M.safeCells(5), 20); assert.equal(M.maxReward(1), 240); assert.equal(M.maxReward(24), 240); assert.equal(M.maxReward(12), 1560);
});

test('раунд: ровно выбранное число мин на поле 25 клеток, у разных зёрен разные места', () => {
  for (let m = 1; m <= 24; m++) { const st = M.init(m, seeded(m)); assert.equal(st.layout.length, 25); assert.equal(minesOf(st), m); assert.equal(st.status, 'playing'); }
  assert.notDeepEqual(plain(M.init(5, seeded(1)).layout), plain(M.init(5, seeded(2)).layout));
});

test('безопасная клетка приносит аконы, раунд идёт дальше; забрать можно после первой клетки', () => {
  let st = M.init(3, seeded(7));
  assert.equal(M.reduce(st, { type: 'cashout' }).error, 'nothing-to-take');
  let r = M.reduce(st, { type: 'open', index: firstSafe(st) });
  assert.equal(r.ok, true); st = r.state;
  assert.equal(st.earned, 30); assert.equal(st.openedCount, 1); assert.equal(st.status, 'playing');
  r = M.reduce(st, { type: 'open', index: firstSafe(st) }); st = r.state;
  assert.equal(st.earned, 60);
  r = M.reduce(st, { type: 'cashout' });
  assert.equal(r.ok, true); assert.equal(r.state.status, 'cashed'); assert.equal(r.state.payout, 60);
  assert.equal(M.reduce(r.state, { type: 'open', index: 0 }).error, 'round-over');
});

test('мина: накопленное сгорает, раунд проигран, мины открываются', () => {
  let st = M.init(4, seeded(3));
  st = M.reduce(st, { type: 'open', index: firstSafe(st) }).state;
  const r = M.reduce(st, { type: 'open', index: firstMine(st) });
  assert.equal(r.state.status, 'lost'); assert.equal(r.state.payout, 0); assert.equal(r.state.hit, firstMine(st));
  assert.deepEqual(plain(r.events), [{ type: 'mine', index: firstMine(st), lost: 40 }]);
  assert.equal(M.view(r.state).layout.length, 25);
});

test('все безопасные клетки открыты: раунд заканчивается сам, накопленное засчитано', () => {
  let st = M.init(24, seeded(5));
  const r = M.reduce(st, { type: 'open', index: firstSafe(st) });
  assert.equal(r.state.status, 'cleared'); assert.equal(r.state.payout, 240);
  let big = M.init(1, seeded(9)), n = 0;
  while (big.status === 'playing') { big = M.reduce(big, { type: 'open', index: firstSafe(big) }).state; n++; }
  assert.equal(n, 24); assert.equal(big.status, 'cleared'); assert.equal(big.payout, 240);
});

test('проверки: повторная клетка, выход за поле, неизвестное действие; вид не выдаёт мины до конца', () => {
  let st = M.init(3, seeded(2)); const i = firstSafe(st);
  st = M.reduce(st, { type: 'open', index: i }).state;
  assert.equal(M.reduce(st, { type: 'open', index: i }).error, 'already-open');
  [-1, 25, 1.5, 'a'].forEach((x) => assert.equal(M.reduce(st, { type: 'open', index: x }).error, 'bounds'));
  assert.equal(M.reduce(st, { type: 'dig' }).error, 'bad-action'); assert.equal(M.reduce(st, null).error, 'bad-action');
  const v = M.view(st);
  assert.equal(v.layout, null); assert.equal(v.next, 30); assert.equal(v.left, 21);
});
