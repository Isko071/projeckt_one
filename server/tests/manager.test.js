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
