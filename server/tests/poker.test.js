const test = require('node:test');
const assert = require('node:assert');
const { loadEngine } = require('../load-engine');
const { RoomManager } = require('../manager');

function conn(uid) { const c = { uid, msgs: [], send(o) { this.msgs.push(o); } }; c.last = () => { const d = c.msgs.filter((m) => m.t === 'doc'); return d.length ? d[d.length - 1].doc : null; }; return c; }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (c) => JSON.parse(c.last().state);
const meta = (c) => JSON.parse(c.last().meta);
function mk(opts) { return new RoomManager({ engine: loadEngine(), config: { tickMs: 40, engineOptions: Object.assign({ startDelayMs: 0, dealDelayMs: 0 }, opts || {}) } }).start(); }

async function table(game, opts, n) {
  const m = mk(opts), conns = [];
  for (let i = 0; i < (n || 2); i++) conns.push(conn('U' + i));
  const code = await m.create(conns[0], game, { size: 4, name: 'Аня', chips: 5000, ante: 50, minBet: 100, bigBlind: 100 });
  for (let i = 1; i < conns.length; i++) await m.join(conns[i], game, code, { name: 'Игрок' + i, chips: 5000 });
  await wait(60);
  m.act(conns[0], code, { type: 'start' });
  await wait(80);
  return { m, code, conns };
}
const turnConn = (t) => t.conns.find((c) => state(c).seats[state(c).current].id === c.uid);

test('покер-стол: чужие карты не уходят на клиент, свои приходят отдельно', async () => {
  const t = await table('poker-simple', {}, 3);
  t.conns.forEach((c) => {
    const d = c.last();
    assert.strictEqual(d.hole, undefined, 'карты всех игроков не отправляются');
    const st = state(c), mine = JSON.parse(d.mine);
    assert.strictEqual(mine.length, 2);
    st.seats.forEach((s) => { if (s.id !== c.uid && s.inHand) assert.deepStrictEqual(s.cards, [null, null], 'чужие скрыты'); });
    assert.ok(!('deck' in st));
  });
  assert.strictEqual(meta(t.conns[0]).variant, 'simple');
  assert.strictEqual(state(t.conns[0]).phase, 'preflop');
  t.m.stop();
});

test('покер: ход по очереди, чужие и неизвестные действия отклоняются, раздача доходит до итога', async () => {
  const t = await table('poker', {}, 2);
  let guard = 0;
  while (state(t.conns[0]).phase !== 'settled' && guard++ < 40) {
    const c = turnConn(t), st = state(c);
    const other = t.conns.find((x) => x !== c);
    t.m.act(other, t.code, { type: 'check' });                 // не его ход: действие молча игнорируется
    const s = st.seats[st.current];
    t.m.act(c, t.code, st.currentBet > s.bet ? { type: 'call' } : { type: 'check' });
    await wait(40);
  }
  assert.strictEqual(state(t.conns[0]).phase, 'settled');
  assert.ok(state(t.conns[0]).seats.every((s) => !s.inHand || s.shown || s.folded), 'на вскрытии карты открыты');
  assert.throws(() => t.m.act(t.conns[0], t.code, { type: 'steal' }), /bad-action/);
  t.m.stop();
});

test('покер: после итога раздача начинается, когда все нажали «Вернуться к столу»', async () => {
  const t = await table('poker-simple', {}, 2);
  while (state(t.conns[0]).phase !== 'settled') {
    const c = turnConn(t), st = state(c), s = st.seats[st.current];
    t.m.act(c, t.code, st.currentBet > s.bet ? { type: 'call' } : (st.mandatory.includes(st.phase) ? { type: 'raise', amount: 100 } : { type: 'check' }));
    await wait(40);
  }
  const round = state(t.conns[0]).round;
  t.m.act(t.conns[0], t.code, { type: 'ready' }); await wait(60);
  assert.strictEqual(state(t.conns[0]).phase, 'settled', 'один готов: ждём второго');
  assert.deepStrictEqual(meta(t.conns[0]).ready, ['U0']);
  t.m.act(t.conns[1], t.code, { type: 'ready' }); await wait(80);
  assert.strictEqual(state(t.conns[0]).round, round + 1);
  assert.notStrictEqual(state(t.conns[0]).phase, 'settled');
  t.m.stop();
});

test('покер: не нажавший «Вернуться к столу» за время ожидания пропускает раздачу, остальные играют', async () => {
  const t = await table('poker-simple', { readyWaitMs: 150 }, 3);
  while (state(t.conns[0]).phase !== 'settled') {
    const c = turnConn(t), st = state(c), s = st.seats[st.current];
    t.m.act(c, t.code, st.currentBet > s.bet ? { type: 'call' } : (st.mandatory.includes(st.phase) ? { type: 'raise', amount: 100 } : { type: 'check' }));
    await wait(30);
  }
  const round = state(t.conns[0]).round;
  t.m.act(t.conns[0], t.code, { type: 'ready' }); t.m.act(t.conns[1], t.code, { type: 'ready' });
  await wait(450);
  const st = state(t.conns[0]);
  assert.strictEqual(st.round, round + 1);
  assert.strictEqual(st.seats[2].sitOut, true, 'не нажавший пропускает');
  assert.strictEqual(st.seats[2].inHand, false);
  t.m.act(t.conns[2], t.code, { type: 'ready' }); await wait(60);
  assert.strictEqual(state(t.conns[0]).seats[2].sitOut, false, 'нажал позже: вернулся к игре');
  t.m.stop();
});

test('покер: тайм-аут хода — автоход, три подряд — выбывание; создатель уходит — роль переходит', async () => {
  const t = await table('poker', { idleMs: 60, askMs: 40, maxStrikes: 1 }, 3);
  const first = state(t.conns[0]).seats[state(t.conns[0]).current].id;
  await wait(400);
  const mt = meta(t.conns[1] === undefined ? t.conns[0] : t.conns.find((c) => c.uid !== first));
  assert.ok(!mt.members.some((m) => m.uid === first), 'молчащий игрок выбыл');
  t.m.stop();
  const t2 = await table('poker', {}, 3);
  t2.m.leave(t2.conns[0], t2.code);
  await wait(100);
  assert.strictEqual(meta(t2.conns[1]).owner, 'U1');
  t2.m.stop();
});

test('покер: войти можно только в комнате ожидания или между раздачами', async () => {
  const t = await table('poker-simple', {}, 2);
  await assert.rejects(t.m.join(conn('X'), 'poker-simple', t.code, { name: 'Поздний', chips: 1000 }), /started/);
  while (state(t.conns[0]).phase !== 'settled') {
    const c = turnConn(t), st = state(c), s = st.seats[st.current];
    t.m.act(c, t.code, st.currentBet > s.bet ? { type: 'call' } : (st.mandatory.includes(st.phase) ? { type: 'raise', amount: 100 } : { type: 'check' }));
    await wait(40);
  }
  const x = conn('X');
  await t.m.join(x, 'poker-simple', t.code, { name: 'Поздний', chips: 1000 });
  await wait(100);
  assert.ok(meta(t.conns[0]).members.some((m) => m.uid === 'X'));
  assert.strictEqual(state(x).seats.filter((s) => s.active).length, 3, 'новый игрок видит стол и сидит за ним');
  t.m.stop();
});
