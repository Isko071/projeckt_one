// Перенос прогресса из браузера в серверный кошелёк: только для аккаунтов, появившихся до даты запуска (ledger в памяти)
const test = require('node:test');
const assert = require('node:assert');
const { MemLedger } = require('../ledger');
const { WalletService } = require('../wallet-service');

const BEFORE = Date.parse('2026-10-12T00:00:00Z');
async function svc(sinces, seeds) {
  const ledger = new MemLedger({ sinces, seeds });
  const s = new WalletService({ ledger, seedBefore: BEFORE });
  await s.init();
  return s;
}
const seed = { balance: 40000, streak: 9, best: 9, playDay: '2026-10-10' };

test('аккаунт старше даты запуска: прогресс из браузера принимается', async () => {
  const s = await svc({ A: Date.parse('2026-10-08T10:00:00Z') });
  const r = await s.act('A', { op: 'sync', seed, tz: 0 });
  assert.strictEqual(r.state.balance, 40000);
  assert.strictEqual(r.state.streak, 9);
});

test('новый аккаунт: присланный прогресс игнорируется, старт 5000', async () => {
  const s = await svc({ B: Date.parse('2026-10-12T09:00:00Z') });
  const r = await s.act('B', { op: 'sync', seed, tz: 0 });
  assert.strictEqual(r.state.balance, 5000);
  assert.strictEqual(r.state.streak, 0);
});

test('нет документов аккаунта: тоже обычный старт', async () => {
  const ledger = new MemLedger({ seeds: { C: 30000 } });
  ledger.accountSince = async () => null;
  const s = new WalletService({ ledger, seedBefore: BEFORE }); await s.init();
  const r = await s.act('C', { op: 'sync', seed, tz: 0 });
  assert.strictEqual(r.state.balance, 5000);
});

test('баланс из рейтинга старого аккаунта по-прежнему переносится, у нового нет', async () => {
  const s = await svc({ D: 0, E: Date.parse('2026-10-13T00:00:00Z') }, { D: 7000, E: 7000 });
  assert.strictEqual((await s.act('D', { op: 'sync' })).state.balance, 7000);
  assert.strictEqual((await s.act('E', { op: 'sync' })).state.balance, 5000);
});
