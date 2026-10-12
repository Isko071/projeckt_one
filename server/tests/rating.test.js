// Рейтинг по балансу с сервера: баланс в строку рейтинга пишет сервер (ledger в памяти)
const test = require('node:test');
const assert = require('node:assert');
const { MemLedger } = require('../ledger');
const { WalletService } = require('../wallet-service');

async function mk(seeds) {
  const ledger = new MemLedger({ seeds }), svc = new WalletService({ ledger });
  await svc.init();
  return { ledger, svc };
}

test('рейтинг: баланс игрока уходит в строку рейтинга после изменения, залог входит в число', async () => {
  const { ledger, svc } = await mk({ A: 5000 });
  await svc.act('A', { op: 'sync' });
  assert.strictEqual(await svc.flushRatings(), 1);
  assert.strictEqual(ledger.ratings.get('A'), 5000);
  await svc.hold('A', 'ABCDE', 1200);                         // аконы за столом никуда не делись
  await svc.flushRatings();
  assert.strictEqual(ledger.ratings.get('A'), 5000, 'баланс 3800 + залог 1200');
  await svc.release('A', 'ABCDE', 2000);                      // выиграл у стола
  await svc.flushRatings();
  assert.strictEqual(ledger.ratings.get('A'), 5800);
});

test('рейтинг: неизменившееся число повторно не отправляется, сбой записи повторяется', async () => {
  const { ledger, svc } = await mk({ A: 5000 });
  await svc.act('A', { op: 'sync' });
  await svc.flushRatings();
  await svc.act('A', { op: 'sync' });
  assert.strictEqual(await svc.flushRatings(), 0, 'то же число: ничего не отправлено');
  let fail = 1; const set = ledger.setRating.bind(ledger);
  ledger.setRating = async (u, b) => { if (fail-- > 0) throw new Error('down'); return set(u, b); };
  await svc.act('A', { op: 'reward', source: 'blackjack', kind: 'win' });
  assert.strictEqual(await svc.flushRatings(), 0, 'запись не прошла');
  assert.strictEqual(await svc.flushRatings(), 1, 'повтор прошёл');
  assert.strictEqual(ledger.ratings.get('A'), 5250);
});

test('рейтинг: при запуске балансы всех игроков с кошельком записываются в рейтинг', async () => {
  const { ledger, svc } = await mk({ A: 7000, B: 3000 });
  await svc.act('A', { op: 'sync' }); await svc.act('B', { op: 'sync' });
  const fresh = new WalletService({ ledger }); await fresh.init();
  fresh.startRatings();
  await new Promise((r) => setTimeout(r, 30));
  await fresh.flushRatings();
  fresh.stopRatings();
  assert.strictEqual(ledger.ratings.get('A'), 7000);
  assert.strictEqual(ledger.ratings.get('B'), 3000);
});
