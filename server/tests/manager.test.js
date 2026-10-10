const test = require('node:test');
const assert = require('node:assert');
const { loadEngine } = require('../load-engine');
const { RoomManager } = require('../manager');

function conn(uid) { const c = { uid, msgs: [], send(o) { this.msgs.push(o); } }; c.last = () => { const d = c.msgs.filter((m) => m.t === 'doc'); return d.length ? d[d.length - 1].doc : null; }; return c; }
const settle = () => new Promise((r) => setTimeout(r, 30));
function mk() { return new RoomManager({ engine: loadEngine(), config: { engineOptions: { startDelayMs: 0 } } }); }
const owner = (d) => JSON.parse(d.meta).owner;

test('создание стола: создатель — игрок, стол виден в списке', async () => {
  const m = mk(), a = conn('A');
  const code = await m.create(a, 'yahtzee', { size: 2, mode: 'turns', name: 'Аня', avatar: 1 });
  await settle();
  assert.strictEqual(owner(a.last()), 'A');
  assert.strictEqual(m.list('yahtzee').length, 1);
  assert.strictEqual(m.list('blackjack').length, 0);
  assert.ok(code);
});

test('закрытый стол не попадает в список', async () => {
  const m = mk(), a = conn('A');
  await m.create(a, 'yahtzee', { size: 2, mode: 'turns', name: 'Аня', private: true });
  assert.strictEqual(m.list('yahtzee').length, 0);
});

test('вход, старт и передача роли создателя при уходе', async () => {
  const m = mk(), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'yahtzee', { size: 2, mode: 'turns', name: 'Аня' });
  await m.join(b, 'yahtzee', code, { name: 'Боря' });
  await settle();
  assert.strictEqual(JSON.parse(b.last().meta).members.length, 2);
  assert.throws(() => m.act(conn('Z'), code, { type: 'start' }), /not-member/);
  m.act(a, code, { type: 'start' });
  await settle();
  assert.strictEqual(b.last().status, 'playing');
  m.leave(a, code);
  await settle();
  assert.strictEqual(owner(b.last()), 'B');
});

test('блэкджек: вход и начало', async () => {
  const m = mk(), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'blackjack', { size: 2, fillBots: false, name: 'Аня', chips: 1000 });
  await m.join(b, 'blackjack', code, { name: 'Боря', chips: 1000 });
  await settle();
  m.act(a, code, { type: 'start' });
  await settle();
  assert.strictEqual(a.last().status, 'playing');
});

test('пустой стол удаляется, чужие и неизвестные действия отклоняются', async () => {
  const m = mk(), a = conn('A');
  const code = await m.create(a, 'yahtzee', { size: 2, mode: 'sync', name: 'Аня' });
  assert.throws(() => m.act(a, code, { type: 'hack' }), /bad-action/);
  assert.throws(() => m.act(a, 'NOPE1', { type: 'chat' }), /not-found/);
  await assert.rejects(m.join(conn('B'), 'blackjack', code, {}), /wrong-game/);
  m.leave(a, code);
  await settle();
  m.tick();
  assert.strictEqual(m.rooms.size, 0);
});

test('морской бой: корабли и оружие соперника не уходят по сети, своё приходит в mine', async () => {
  const eng = loadEngine(), B = eng.Battleship;
  const m = new RoomManager({ engine: eng, config: { engineOptions: { startDelayMs: 0 } } }), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'battleship', { size: 2, name: 'Аня' });
  await m.join(b, 'battleship', code, { name: 'Боря' });
  await settle();
  m.act(a, code, { type: 'start' });
  await settle();
  assert.strictEqual(a.last().status, 'playing');
  const shipsA = B.randomLayout(), shipsB = B.randomLayout();
  m.act(a, code, { type: 'place', ships: shipsA, arsenal: { radar: 1, sub: 1, bomber: 2 }, hack: 1 });
  m.act(b, code, { type: 'place', ships: shipsB, arsenal: { radar: 0, sub: 2, bomber: 2 } });
  await settle();
  const da = a.last(), db = b.last();
  assert.strictEqual(da.secret, undefined); assert.strictEqual(db.secret, undefined);
  const pubA = JSON.parse(da.state);
  assert.ok(pubA.seats.every((s) => s.ships.length === 0 && s.arsenal === null), 'в общем виде нет ни кораблей, ни оружия');
  assert.strictEqual(pubA.phase, 'playing');
  const mineA = JSON.parse(da.mine), mineB = JSON.parse(db.mine);
  assert.strictEqual(mineA.ships.length, 10); assert.strictEqual(mineA.arsenal.radar, 1);
  assert.strictEqual(mineB.arsenal.sub, 2);
  assert.notDeepStrictEqual(mineA.ships.map((s) => s.cells), mineB.ships.map((s) => s.cells));
  const first = pubA.current, cur = first === 0 ? a : b, other = first === 0 ? b : a;
  assert.throws(() => m.act(conn('Z'), code, { type: 'shoot', x: 0, y: 0 }), /not-member/);
  m.act(other, code, { type: 'shoot', x: 0, y: 0 });                  // не его ход: игнорируется
  m.act(cur, code, { type: 'shoot', x: 0, y: 0 });
  await settle();
  assert.strictEqual(JSON.parse(a.last().state).turns, 1);
  m.leave(b, code);
  await settle();
  const over = JSON.parse(a.last().state);
  assert.strictEqual(over.gameOver, true); assert.strictEqual(over.winner, 0); assert.strictEqual(over.reason, 'left');
  assert.ok(over.seats[1].ships.length === 10, 'после конца корабли открыты');
});
