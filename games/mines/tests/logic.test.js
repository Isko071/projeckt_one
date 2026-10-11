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

test('награда по шансу: накопленное после n клеток = штраф × (1 − P) / P × 0,95, округлено до 5; игра слегка в минус', () => {
  assert.deepEqual([1, 2, 3, 4].map(M.cellReward), [20, 40, 65, 90]);
  assert.deepEqual([1, 2, 3, 4].map((n) => M.rewardFor(3, n)), [65, 75, 95, 110]);
  assert.deepEqual([1, 2, 3].map((n) => M.rewardFor(10, n)), [315, 565, 1045]);
  assert.equal(M.cellReward(24), 4560); assert.equal(M.cellReward(0), 20); assert.equal(M.cellReward(99), 4560); assert.equal(M.cellReward('x'), 20);
  assert.equal(M.safeCells(5), 20); assert.equal(M.maxReward(24), 4560); assert.equal(M.maxReward(1), 10000, 'потолок накопленного');
  for (let m = 1; m <= 24; m++) {
    let prev = 0;
    for (let k = 1; k <= M.safeCells(m); k++) {
      const total = M.totalFor(m, k), p = M.surviveChance(m, k), ev = p * total - (1 - p) * M.lossFor(m);
      assert.ok(total >= prev, 'накопленное не уменьшается: ' + m + '/' + k); prev = total;
      if (total < M.CONFIG.cap) assert.ok(ev < 0 && ev > -0.05 * M.lossFor(m) * (1 - p) - 3, 'в среднем чуть в минус: ' + m + '/' + k + ' ' + ev);
      else assert.ok(ev <= 0, 'у потолка не в плюс: ' + m + '/' + k);
    }
  }
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
  assert.equal(st.earned, M.rewardFor(3, 1)); assert.equal(st.openedCount, 1); assert.equal(st.status, 'playing');
  r = M.reduce(st, { type: 'open', index: firstSafe(st) }); st = r.state;
  assert.equal(st.earned, M.totalFor(3, 2));
  r = M.reduce(st, { type: 'cashout' });
  assert.equal(r.ok, true); assert.equal(r.state.status, 'cashed'); assert.equal(r.state.payout, M.totalFor(3, 2));
  assert.equal(M.reduce(r.state, { type: 'open', index: 0 }).error, 'round-over');
});

test('мина: накопленное сгорает, раунд проигран, мины открываются', () => {
  let st = M.init(4, seeded(3));
  st = M.reduce(st, { type: 'open', index: firstSafe(st) }).state;
  const r = M.reduce(st, { type: 'open', index: firstMine(st) });
  assert.equal(r.state.status, 'lost'); assert.equal(r.state.payout, 0); assert.equal(r.state.hit, firstMine(st));
  assert.deepEqual(plain(r.events), [{ type: 'mine', index: firstMine(st), lost: M.rewardFor(4, 1) }]);
  assert.equal(M.view(r.state).layout.length, 25);
});

test('все безопасные клетки открыты: раунд заканчивается сам, накопленное засчитано', () => {
  let st = M.init(24, seeded(5));
  const r = M.reduce(st, { type: 'open', index: firstSafe(st) });
  assert.equal(r.state.status, 'cleared'); assert.equal(r.state.payout, 4560);
  let big = M.init(1, seeded(9)), n = 0;
  while (big.status === 'playing') { big = M.reduce(big, { type: 'open', index: firstSafe(big) }).state; n++; }
  assert.equal(n, 24); assert.equal(big.status, 'cleared'); assert.equal(big.payout, 10000);
});

test('проверки: повторная клетка, выход за поле, неизвестное действие; вид не выдаёт мины до конца', () => {
  let st = M.init(3, seeded(2)); const i = firstSafe(st);
  st = M.reduce(st, { type: 'open', index: i }).state;
  assert.equal(M.reduce(st, { type: 'open', index: i }).error, 'already-open');
  [-1, 25, 1.5, 'a'].forEach((x) => assert.equal(M.reduce(st, { type: 'open', index: x }).error, 'bounds'));
  assert.equal(M.reduce(st, { type: 'dig' }).error, 'bad-action'); assert.equal(M.reduce(st, null).error, 'bad-action');
  const v = M.view(st);
  assert.equal(v.layout, null); assert.equal(v.next, 75); assert.equal(v.left, 21);
});

test('штраф за мину: 500 при 1–10 минах, 200 при 11–24', () => {
  assert.deepEqual([1, 5, 10, 11, 12, 24].map(M.lossFor), [500, 500, 500, 200, 200, 200]);
  assert.equal(M.lossFor(0), 500); assert.equal(M.lossFor(99), 200);
  let g = M.init(5, seeded(4)); g = M.reduce(g, { type: 'open', index: firstSafe(g) }).state; g = M.reduce(g, { type: 'open', index: firstSafe(g) }).state;
  assert.equal(g.earned, M.totalFor(5, 2)); assert.equal(M.view(g).next, M.rewardFor(5, 3));
});
