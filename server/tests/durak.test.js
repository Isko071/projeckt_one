// «Дурак» на сервере столов: карты скрыты (каждый видит только свои), боты на пустых местах — только по выбору создателя, ставки
const test = require('node:test');
const assert = require('node:assert');
const { loadEngine } = require('../load-engine');
const { RoomManager } = require('../manager');
const { MemLedger } = require('../ledger');
const { WalletService } = require('../wallet-service');

const engine = loadEngine(), D = engine.Durak, B = engine.DurakBot;
function conn(uid) { const c = { uid, msgs: [], send(o) { this.msgs.push(o); } }; c.last = () => { const d = c.msgs.filter((m) => m.t === 'doc'); return d.length ? d[d.length - 1].doc : null; }; return c; }
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 40));
const bal = async (wallet, uid) => (await wallet.act(uid, { op: 'sync' })).state.balance;
const stateOf = (c) => JSON.parse(c.last().state);
const mineOf = (c) => JSON.parse(c.last().mine || '[]');
const seatOf = (c) => JSON.parse(c.last().meta).members.filter((x) => x.uid === c.uid)[0].seat;
const made = [];
test.afterEach(() => { made.splice(0).forEach((m) => m.stop()); });
async function mk(cfg) {
  const ledger = new MemLedger(), wallet = new WalletService({ ledger });
  await wallet.init();
  const m = new RoomManager({ engine, wallet, config: Object.assign({ tickMs: 20, engineOptions: { startDelayMs: 0, botMs: 10 }, strayMs: 50, stakeMinMs: {} }, cfg || {}) }).start();
  made.push(m);
  return { m, wallet };
}
// Играем за людей ботом сервера, пока партия не кончится
async function playOut(m, code, people) {
  for (let k = 0; k < 3000; k++) {
    const st = stateOf(people[0]);
    if (st.gameOver) return st;
    const who = people.find((c) => seatOf(c) === st.actor);
    if (who) {
      const full = Object.assign({}, st, { deck: new Array(st.deckCount).fill('6S') });
      full.seats = st.seats.map((s, i) => Object.assign({}, s, { hand: i === st.actor ? mineOf(who) : new Array(s.count).fill('6S') }));
      const a = B.choose(full, st.actor, 'medium');
      m.act(who, code, a);
    }
    await settle(15);
  }
  throw new Error('партия не закончилась');
}

test('дурак онлайн: каждый видит только свои карты, колода скрыта', async () => {
  const { m } = await mk(), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'durak', { size: 2, mode: 'perevodnoy', name: 'Аня' });
  await m.join(b, 'durak', code, { name: 'Боря' });
  await settle(); m.act(a, code, { type: 'start' }); await settle(80);
  const st = stateOf(a);
  assert.strictEqual(st.mode, 'perevodnoy');
  assert.strictEqual(st.deck, undefined); assert.strictEqual(st.deckCount, 24);
  st.seats.forEach((s) => { assert.strictEqual(s.hand, undefined); assert.strictEqual(s.count, 6); });
  const ma = mineOf(a), mb = mineOf(b);
  assert.strictEqual(ma.length, 6); assert.strictEqual(mb.length, 6);
  assert.ok(ma.every((c) => mb.indexOf(c) < 0), 'у каждого свои карты');
  assert.ok(!JSON.stringify(a.last()).includes('"' + mb[0] + '"') || mb[0] === st.trumpCard, 'чужих карт в документе нет');
  m.stop();
});

test('дурак онлайн: без галочки ботов вдвоём не начать одному; с галочкой — пустые места занимают боты и ходят сами', async () => {
  const { m } = await mk(), a = conn('A');
  const lonely = await m.create(a, 'durak', { size: 3, name: 'Аня' });
  await settle(); m.act(a, lonely, { type: 'start' }); await settle(60);
  assert.strictEqual(a.last().status, 'lobby', 'один человек без ботов начать не может');
  const a2 = conn('A2');
  const code = await m.create(a2, 'durak', { size: 3, name: 'Аня', fillBots: true, botLevel: 'easy' });
  await settle(); m.act(a2, code, { type: 'start' }); await settle(80);
  const st = stateOf(a2);
  assert.strictEqual(a2.last().status, 'playing');
  assert.strictEqual(st.seats.length, 3);
  assert.deepStrictEqual(st.seats.map((s) => !!s.bot), [false, true, true]);
  const end = await playOut(m, code, [a2]);
  assert.ok(end.gameOver, 'партия с ботами доиграна до конца');
  m.stop();
});

test('дурак онлайн на ставку: дурак отдаёт ставку, остальные люди делят', async () => {
  const { m, wallet } = await mk(), a = conn('A'), b = conn('B'), c = conn('C');
  const code = await m.create(a, 'durak', { size: 3, name: 'Аня', stake: 300 });
  await m.join(b, 'durak', code, { name: 'Боря' }); await m.join(c, 'durak', code, { name: 'Вика' });
  await settle(); m.act(a, code, { type: 'start' }); await settle(80);
  for (const u of ['A', 'B', 'C']) assert.strictEqual(await bal(wallet, u), 4700);
  const end = await playOut(m, code, [a, b, c]);
  await settle(200);
  const people = [a, b, c], bals = {};
  for (const u of ['A', 'B', 'C']) bals[u] = await bal(wallet, u);
  if (end.loser < 0) { assert.deepStrictEqual(bals, { A: 5000, B: 5000, C: 5000 }); return m.stop(); }
  const fool = people.find((p) => seatOf(p) === end.loser).uid;
  assert.strictEqual(bals[fool], 4700, 'дурак потерял ставку');
  Object.keys(bals).filter((u) => u !== fool).forEach((u) => assert.strictEqual(bals[u], 5150, u + ' получил половину ставки дурака'));
  m.stop();
});

test('дурак онлайн: сдача или выход посреди партии — дурак тот, кто ушёл', async () => {
  const { m, wallet } = await mk({ stakeMinMs: undefined }), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'durak', { size: 2, name: 'Аня', stake: 100 });
  await m.join(b, 'durak', code, { name: 'Боря' });
  await settle(); m.act(a, code, { type: 'start' }); await settle(80);
  m.act(b, code, { type: 'concede' }); await settle(150);
  const st = stateOf(a);
  assert.ok(st.gameOver); assert.strictEqual(st.reason, 'concede'); assert.strictEqual(st.loser, seatOf(b));
  assert.strictEqual(await bal(wallet, 'A'), 5000, 'сдался в первые секунды — ставки вернулись');
  assert.strictEqual(await bal(wallet, 'B'), 5000);
  m.stop();
});
