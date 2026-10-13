// Топы: победы онлайн (их фиксирует сервер) и быстрые победы в «Сапёре» (ledger в памяти)
const test = require('node:test');
const assert = require('node:assert');
const { loadEngine } = require('../load-engine');
const { RoomManager } = require('../manager');
const { MemLedger } = require('../ledger');
const { WalletService } = require('../wallet-service');

async function mk(clock) {
  const ledger = new MemLedger(), svc = new WalletService({ ledger, now: () => clock.t });
  await svc.init();
  return { ledger, svc };
}

test('быстрая победа: время принимается, если не меньше правдоподобного и не меньше реально прошедшего (с запасом)', async () => {
  const clock = { t: 1000000 }, { ledger, svc } = await mk(clock);
  const play = async (level, time, wait) => {
    await svc.act('A', { op: 'countPlay', source: 'minesweeper' });
    clock.t += wait * 1000;
    await svc.act('A', { op: 'earn', source: 'minesweeper', level, time });
    await svc.flushTops();
  };
  await play('novice', 40, 41);
  assert.strictEqual(ledger.fastTop.get('novice|A'), 40, 'нормальная победа записана');
  await play('novice', 55, 56);
  assert.strictEqual(ledger.fastTop.get('novice|A'), 40, 'худшее время рекорд не меняет');
  await play('novice', 1, 60);
  assert.strictEqual(ledger.fastTop.get('novice|A'), 40, 'быстрее правдоподобного предела (3 с) не принимается');
  await play('novice', 30, 2);
  assert.strictEqual(ledger.fastTop.get('novice|A'), 40, 'за 2 секунды 30-секундную партию выиграть нельзя');
  await play('novice', 35, 36);
  assert.strictEqual(ledger.fastTop.get('novice|A'), 35, 'лучшее время заменяет прежнее');
  await svc.act('A', { op: 'earn', source: 'minesweeper', level: 'amateur', time: 20 });      // без начала партии
  await svc.flushTops();
  assert.strictEqual(ledger.fastTop.has('amateur|A'), false, 'без отметки начала партии время не принимается');
  await play('amateur', 'быстро', 30);
  assert.strictEqual(ledger.fastTop.has('amateur|A'), false, 'мусор вместо числа не принимается');
});

test('рекорд времени хранится в хранилище и переживает перезапуск', async () => {
  const clock = { t: 5000000 }, { ledger, svc } = await mk(clock);
  await svc.act('A', { op: 'countPlay', source: 'minesweeper' });
  clock.t += 50000;
  await svc.act('A', { op: 'earn', source: 'minesweeper', level: 'novice', time: 45 });
  const again = new WalletService({ ledger, now: () => clock.t }); await again.init();
  await again.act('A', { op: 'countPlay', source: 'minesweeper' });
  clock.t += 60000;
  await again.act('A', { op: 'earn', source: 'minesweeper', level: 'novice', time: 50 });
  await again.flushTops();
  assert.strictEqual(ledger.fastTop.has('novice|A'), false, 'прежний рекорд 45 с лучше, ничего не отправлено');
});

function roomWith(game, members, state) {
  const wallet = { wins: [], recordWin(uid, g) { this.wins.push(uid + ':' + g); } };
  const m = new RoomManager({ engine: loadEngine(), wallet });
  const room = { game, fields: { meta: JSON.stringify({ members }) } };
  return { m, wallet, room, doc: { state: JSON.stringify(state) } };
}
const duo = [{ uid: 'A', seat: 0 }, { uid: 'B', seat: 1 }];

test('победа онлайн в «Морском бое»: засчитывается один раз за партию, только за флот', () => {
  const t = roomWith('battleship', duo, { gameOver: true, reason: 'fleet', winner: 1 });
  t.m.watchWins(t.room, t.doc); t.m.watchWins(t.room, t.doc);
  assert.deepStrictEqual(t.wallet.wins, ['B:battleship']);
  const c = roomWith('battleship', duo, { gameOver: true, reason: 'concede', winner: 0 });
  c.m.watchWins(c.room, c.doc);
  assert.deepStrictEqual(c.wallet.wins, [], 'сдача не считается победой');
  t.m.watchWins(t.room, { state: JSON.stringify({ gameOver: false }) });
  t.m.watchWins(t.room, t.doc);
  assert.strictEqual(t.wallet.wins.length, 2, 'после реванша новая победа засчитывается');
});

test('победа онлайн в «Ятзи»: за столом не меньше двоих, «один остался» не считается', () => {
  const players = [{ id: 'A', active: true, name: 'A', total: 0 }, { id: 'B', active: true, name: 'B', total: 0 }];
  const t = roomWith('yahtzee', duo, { gameOver: true, reason: 'alone', players });
  t.m.watchWins(t.room, t.doc);
  assert.deepStrictEqual(t.wallet.wins, []);
  const one = roomWith('yahtzee', [duo[0]], { gameOver: true, reason: 'finished', players });
  one.m.watchWins(one.room, one.doc);
  assert.deepStrictEqual(one.wallet.wins, [], 'в одиночку победа не считается');
});

test('победа онлайн в блэкджеке: выигрыш раздачи у дилера, боты без аккаунта пропускаются', () => {
  const seats = [{ hands: [{ outcome: 'win' }] }, { hands: [{ outcome: 'lose' }] }, { hands: [{ outcome: 'blackjack' }] }];
  const t = roomWith('blackjack', duo, { phase: 'settled', round: 3, seats });
  t.m.watchWins(t.room, t.doc); t.m.watchWins(t.room, t.doc);
  assert.deepStrictEqual(t.wallet.wins, ['A:blackjack'], 'выиграл только A; третье место — бот, у него нет аккаунта');
});

test('победа онлайн в покере: банк выигран на вскрытии при двух игроках; отменённая раздача не считается', async () => {
  const wins = []; const wallet = { recordWin: (u, g) => wins.push(u + ':' + g), holds: new Map() };
  const m = new RoomManager({ engine: loadEngine(), wallet });
  const room = { game: 'poker-simple', fields: { meta: JSON.stringify({ members: duo }) }, holds: new Map() };
  m.rooms.set('ABCDE', room);
  m.pokerSettle('ABCDE', [{ uid: 'A', chips: 5100, net: 100, showdown: true }, { uid: 'B', chips: 4900, net: -100, showdown: true }], false);
  m.pokerSettle('ABCDE', [{ uid: 'A', chips: 5100, net: 100, showdown: false }], false);
  m.pokerSettle('ABCDE', [{ uid: 'A', chips: 5100, net: 100, showdown: true }], true);
  assert.deepStrictEqual(wins, ['A:poker-simple'], 'только вскрытие и не отменённая раздача');
});

test('топы: накопленные победы уходят в хранилище пачкой, при сбое повторяются', async () => {
  const clock = { t: 1 }, { ledger, svc } = await mk(clock);
  svc.recordWin('A', 'yahtzee'); svc.recordWin('A', 'yahtzee'); svc.recordWin('B', 'battleship'); svc.recordWin('B', 'nope');
  let fail = 1; const add = ledger.addWins.bind(ledger);
  ledger.addWins = async (g, u, n) => { if (fail-- > 0) throw new Error('down'); return add(g, u, n); };
  await svc.flushTops();
  await svc.flushTops();
  assert.strictEqual(ledger.winsTop.get('yahtzee|A') + (ledger.winsTop.get('battleship|B') || 0), 3);
  assert.strictEqual(ledger.winsTop.has('nope|B'), false);
});
