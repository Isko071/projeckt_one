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

// ---------- «Мины» на сервере ----------
const plainJ = (x) => JSON.parse(JSON.stringify(x));
async function minesSvc(seeds) { const ledger = new MemLedger({ seeds: seeds || {} }), svc = new WalletService({ ledger }); await svc.init(); return { svc, ledger }; }
const mineCell = (svc, uid) => svc.rounds.get(uid).layout.findIndex((x) => x);
const safeCell = (svc, uid) => { const r = svc.rounds.get(uid); return r.layout.findIndex((x, i) => !x && !r.opened[i]); };

test('«Мины» на сервере: клетки, «Забрать» и награда по правилам игры, мины клиенту не видны', async () => {
  const { svc } = await minesSvc();
  const st = await svc.act('A', { op: 'minesStart', mines: 3 });
  assert.strictEqual(st.result.mines.layout, null, 'пока раунд идёт, мин не видно');
  const o1 = await svc.act('A', { op: 'minesOpen', index: safeCell(svc, 'A') });
  assert.strictEqual(o1.result.mines.earned, 65);
  assert.strictEqual(o1.result.mines.layout, null);
  const o2 = await svc.act('A', { op: 'minesOpen', index: safeCell(svc, 'A') });
  assert.strictEqual(o2.result.mines.earned, 140);
  const cash = await svc.act('A', { op: 'minesCash' });
  assert.deepStrictEqual(plainJ(cash.result.rw), { granted: 140, lost: 0 });
  assert.strictEqual(cash.state.balance, 5140);
  assert.strictEqual(cash.result.mines.status, 'cashed');
  assert.strictEqual(cash.result.mines.layout.length, 25, 'после конца раунда мины показаны');
  assert.strictEqual(svc.rounds.has('A'), false);
  assert.strictEqual(cash.state.wins.mines, 1);
  assert.strictEqual(cash.state.plays.mines, 1);
});

test('«Мины» на сервере: мина сжигает накопленное и списывает штраф', async () => {
  const { svc } = await minesSvc();
  await svc.act('A', { op: 'minesStart', mines: 5 });
  await svc.act('A', { op: 'minesOpen', index: safeCell(svc, 'A') });
  const boom = await svc.act('A', { op: 'minesOpen', index: mineCell(svc, 'A') });
  assert.deepStrictEqual(plainJ(boom.result.rw), { granted: 0, lost: 500 });
  assert.strictEqual(boom.state.balance, 4500);
  assert.strictEqual(boom.result.mines.status, 'lost');
  await assert.rejects(svc.act('A', { op: 'minesOpen', index: 0 }), /no-round/);
});

test('«Мины» на сервере: нельзя играть без аконов на штраф, штраф не больше баланса, подделка запросов отклоняется', async () => {
  const { svc } = await minesSvc({ P: 300 });
  await assert.rejects(svc.act('P', { op: 'minesStart', mines: 3 }), /no-funds/);
  await svc.act('P', { op: 'minesStart', mines: 20 });                  // 20 мин: штраф 200, хватает
  await assert.rejects(svc.act('P', { op: 'minesCash' }), /bad-request/, 'забрать до первой клетки нельзя');
  await assert.rejects(svc.act('P', { op: 'minesOpen', index: 99 }), /bad-request/);
  await svc.act('P', { op: 'minesOpen', index: mineCell(svc, 'P') });
  assert.strictEqual(svc.balanceOf('P'), 100);
  const { svc: s2 } = await minesSvc();
  await s2.act('Q', { op: 'minesStart', mines: 1 });
  const i = safeCell(s2, 'Q');
  await s2.act('Q', { op: 'minesOpen', index: i });
  await assert.rejects(s2.act('Q', { op: 'minesOpen', index: i }), /bad-request/, 'повторная клетка');
  await assert.rejects(s2.act('Q', { op: 'minesOpen' }), /bad-request/);
  await assert.rejects(s2.act('Q', { op: 'mines', mines: 1 }), /bad-request/);
});

test('«Мины» на сервере: раунд переживает перезапуск, все безопасные клетки открыты — выплата сама, «Выйти» ничего не списывает', async () => {
  const { svc, ledger } = await minesSvc();
  await svc.act('A', { op: 'minesStart', mines: 24 });
  const svc2 = new WalletService({ ledger });
  await svc2.init();
  const again = await svc2.act('A', { op: 'minesState' });
  assert.strictEqual(again.result.mines.mines, 24);
  assert.strictEqual(again.result.mines.layout, null);
  const last = await svc2.act('A', { op: 'minesOpen', index: safeCell(svc2, 'A') });
  assert.strictEqual(last.result.mines.status, 'cleared');
  assert.strictEqual(last.state.balance, 5000 + 4560);
  assert.strictEqual(await ledger.get('rounds', 'A'), null);
  await svc2.act('B', { op: 'minesStart', mines: 5 });
  const ab = await svc2.act('B', { op: 'minesAbandon' });
  assert.strictEqual(ab.state.balance, 5000);
  assert.strictEqual((await svc2.act('B', { op: 'minesState' })).result.mines, null);
});

// ---------- Первый вход: прогресс переносится, дни считаются по часам игрока ----------
test('первый вход: серия, рекорды и дни берутся из кошелька в браузере, а не сбрасываются', async () => {
  const { svc } = await minesSvc({ A: 1234 });
  const seed = { balance: 8000, streak: 5, best: 9, playDay: '2026-03-10', peak: 20000, days: ['2026-03-06', '2026-03-10'], wins: { yahtzee: 3 }, plays: { yahtzee: 4 } };
  const r = await svc.act('A', { op: 'sync', seed, tz: 0 });
  assert.strictEqual(r.state.balance, 8000, 'баланс из браузера, а не из рейтинга (1234)');
  assert.strictEqual(r.state.streak, 5); assert.strictEqual(r.state.best, 9);
  assert.deepStrictEqual(plainJ(r.state.wins), { yahtzee: 3 });
  assert.strictEqual(r.state.days.length, 2);
  const again = await svc.act('A', { op: 'sync', seed: { balance: 1, streak: 0 }, tz: 0 });
  assert.strictEqual(again.state.balance, 8000, 'у существующего кошелька присланный прогресс игнорируется');
  const forged = await minesSvc();
  const f = await forged.svc.act('B', { op: 'sync', seed: { balance: 5e9, streak: 3 }, tz: 0 });
  assert.strictEqual(f.state.balance, 100000, 'подделанный баланс обрезается');
});

test('серия дней идёт по часам игрока, а не по часам сервера', async () => {
  const { svc } = await minesSvc();
  // игрок в поясе UTC+6 (tz = −360): играет в 02:00 по своим часам 10 марта и в 20:00 11 марта: это соседние дни, серия 2
  let t = Date.UTC(2026, 2, 9, 20, 0);          // 10 марта 02:00 у игрока
  svc.now = () => t;
  await svc.act('A', { op: 'markPlayed', tz: -360 });
  await svc.act('A', { op: 'claimDaily', tz: -360 });
  t = Date.UTC(2026, 2, 11, 14, 0);              // 11 марта 20:00 у игрока
  const day2 = await svc.act('A', { op: 'markPlayed', tz: -360 });
  assert.strictEqual(day2.state.streak, 2, 'серия продолжилась');
  // тот же случай по часам сервера (tz 0): 9 марта и 11 марта, между ними день: серия бы порвалась
  const { svc: s2 } = await minesSvc();
  let t2 = Date.UTC(2026, 2, 9, 20, 0); s2.now = () => t2;
  await s2.act('B', { op: 'markPlayed', tz: 0 });
  await s2.act('B', { op: 'claimDaily', tz: 0 });
  t2 = Date.UTC(2026, 2, 11, 14, 0);
  const broke = await s2.act('B', { op: 'markPlayed', tz: 0 });
  assert.strictEqual(broke.state.streak, 1, 'с часами сервера серия рвалась (это и была ошибка)');
});
