// Клиент серверного баланса (shared/wallet-sync.js) против настоящего сервера с хранилищем в памяти
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer } = require('../index');
const { MemLedger } = require('../ledger');

const root = path.join(__dirname, '..', '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) { const t = Date.now(); while (Date.now() - t < (ms || 3000)) { if (fn()) return true; await wait(20); } return false; }

function client(port, uid, initial) {
  const data = {};
  Object.keys(initial || {}).forEach((k) => { data[k] = JSON.stringify(initial[k]); });
  const ctx = vm.createContext({
    JSON, Promise, Math, Object, Array, Number, String, Error, Date, isFinite, parseInt, setTimeout, clearTimeout, WebSocket,
    PlatformStorage: { get: (k, d) => (k in data ? JSON.parse(data[k]) : d), set: (k, v) => { data[k] = JSON.stringify(v); return true; } },
    PlatformCloud: { getState: () => ({ status: 'signedIn', user: { uid } }), onChange: () => {}, getToken: () => Promise.resolve('test:' + uid) },
    GAME_SERVER_URL: 'ws://localhost:' + port
  });
  ['shared/wallet.js', 'shared/wallet-sync.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
  return { W: ctx.PlatformWallet, S: ctx.PlatformWalletSync, data };
}

test('серверный баланс: копия берётся с сервера, награды идут серверу, add/spend в браузере запрещены', async () => {
  const ledger = new MemLedger({ seeds: { A: 7000 } });
  const s = await startServer({ insecure: true, ledger, config: { tickMs: 50 } });
  try {
    const c = client(s.port, 'A');
    assert.strictEqual(c.S.status(), 'connecting');
    assert.ok(await until(() => c.S.status() === 'server'), 'подключились и получили баланс');
    assert.strictEqual(c.W.getBalance(), 7000, 'баланс с сервера (по рейтингу), а не локальные 5000');
    assert.strictEqual(c.W.add(1000000, 'win'), false, 'прямое пополнение запрещено');
    assert.strictEqual(c.W.spend(10, 'x'), false);
    const r = c.W.reward('blackjack', 250, Date.now());
    assert.strictEqual(r.granted, 250);
    assert.strictEqual(c.W.getBalance(), 7250, 'экран отвечает сразу');
    assert.ok(await until(() => s.wallet.balanceOf('A') === 7250), 'и сервер записал награду');
    assert.strictEqual((await ledger.get('wallets', 'A')).balance, 7250);
    c.W.markPlayed(Date.now());
    c.W.claimDaily();
    assert.ok(await until(() => s.wallet.balanceOf('A') === 7750), 'бонус дня посчитан сервером (500)');
    assert.strictEqual(c.W.getBalance(), 7750);
    const sync = await c.S.call('sync');
    assert.strictEqual(sync.state.balance, 7750);
  } finally { await s.close(); }
});

test('серверный баланс: награда эксперта сапёра и «Ятзи» идут по таблице сервера, подделка суммы не проходит', async () => {
  const s = await startServer({ insecure: true, ledger: new MemLedger(), config: { tickMs: 50 } });
  try {
    const c = client(s.port, 'B');
    assert.ok(await until(() => c.S.status() === 'server'));
    c.W.earn('minesweeper', 999999, undefined, true, 'expert');      // локально клиент мог написать что угодно, серверу уходит только уровень
    assert.ok(await until(() => s.wallet.balanceOf('B') === 5300), 'сервер выдал 300 по своей таблице');
    assert.strictEqual(c.W.getBalance(), 5300, 'и копия исправилась до настоящего числа');
  } finally { await s.close(); }
});

test('сервер без серверного баланса: кошелёк остаётся в браузере', async () => {
  const s = await startServer({ insecure: true, ledger: null, config: { tickMs: 50 } });
  try {
    const c = client(s.port, 'C');
    assert.ok(await until(() => c.S.status() === 'local'));
    assert.strictEqual(c.W.add(100, 'win'), true);
    assert.strictEqual(c.W.getBalance(), 5100);
    assert.strictEqual(c.S.blocked(), false);
  } finally { await s.close(); }
});

test('очередь: награда, полученная до ответа сервера, не теряется', async () => {
  const s = await startServer({ insecure: true, ledger: new MemLedger(), config: { tickMs: 50 } });
  try {
    const c = client(s.port, 'D');
    assert.strictEqual(c.S.status(), 'connecting');
    c.W.reward('blackjack', 400, Date.now());              // сервер ещё не ответил
    assert.strictEqual(c.W.getBalance(), 5400);
    assert.ok(await until(() => c.S.status() === 'server'));
    assert.ok(await until(() => s.wallet.balanceOf('D') === 5400), 'награда доехала до сервера из очереди');
    await wait(300);
    assert.strictEqual(s.wallet.balanceOf('D'), 5400, 'и не засчиталась второй раз');
    assert.strictEqual(c.W.getBalance(), 5400);
    assert.deepStrictEqual(JSON.parse(c.data['platform:wallet-queue:D'] || '[]'), []);
  } finally { await s.close(); }
});

test('первый вход с серверным балансом: серия и баланс из браузера переезжают на сервер, а не сбрасываются', async () => {
  const s = await startServer({ insecure: true, ledger: new MemLedger({ seeds: { E: 1234 } }), config: { tickMs: 50 } });
  try {
    const c = client(s.port, 'E', { 'platform:wallet': { balance: 9000, streak: 4, best: 12, playDay: '2026-03-10', peak: 9000, days: ['2026-03-08', '2026-03-09', '2026-03-10'], wins: { yahtzee: 5 } } });
    assert.ok(await until(() => c.S.status() === 'server'));
    assert.strictEqual(c.W.getBalance(), 9000, 'не 5000 и не баланс рейтинга');
    const st = (await s.wallet.act('E', { op: 'sync' })).state;
    assert.strictEqual(st.streak, 4); assert.strictEqual(st.best, 12); assert.strictEqual(st.days.length, 3); assert.strictEqual(st.wins.yahtzee, 5);
  } finally { await s.close(); }
});

test('очередь привязана к игроку: награды прошлого аккаунта не уходят на счёт нового', async () => {
  // сервера нет (порт закрыт), поэтому запросы лежат в очереди
  const a = client(1, 'QA');
  a.W.reward('blackjack', 250, Date.now());
  assert.ok(a.data['platform:wallet-queue:QA'] && JSON.parse(a.data['platform:wallet-queue:QA']).length >= 1, 'очередь игрока QA');
  assert.ok(!('platform:wallet-queue' in a.data), 'общей очереди нет');
  const s = await startServer({ insecure: true, ledger: new MemLedger(), config: { tickMs: 50 } });
  try {
    const b = client(s.port, 'QB', a.data);                       // тот же браузер (хранилище), вошёл другой игрок
    assert.ok(await until(() => b.S.status() === 'server'));
    assert.strictEqual(b.W.getBalance(), 5000, 'чужие награды ему не засчитаны');
    assert.strictEqual(s.wallet.balanceOf('QB'), 5000);
  } finally { await s.close(); }
});

test('повторная отправка той же награды (вторая вкладка, потерянный ответ) засчитывается один раз', async () => {
  const s = await startServer({ insecure: true, ledger: new MemLedger(), config: { tickMs: 50 } });
  try {
    const first = client(s.port, 'QC');
    assert.ok(await until(() => first.S.status() === 'server'));
    first.W.reward('blackjack', 400, Date.now());
    assert.ok(await until(() => s.wallet.balanceOf('QC') === 5400));
    const item = JSON.parse(first.data['platform:wallet-queue:QC'] || '[]');
    assert.deepStrictEqual(item, [], 'очередь пуста после ответа');
    // «вторая вкладка» шлёт тот же запрос ещё раз (с тем же rid)
    const r1 = await s.wallet.act('QC', { op: 'reward', source: 'blackjack', kind: 'blackjack', rid: 'dup-rid-123456' });
    const r2 = await s.wallet.act('QC', { op: 'reward', source: 'blackjack', kind: 'blackjack', rid: 'dup-rid-123456' });
    assert.strictEqual(r1.state.balance, 5800); assert.strictEqual(r2.state.balance, 5800);
  } finally { await s.close(); }
});

test('запрос с задержкой показа: сначала на экране «до выплаты», потом настоящий баланс', async () => {
  const ledger = new MemLedger({ seeds: { A: 7000 } });
  const s = await startServer({ insecure: true, ledger, config: { tickMs: 50 } });
  try {
    const c = client(s.port, 'A');
    assert.ok(await until(() => c.S.status() === 'server'));
    const seen = [];
    c.W.onChange((b) => seen.push(b));
    const held = [];
    c.W.holdShown = (ms) => held.push(ms);
    await c.S.call('reward', { source: 'blackjack', kind: 'win' }, () => 900, () => 7000);
    assert.deepStrictEqual(seen, [7000, 7250], 'сперва число «до выплаты», затем итог');
    assert.deepStrictEqual(held, [900]);
    assert.strictEqual(c.W.getBalance(), 7250);
  } finally { await s.close(); }
});

test('очередь: у нового аккаунта (без переноса прогресса) награда до ответа сервера тоже засчитывается один раз', async () => {
  const s = await startServer({ insecure: true, ledger: new MemLedger({ sinces: { E: Date.now() } }), config: { tickMs: 50 } });
  try {
    const c = client(s.port, 'E');
    c.W.reward('blackjack', 400, Date.now());
    assert.ok(await until(() => c.S.status() === 'server'));
    assert.ok(await until(() => s.wallet.balanceOf('E') === 5400), 'награда доехала из очереди');
    await wait(300);
    assert.strictEqual(s.wallet.balanceOf('E'), 5400);
    assert.strictEqual(c.W.getBalance(), 5400);
  } finally { await s.close(); }
});
