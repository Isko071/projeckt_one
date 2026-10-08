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

test('бонус дня: только после игры; 500, потом +250 за день, потолок 2000 на 7-й день', () => {
  const W = load({ localStorage: fakeBackend() });
  assert.equal(W.claimDaily().claimed, false, 'без игры бонуса нет');
  const amounts = [];
  for (let d = 1; d <= 9; d++) {
    const m = W.markPlayed(D(2026, 3, d));
    assert.equal(m.counted, true);
    const r = W.claimDaily();
    assert.equal(r.claimed, true);
    amounts.push(r.amount);
  }
  assert.deepEqual(amounts, [500, 750, 1000, 1250, 1500, 1750, 2000, 2000, 2000]);
  assert.equal(W.claimDaily().claimed, false, 'второй раз за день нельзя');
  // разовые бонусы серии: 3 дня +250, 7 дней +1000
  assert.equal(W.getBalance(), 5000 + amounts.reduce((a, b) => a + b) + 250 + 1000);
});

test('серия: вторая игра в тот же день её не продлевает; бонус дня один', () => {
  const W = load({ localStorage: fakeBackend() });
  assert.equal(W.markPlayed(D(2026, 3, 1, 9)).counted, true);
  assert.equal(W.markPlayed(D(2026, 3, 1, 22)).counted, false);
  assert.equal(W.dailyStatus(D(2026, 3, 1, 23)).streak, 1);
  assert.equal(W.claimDaily().amount, 500);
  assert.equal(W.claimDaily().claimed, false);
});

test('серия: пропущенный день сжигает её, лучший результат остаётся; граница года', () => {
  const W = load({ localStorage: fakeBackend() });
  W.markPlayed(D(2026, 12, 30)); W.markPlayed(D(2026, 12, 31));
  assert.equal(W.markPlayed(D(2027, 1, 1)).streak, 3, 'через границу года серия продолжается');
  assert.equal(W.dailyStatus(D(2027, 1, 2)).streak, 3, 'сегодня ещё не играли, но серия жива');
  assert.equal(W.dailyStatus(D(2027, 1, 2)).atRisk, true);
  assert.equal(W.dailyStatus(D(2027, 1, 3)).streak, 0, 'пропустили день — серия сгорела');
  assert.equal(W.dailyStatus(D(2027, 1, 3)).atRisk, false);
  assert.equal(W.markPlayed(D(2027, 1, 3)).streak, 1);
  const st = W.dailyStatus(D(2027, 1, 3));
  assert.equal(st.best, 3);
  assert.equal(st.nextAmount, 750);
  assert.equal(st.nextMilestone, 3);
});

test('неполученный бонус не пропадает: выплачивается при следующей игре', () => {
  const W = load({ localStorage: fakeBackend() });
  W.markPlayed(D(2026, 4, 1));               // бонус 500 ждёт
  W.markPlayed(D(2026, 4, 2));               // забыли забрать вчерашний — он выплачен сам
  assert.equal(W.getBalance(), 5500);
  assert.equal(W.dailyStatus(D(2026, 4, 2)).pending.amount, 750);
});

test('длинные серии: разовые бонусы на 14, 30, 60 и 100 дни', () => {
  const W = load({ localStorage: fakeBackend() });
  const bonuses = {};
  for (let d = 0; d < 100; d++) {
    const m = W.markPlayed(D(2026, 1, 1) + d * 86400000);
    if (m.bonus) bonuses[m.streak] = m.bonus;
    W.claimDaily();
  }
  assert.deepEqual(bonuses, { 3: 250, 7: 1000, 14: 3000, 30: 10000, 60: 25000, 100: 50000 });
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

test('журнал: последние 20 операций, новые сверху', () => {
  const W = load({ localStorage: fakeBackend() });
  for (let i = 1; i <= 25; i++) W.add(i, 'x' + i);
  const log = plain(W.getLog());
  assert.equal(log.length, 20);
  assert.equal(log[0].source, 'x25');
  assert.equal(W.reset, undefined, 'сброса аконов нет: цель — копить');
});

test('повреждённые данные не ломают кошелёк', () => {
  [null, 'abc', 42, [], { balance: -5 }, { balance: 'много' }, { balance: 1.5 }, { balance: 7, log: 'x', streak: 99, lastClaim: 'вчера' }].forEach((bad) => {
    const backend = fakeBackend();
    backend.data['platform:wallet'] = JSON.stringify(bad);
    const W = load({ localStorage: backend });
    assert.ok(Number.isInteger(W.getBalance()) && W.getBalance() >= 0, JSON.stringify(bad));
    assert.ok(W.dailyStatus(D(2026, 1, 1)).nextAmount >= 500);
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
  W.markPlayed(D(2026, 1, 1));
  assert.equal(W.claimDaily().claimed, true);
});

test('подписчики получают новый баланс; сломанный подписчик не мешает', () => {
  const W = load({ localStorage: fakeBackend() });
  const seen = [];
  W.onChange(() => { throw new Error('boom'); });
  W.onChange((b) => seen.push(b));
  W.spend(100, 'bet'); W.add(50, 'win');
  assert.deepEqual(seen, [4900, 4950]);
});

test('награды: настроены для сапёра и ятзи и укладываются в дневной лимит', () => {
  const W = load({ localStorage: fakeBackend() });
  const r = plain(W.CONFIG.rewards);
  assert.deepEqual(r, { minesweeper: { novice: 100, amateur: 250, expert: 400 }, yahtzee: { easy: 100, hard: 250 } });
  const now = D(2026, 8, 1);
  // 3 победы эксперта и новичок: 400*3 = 1200, затем 100 влезает, ещё 400 упирается в лимит 1500
  for (let i = 0; i < 3; i++) assert.equal(W.earn('minesweeper', r.minesweeper.expert, now).granted, 400);
  assert.equal(W.earn('yahtzee', r.yahtzee.easy, now).granted, 100);
  const last = W.earn('minesweeper', r.minesweeper.expert, now);
  assert.deepEqual(plain(last), { granted: 200, capped: true });
});

test('рекорды: максимум аконов за всё время не падает при тратах; победы и лучшая серия', () => {
  const W = load({ localStorage: fakeBackend() });
  assert.deepEqual(plain(W.records()), { peak: 5000, bestStreak: 0, wins: {} });
  W.add(3000, 'win');
  W.spend(7000, 'bet');
  W.earn('minesweeper', 100, D(2026, 9, 1));
  W.earn('minesweeper', 100, D(2026, 9, 1));
  W.earn('yahtzee', 250, D(2026, 9, 1));
  W.markPlayed(D(2026, 9, 1)); W.markPlayed(D(2026, 9, 2));
  assert.deepEqual(plain(W.records()), { peak: 8000, bestStreak: 2, wins: { minesweeper: 2, yahtzee: 1 } });
});

test('рекорды: победа при исчерпанном лимите всё равно засчитывается; мусор в данных отбрасывается', () => {
  const backend = fakeBackend();
  backend.data['platform:wallet'] = JSON.stringify({ balance: 100, peak: 'много', wins: { a: -1, b: 2.5, c: 3, [`${'x'.repeat(60)}`]: 4 } });
  const W = load({ localStorage: backend });
  const rec = plain(W.records());
  assert.equal(rec.peak, 100);
  assert.deepEqual(Object.keys(rec.wins).map((k) => k.length), [1, 40]);
  const now = D(2026, 9, 1);
  W.earn('minesweeper', 1500, now);
  assert.equal(W.earn('minesweeper', 100, now).granted, 0);
  assert.equal(W.records().wins.minesweeper, 2);
});

test('победы в играх на ставки: countWin попадает в рекорды без начисления', () => {
  const W = load({ localStorage: fakeBackend() });
  W.countWin('blackjack'); W.countWin('blackjack');
  assert.deepEqual(plain(W.records().wins), { blackjack: 2 });
  assert.equal(W.getBalance(), 5000);
});
