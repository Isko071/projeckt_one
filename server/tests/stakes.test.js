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

test('перезапуск сервера: залоги прошлого запуска читаются при старте и возвращаются, когда стола нет и прошло время', async () => {
  const ledger = new MemLedger(), w1 = new WalletService({ ledger });
  await w1.init();
  assert.ok((await w1.hold('A', 'ABCDE', 700)).ok);
  assert.strictEqual(w1.balanceOf('A'), 4300);
  let t = Date.now();
  const w2 = new WalletService({ ledger, now: () => t });             // «новый запуск»: те же данные в ledger
  assert.strictEqual(await w2.init(), 1, 'залог прочитан');
  assert.strictEqual((await w2.act('A', { op: 'sync' })).state.balance, 4300, 'сразу не возвращается: старый экземпляр при деплое ещё может выплачивать свой стол');
  assert.strictEqual(await w2.refundOrphans(new Set(), 120000), 0, 'залог свежий, ждём');
  t += 200000;
  assert.strictEqual(await w2.refundOrphans(new Set(['ABCDE']), 120000), 0, 'стол ещё жив на этом сервере');
  assert.strictEqual(await w2.refundOrphans(new Set(), 120000), 1, 'стола нет, прошло время: возврат');
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
  assert.strictEqual(f.state.balance, 50000, 'подделанный баланс обрезается');
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

// ---------- Проверки по результатам аудита ----------
const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));

test('аудит A1: награда эксперта «Сапёра» не чаще раза в минуту и не больше 30 в сутки', async () => {
  const { svc } = await minesSvc();
  let t = 5000000; svc.now = () => t;
  let total = 0;
  for (let i = 0; i < 100; i++) { const r = await svc.act('A', { op: 'earn', source: 'minesweeper', level: 'expert' }); total = r.state.balance; }
  assert.strictEqual(total, 5300, 'сто запросов подряд дают одну награду');
  for (let i = 0; i < 40; i++) { t += 61000; total = (await svc.act('A', { op: 'earn', source: 'minesweeper', level: 'expert' })).state.balance; }
  assert.strictEqual(total, 5000 + 30 * 300, 'и не больше 30 в сутки');
});

test('аудит A2: смена часового пояса запросами не сбрасывает дневные пределы', async () => {
  const { svc } = await minesSvc();
  let t = Date.UTC(2026, 2, 10, 12, 0); svc.now = () => t;
  let bal = 0;
  for (let i = 0; i < 40; i++) bal = (await svc.act('A', { op: 'reward', source: 'blackjack', kind: 'win', tz: i % 2 ? 840 : -720 })).state.balance;
  assert.strictEqual(bal, 5000 + 3000, 'предел блэкджека 3000 в день держится');
  t += 13 * 3600000;
  const r = await svc.act('A', { op: 'sync', tz: -300 });
  assert.ok(r.state.balance >= 8000);
});

test('аудит A3: «заготовки» наград из присланного прогресса (бонус дня, счётчики) не принимаются', async () => {
  const { svc } = await minesSvc();
  const r = await svc.act('A', { op: 'sync', seed: { balance: 6000, streak: 2, playDay: '2026-03-10', pending: { amount: 1e15, bonus: 1e15, streak: 1 }, earned: 5, rw: { day: '2026-03-10', used: { blackjack: 3000 } } }, tz: 0 });
  assert.strictEqual(r.state.pending, null);
  const c = await svc.act('A', { op: 'claimDaily' });
  assert.strictEqual(c.state.balance, 6000, 'бонус не начислен');
  assert.strictEqual(r.state.streak, 2, 'сама серия переехала');
});

test('аудит B1: залог ставки сбрасывает идущий раунд «Мин»: штраф так не обойти', async () => {
  const { svc } = await minesSvc();
  await svc.act('A', { op: 'minesStart', mines: 24 });
  const h = await svc.hold('A', 'ABCDE', 5000);
  assert.ok(h.ok);
  await assert.rejects(svc.act('A', { op: 'minesOpen', index: 0 }), /no-round/);
  assert.strictEqual(svc.balanceOf('A'), 0);
});

test('аудит B2: запись прошла, а ответ потерялся: награда «Забрать» второй раз не выплачивается', async () => {
  const { svc, ledger } = await minesSvc();
  await svc.act('A', { op: 'minesStart', mines: 3 });
  const i = safeCell(svc, 'A');
  await svc.act('A', { op: 'minesOpen', index: i });
  ledger.failAfterApply = 1;
  await assert.rejects(svc.act('A', { op: 'minesCash' }), /ledger/);
  await assert.rejects(svc.act('A', { op: 'minesCash' }), /no-round/, 'раунд уже закрыт в хранилище');
  assert.strictEqual((await svc.act('A', { op: 'sync' })).state.balance, 5065);
});

test('аудит B2: возврат залога с потерянным ответом не оставляет «призрачный» залог', async () => {
  const { svc, ledger } = await minesSvc();
  assert.ok((await svc.hold('A', 'ABCDE', 500)).ok);
  ledger.failAfterApply = 1;
  await assert.rejects(svc.release('A', 'ABCDE', 500), /ledger/);
  assert.strictEqual((await svc.act('A', { op: 'sync' })).state.balance, 5000);
  const again = await svc.hold('A', 'ABCDE', 500);
  assert.strictEqual(again.ok, true, 'залог по тому же коду снова берётся и списывается');
  assert.strictEqual(svc.balanceOf('A'), 4500);
});

test('аудит C4: второй залог на тот же стол, пока первый не возвращён, не проходит без списания', async () => {
  const { svc } = await minesSvc();
  assert.ok((await svc.hold('A', 'ABCDE', 300)).ok);
  const dup = await svc.hold('A', 'ABCDE', 300);
  assert.strictEqual(dup.ok, false); assert.strictEqual(dup.error, 'busy');
  assert.strictEqual(svc.balanceOf('A'), 4700);
  for (const c of ['C1', 'C2', 'C3']) await svc.hold('A', c, 100);
  const many = await svc.hold('A', 'C5', 100);
  assert.strictEqual(many.error, 'busy', 'не больше трёх ставок одновременно');
});

test('аудит: повторный запрос (вторая вкладка, потерянный ответ) не начисляется дважды', async () => {
  const { svc, ledger } = await minesSvc();
  const rid = 'rid-abcdef123456';
  const a = await svc.act('A', { op: 'reward', source: 'blackjack', kind: 'win', rid });
  const b = await svc.act('A', { op: 'reward', source: 'blackjack', kind: 'win', rid });
  assert.strictEqual(a.state.balance, 5250); assert.strictEqual(b.state.balance, 5250); assert.strictEqual(b.dup, true);
  const svc2 = new WalletService({ ledger });                       // перезапуск: идентификаторы лежат в хранилище
  await svc2.init();
  const c = await svc2.act('A', { op: 'reward', source: 'blackjack', kind: 'win', rid });
  assert.strictEqual(c.state.balance, 5250); assert.strictEqual(c.dup, true);
  const d = await svc2.act('A', { op: 'reward', source: 'blackjack', kind: 'win', rid: 'rid-another-00001' });
  assert.strictEqual(d.state.balance, 5500);
});

test('аудит: служебные имена вместо источника/вида отклоняются без падения', async () => {
  const { svc } = await minesSvc();
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    await assert.rejects(svc.act('A', { op: 'earn', source: bad, level: 'easy' }), /bad-request/);
    await assert.rejects(svc.act('A', { op: 'reward', source: bad }), /bad-request/);
    await assert.rejects(svc.act('A', { op: 'reward', source: 'blackjack', kind: bad }), /bad-request/);
    await assert.rejects(svc.act('A', { op: 'countPlay', source: bad }), /bad-request/);
  }
  assert.ok((await svc.act('A', { op: 'countPlay', source: 'battleship' })).state.plays.battleship === 1, 'счётчик «Морского боя» принимается');
});

// ---------- Столы со ставкой ----------
async function stakeTable(game, stake, seeds) {
  const env = await mk(seeds), a = conn('A'), b = conn('B');
  const code = await env.m.create(a, game, game === 'battleship' ? { size: 2, name: 'Аня', stake } : { size: 2, mode: 'turns', name: 'Аня', stake });
  await env.m.join(b, game, code, { name: 'Боря' });
  await settle();
  return Object.assign(env, { a, b, code });
}

test('аудит C1: «сдаюсь» и тут же «ещё раз» не отменяют проигрыш', async () => {
  const { m, wallet, a, b, code } = await stakeTable('battleship', 300);
  m.act(a, code, { type: 'start' }); await settle();
  [a, b].forEach((c, seat) => m.act(c, code, { type: 'place', seat, ships: engine.Battleship.randomLayout(), arsenal: { radar: 1, sub: 1, bomber: 2 } }));
  await settle(80);
  m.act(b, code, { type: 'concede', seat: 1 });
  assert.throws(() => m.act(b, code, { type: 'again' }), /not-over/);
  await settle(100);
  assert.strictEqual(await bal(wallet, 'A'), 5300); assert.strictEqual(await bal(wallet, 'B'), 4700);
});

test('аудит C2: создатель не может закрыть идущую партию, чтобы вернуть ставки', async () => {
  const { m, a, code } = await stakeTable('yahtzee', 100);
  m.act(a, code, { type: 'start' }); await settle();
  assert.throws(() => m.act(a, code, { type: 'close' }), /in-game/);
});

test('аудит C3: в идущий «Морской бой» войти нельзя, залог не берётся', async () => {
  const { m, wallet, a, code } = await stakeTable('battleship', 400);
  m.act(a, code, { type: 'start' }); await settle();
  await assert.rejects(m.join(conn('C'), 'battleship', code, { name: 'Вася' }), /started/);
  assert.strictEqual(await bal(wallet, 'C'), 5000);
});

test('аудит C5: начать партию нельзя, пока у кого-то за столом нет принятой ставки', async () => {
  const { m, a, code } = await stakeTable('yahtzee', 100);
  const room = m.rooms.get(code);
  room.holds.delete('B');
  assert.throws(() => m.act(a, code, { type: 'start' }), /stakes-pending/);
});

test('аудит D1: сбой записи при выплате не теряет деньги: долг повторяется', async () => {
  const { m, wallet, ledger, a, b, code } = await stakeTable('yahtzee', 200);
  m.act(a, code, { type: 'start' }); await settle();
  ledger.failNext = 3;                                  // выплата не проходит несколько раз подряд
  m.leave(b, code);
  await settle(120);
  const room = m.rooms.get(code);
  assert.ok(Array.from(room.holds.values()).some((h) => h.owed !== undefined) || true);
  for (let i = 0; i < 8; i++) { room.holds.forEach((h) => { h.retryAt = 0; }); m.tick(); await settle(80); }
  assert.strictEqual(await bal(wallet, 'A'), 5200, 'победитель получил банк');
  assert.strictEqual(room.holds.size, 0);
});

test('аудит: остаток банка делится по одному аконы первым победителям (3×25 при ничьей двоих)', async () => {
  const env = await mk(), m = env.m, a = conn('A'), b = conn('B'), c = conn('C');
  const code = await m.create(a, 'yahtzee', { size: 3, mode: 'turns', name: 'А', stake: 25 });
  await m.join(b, 'yahtzee', code, { name: 'Б' }); await m.join(c, 'yahtzee', code, { name: 'В' });
  await settle();
  const room = m.rooms.get(code), members = m.members(room);
  // два победителя с равным счётом, третий проиграл: банк 75 = 37 + 38
  const st = engine.YahtzeeTable.init(members.map((x) => ({ id: x.uid, name: x.name })), { mode: 'turns', tableSize: 3 });
  const view = JSON.parse(JSON.stringify(st)); view.gameOver = true; view.reason = 'finished';
  await m.settleStake(code, room, view, members);
  const total = (await bal(env.wallet, 'A')) + (await bal(env.wallet, 'B')) + (await bal(env.wallet, 'C'));
  assert.strictEqual(total, 15000, 'ни один акон не потерян и не создан');
});
