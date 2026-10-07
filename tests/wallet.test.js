// Запуск: node --test tests/wallet.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
function load(ctx) {
  const context = vm.createContext(ctx || {});
  ['shared/storage.js', 'shared/wallet.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f }));
  return context.PlatformWallet;
}
function fakeBackend() {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}
const plain = (x) => JSON.parse(JSON.stringify(x));
const D = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test('кошелёк: старт 5000, запись в platform:wallet', () => {
  const backend = fakeBackend();
  const W = load({ localStorage: backend });
  assert.equal(W.getBalance(), 5000);
  W.add(100, 'test');
  assert.equal(JSON.parse(backend.data['platform:wallet']).balance, 5100);
});

test('кошелёк: ставка списывается, при нехватке отказ без изменений', () => {
  const W = load({ localStorage: fakeBackend() });
  assert.equal(W.spend(500, 'bet'), true);
  assert.equal(W.getBalance(), 4500);
  assert.equal(W.spend(5000, 'bet'), false);
  assert.equal(W.getBalance(), 4500);
  assert.equal(W.canAfford(4500), true);
  assert.equal(W.canAfford(4501), false);
  [0, -5, 1.5, NaN, '10', null].forEach((bad) => assert.equal(W.spend(bad), false, String(bad)));
  assert.equal(W.getBalance(), 4500);
});

test('ежедневный бонус: 500, раз в день, серия растёт до 2000 на 7-й день', () => {
  const W = load({ localStorage: fakeBackend() });
  const amounts = [];
  for (let d = 1; d <= 9; d++) {
    const r = W.claimDaily(D(2026, 3, d));
    assert.equal(r.claimed, true);
    amounts.push(r.amount);
  }
  assert.deepEqual(amounts, [500, 750, 1000, 1250, 1500, 1750, 2000, 2000, 2000]);
  assert.equal(W.claimDaily(D(2026, 3, 9, 20)).claimed, false, 'второй раз за день нельзя');
  assert.equal(W.getBalance(), 5000 + amounts.reduce((a, b) => a + b));
});

test('ежедневный бонус: пропущенный день сбрасывает серию; граница месяца и года', () => {
  const W = load({ localStorage: fakeBackend() });
  W.claimDaily(D(2026, 12, 30)); W.claimDaily(D(2026, 12, 31));
  assert.equal(W.claimDaily(D(2027, 1, 1)).day, 3, 'через границу года серия продолжается');
  assert.equal(W.claimDaily(D(2027, 1, 3)).day, 1, 'пропуск дня — снова с первого');
  assert.deepEqual(plain(W.dailyStatus(D(2027, 1, 3, 23))), { available: false, day: 1, amount: 750, streak: 1 });
});

test('награды за одиночные игры: дневной лимит 1500, на следующий день снова', () => {
  const W = load({ localStorage: fakeBackend() });
  const now = D(2026, 5, 1);
  assert.deepEqual(plain(W.earn('minesweeper', 400, now)), { granted: 400, capped: false });
  assert.deepEqual(plain(W.earn('minesweeper', 1000, now)), { granted: 1000, capped: false });
  assert.deepEqual(plain(W.earn('minesweeper', 400, now)), { granted: 100, capped: true });
  assert.deepEqual(plain(W.earn('minesweeper', 400, now)), { granted: 0, capped: true });
  assert.equal(W.earn('minesweeper', 400, D(2026, 5, 2)).granted, 400);
  assert.equal(W.getBalance(), 5000 + 1500 + 400);
});

test('помощь при нехватке: только если меньше минимальной ставки и раз в день', () => {
  const W = load({ localStorage: fakeBackend() });
  const now = D(2026, 6, 1);
  assert.equal(W.claimRelief(now).claimed, false, 'при 5000 помощь не нужна');
  W.spend(4990, 'bet');
  assert.equal(W.getBalance(), 10);
  assert.equal(W.claimRelief(now).claimed, true);
  assert.equal(W.getBalance(), 510);
  W.spend(500, 'bet');
  assert.equal(W.claimRelief(now).claimed, false, 'второй раз за день нельзя');
  assert.equal(W.claimRelief(D(2026, 6, 2)).claimed, true);
});

test('журнал: последние 20 операций, новые сверху; сброс возвращает старт', () => {
  const W = load({ localStorage: fakeBackend() });
  for (let i = 1; i <= 25; i++) W.add(i, 'x' + i);
  const log = plain(W.getLog());
  assert.equal(log.length, 20);
  assert.equal(log[0].source, 'x25');
  assert.equal(W.reset(), 5000);
  assert.equal(W.getLog().length, 0);
});

test('повреждённые данные не ломают кошелёк', () => {
  [null, 'abc', 42, [], { balance: -5 }, { balance: 'много' }, { balance: 1.5 }, { balance: 7, log: 'x', streak: 99, lastClaim: 'вчера' }].forEach((bad) => {
    const backend = fakeBackend();
    backend.data['platform:wallet'] = JSON.stringify(bad);
    const W = load({ localStorage: backend });
    assert.ok(Number.isInteger(W.getBalance()) && W.getBalance() >= 0, JSON.stringify(bad));
    assert.ok(W.dailyStatus(D(2026, 1, 1)).amount >= 500);
  });
  const backend = fakeBackend();
  backend.data['platform:wallet'] = '{не json';
  assert.equal(load({ localStorage: backend }).getBalance(), 5000);
});

test('хранилище недоступно: кошелёк работает до перезагрузки', () => {
  const W = load({ get localStorage() { throw new Error('blocked'); } });
  assert.equal(W.getBalance(), 5000);
  W.spend(100, 'bet');
  assert.equal(W.getBalance(), 4900);
  assert.equal(W.claimDaily(D(2026, 1, 1)).claimed, true);
});

test('подписчики получают новый баланс; сломанный подписчик не мешает', () => {
  const W = load({ localStorage: fakeBackend() });
  const seen = [];
  W.onChange(() => { throw new Error('boom'); });
  W.onChange((b) => seen.push(b));
  W.spend(100, 'bet'); W.add(50, 'win');
  assert.deepEqual(seen, [4900, 4950]);
});
