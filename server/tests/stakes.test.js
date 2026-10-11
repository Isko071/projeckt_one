// Серверный кошелёк и ставки за столами (ledger в памяти)
const test = require('node:test');
const assert = require('node:assert');
const { loadEngine } = require('../load-engine');
const { RoomManager } = require('../manager');
const { MemLedger } = require('../ledger');
const { WalletService } = require('../wallet-service');

const engine = loadEngine();
function conn(uid) { const c = { uid, msgs: [], send(o) { this.msgs.push(o); } }; c.last = () => { const d = c.msgs.filter((m) => m.t === 'doc'); return d.length ? d[d.length - 1].doc : null; }; c.wallet = () => { const w = c.msgs.filter((m) => m.t === 'wallet'); return w.length ? w[w.length - 1].state : null; }; return c; }
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 40));
async function mk(seeds) {
  const ledger = new MemLedger({ seeds: seeds || {} }), wallet = new WalletService({ ledger });
  await wallet.init();
  const m = new RoomManager({ engine, wallet, config: { engineOptions: { startDelayMs: 0 }, strayMs: 50 } });
  return { m, wallet, ledger };
}
const bal = async (wallet, uid) => (await wallet.act(uid, { op: 'sync' })).state.balance;

test('ставка в «Ятзи»: залог при входе, победитель забирает банк', async () => {
  const { m, wallet } = await mk(), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'yahtzee', { size: 2, mode: 'turns', name: 'Аня', stake: 200 });
  assert.strictEqual(await bal(wallet, 'A'), 4800);
  await m.join(b, 'yahtzee', code, { name: 'Боря' });
  assert.strictEqual(await bal(wallet, 'B'), 4800);
  assert.strictEqual(m.list('yahtzee')[0] === undefined ? 0 : m.list('yahtzee')[0].stake, 200);
  await settle();
  m.act(a, code, { type: 'start' });
  await settle();
  m.leave(b, code);                                   // Боря вышел посреди партии: остался один, победил
  await settle(80);
  assert.strictEqual(await bal(wallet, 'A'), 5200, 'банк 400 у победителя');
  assert.strictEqual(await bal(wallet, 'B'), 4800, 'вышедший ставку потерял');
  assert.strictEqual(a.wallet().balance, 5200, 'сервер прислал победителю новый баланс');
});

test('ставка: не хватает аконов — вход и создание отклонены, ничего не списано', async () => {
  const { m, wallet } = await mk({ P: 100 }), a = conn('A'), p = conn('P');
  await assert.rejects(m.create(p, 'yahtzee', { size: 2, mode: 'turns', name: 'Бедный', stake: 500 }), /no-funds/);
  assert.strictEqual(await bal(wallet, 'P'), 100);
  assert.strictEqual(m.rooms.size, 0);
  const code = await m.create(a, 'yahtzee', { size: 2, mode: 'turns', name: 'Аня', stake: 500 });
  await assert.rejects(m.join(p, 'yahtzee', code, { name: 'Бедный' }), /no-funds/);
  assert.strictEqual(await bal(wallet, 'P'), 100);
});

test('ставка: проверки размера, игры без ставок и выключенный кошелёк', async () => {
  const { m } = await mk(), a = conn('A');
  await assert.rejects(m.create(a, 'yahtzee', { size: 2, mode: 'turns', stake: 5 }), /bad-stake/);
  await assert.rejects(m.create(a, 'yahtzee', { size: 2, mode: 'turns', stake: 99999999 }), /bad-stake/);
  await assert.rejects(m.create(a, 'blackjack', { size: 2, stake: 100 }), /no-stakes/);
  const off = new RoomManager({ engine, config: { engineOptions: { startDelayMs: 0 } } });
  await assert.rejects(off.create(a, 'yahtzee', { size: 2, mode: 'turns', stake: 100 }), /stakes-off/);
  assert.ok(await off.create(a, 'yahtzee', { size: 2, mode: 'turns' }), 'без ставки стол создаётся как раньше');
});

test('ставка: выход из комнаты ожидания возвращает залог', async () => {
  const { m, wallet } = await mk(), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'battleship', { size: 2, name: 'Аня', stake: 300 });
  await m.join(b, 'battleship', code, { name: 'Боря' });
  await settle();
  assert.strictEqual(await bal(wallet, 'B'), 4700);
  m.leave(b, code);
  await settle(80);
  assert.strictEqual(await bal(wallet, 'B'), 5000);
  assert.strictEqual(await bal(wallet, 'A'), 4700, 'создатель остался за столом, его залог на месте');
});

test('«Морской бой»: победитель забирает банк', async () => {
  const { m, wallet } = await mk(), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'battleship', { size: 2, name: 'Аня', stake: 250 });
  await m.join(b, 'battleship', code, { name: 'Боря' });
  await settle();
  m.act(a, code, { type: 'start' });
  await settle();
  const B = engine.Battleship;
  [a, b].forEach((c, seat) => m.act(c, code, { type: 'place', seat, ships: B.randomLayout(), arsenal: { radar: 1, sub: 1, bomber: 2 } }));
  await settle(80);
  m.act(a, code, { type: 'concede', seat: 0 });
  await settle(80);
  assert.strictEqual(await bal(wallet, 'B'), 5250, 'банк 500: 4750 + 500');
  assert.strictEqual(await bal(wallet, 'A'), 4750);
});

test('стол закрыт или исчез до конца партии: залоги возвращаются', async () => {
  const { m, wallet } = await mk(), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'yahtzee', { size: 2, mode: 'turns', name: 'Аня', stake: 100 });
  await m.join(b, 'yahtzee', code, { name: 'Боря' });
  await settle();
  m.remove(code);
  await settle(80);
  assert.strictEqual(await bal(wallet, 'A'), 5000);
  assert.strictEqual(await bal(wallet, 'B'), 5000);
});

test('перезапуск сервера: залоги прошлого запуска возвращаются при старте', async () => {
  const ledger = new MemLedger(), w1 = new WalletService({ ledger });
  await w1.init();
  assert.ok((await w1.hold('A', 'ABCDE', 700)).ok);
  assert.strictEqual(w1.balanceOf('A'), 4300);
  const w2 = new WalletService({ ledger });             // «новый запуск»: те же данные в ledger
  assert.strictEqual(await w2.init(), 1);
  assert.strictEqual((await w2.act('A', { op: 'sync' })).state.balance, 5000);
  assert.strictEqual((await ledger.list('holds')).length, 0);
});

test('кошелёк: награда считается сервером по своим суммам, пределы работают, лишнее отклоняется', async () => {
  const { wallet } = await mk();
  const r = await wallet.act('A', { op: 'reward', source: 'blackjack', kind: 'blackjack' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.result)), { granted: 400, capped: false, left: 2600 });
  assert.strictEqual(r.state.balance, 5400);
  await assert.rejects(wallet.act('A', { op: 'reward', source: 'blackjack', kind: 'jackpot' }), /bad-request/);
  await assert.rejects(wallet.act('A', { op: 'add', n: 1e9 }), /bad-request/);
  await assert.rejects(wallet.act('A', { op: 'earn', source: 'minesweeper', level: 'impossible' }), /bad-request/);
  for (let i = 0; i < 20; i++) await wallet.act('A', { op: 'reward', source: 'blackjack', kind: 'win' });
  assert.strictEqual((await wallet.act('A', { op: 'sync' })).state.balance, 5000 + 3000, 'не больше предела 3000 в день');
});

test('кошелёк: отказ ledger не меняет баланс и не оставляет залога', async () => {
  const { wallet, ledger } = await mk();
  ledger.failNext = 1;
  await assert.rejects(wallet.hold('A', 'XYZ12', 100), /ledger/);
  assert.strictEqual((await wallet.act('A', { op: 'sync' })).state.balance, 5000);
  assert.strictEqual((await ledger.list('holds')).length, 0);
});
