// 2048: награды за плитки 512, 1024, 2048 — партию сервер не видит, поэтому раз за партию и не раньше правдоподобного времени
const test = require('node:test');
const assert = require('node:assert');
const { MemLedger } = require('../ledger');
const { WalletService } = require('../wallet-service');

test('2048: награда за плитку — после начала партии, не раньше правдоподобного времени, раз за партию', async () => {
  const clock = { t: Date.UTC(2026, 9, 21, 9) }, ledger = new MemLedger(), svc = new WalletService({ ledger, now: () => clock.t });
  await svc.init();
  const bal = async () => (await svc.load('A')).balance;
  const earn = (level) => svc.act('A', { op: 'earn', source: '2048', level });
  await svc.act('A', { op: 'sync' });
  const b0 = await bal();
  await earn('t512');
  assert.strictEqual(await bal(), b0, 'без начала партии награды нет');
  await svc.act('A', { op: 'countPlay', source: '2048' });
  clock.t += 20000;
  await earn('t512');
  assert.strictEqual(await bal(), b0, 'за 20 секунд 512 не собрать');
  clock.t += 50000;
  await earn('t512');
  assert.strictEqual(await bal(), b0 + 50, 'через минуту с лишним — награда');
  await earn('t512');
  assert.strictEqual(await bal(), b0 + 50, 'второй раз за ту же партию не даётся');
  await earn('t1024');
  assert.strictEqual(await bal(), b0 + 50, '1024 так быстро не собрать');
  clock.t += 100000;
  await earn('t1024');
  assert.strictEqual(await bal(), b0 + 200);
  await assert.rejects(svc.act('A', { op: 'earn', source: '2048', level: 't4096' }), (e) => e.code === 'bad-request');
  // новая партия — награды снова доступны (с отсчётом времени заново)
  await svc.act('A', { op: 'countPlay', source: '2048' });
  await earn('t512');
  assert.strictEqual(await bal(), b0 + 200);
  clock.t += 61000;
  await earn('t512');
  assert.strictEqual(await bal(), b0 + 250);
});
