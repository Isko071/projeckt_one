// Онлайн-покер на серверном балансе: стек берётся залогом перед раздачей и возвращается с итогом (ledger в памяти)
const test = require('node:test');
const assert = require('node:assert');
const { loadEngine } = require('../load-engine');
const { RoomManager } = require('../manager');
const { MemLedger } = require('../ledger');
const { WalletService } = require('../wallet-service');

const engine = loadEngine();
function conn(uid) { const c = { uid, msgs: [], send(o) { this.msgs.push(o); } }; c.last = () => { const d = c.msgs.filter((m) => m.t === 'doc'); return d.length ? d[d.length - 1].doc : null; }; return c; }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (c) => JSON.parse(c.last().state);
async function mk(seeds) {
  const ledger = new MemLedger({ seeds: seeds || {} }), wallet = new WalletService({ ledger });
  await wallet.init();
  const m = new RoomManager({ engine, wallet, config: { tickMs: 30, strayMs: 50, engineOptions: { startDelayMs: 0, dealDelayMs: 0 } } }).start();
  return { m, wallet, ledger };
}
const bal = async (wallet, uid) => (await wallet.act(uid, { op: 'sync' })).state.balance;
const turnConn = (conns) => conns.find((c) => { const st = state(c); return st.current >= 0 && st.seats[st.current].id === c.uid; });
async function playOut(m, code, conns) {
  let guard = 0;
  while (state(conns[0]).phase !== 'settled' && guard++ < 60) {
    const c = turnConn(conns);
    if (c) { const st = state(c), s = st.seats[st.current]; m.act(c, code, st.currentBet > s.bet ? { type: 'call' } : (st.mandatory.includes(st.phase) ? { type: 'raise', amount: 100 } : { type: 'check' })); }
    await wait(50);
  }
}

test('онлайн-покер: стек — серверный баланс, залог на раздачу, итог возвращается на баланс', async () => {
  const { m, wallet } = await mk(), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'poker-simple', { size: 2, name: 'Аня', chips: 999999, ante: 50, minBet: 100 });      // присланные браузером фишки не принимаются
  await m.join(b, 'poker-simple', code, { name: 'Боря', chips: 1 });
  await wait(60);
  m.act(a, code, { type: 'start' });
  await wait(150);
  let st = state(a);
  assert.strictEqual(st.phase, 'preflop');
  assert.strictEqual(st.seats[0].chips + st.seats[0].total, 5000, 'стек = баланс, а не присланное');
  assert.strictEqual(st.seats[1].chips + st.seats[1].total, 5000);
  assert.strictEqual(await bal(wallet, 'A'), 0, 'стек лежит залогом на время раздачи');
  await playOut(m, code, [a, b]);
  await wait(150);
  st = state(a);
  assert.strictEqual(st.phase, 'settled');
  const total = (await bal(wallet, 'A')) + (await bal(wallet, 'B'));
  assert.strictEqual(total, 10000, 'аконы не появились и не пропали');
  assert.strictEqual(await bal(wallet, 'A'), st.seats[0].chips, 'баланс = фишки после раздачи');
  assert.strictEqual(await bal(wallet, 'B'), st.seats[1].chips);
  m.stop();
});

test('онлайн-покер: не хватает на начальную ставку — за стол не сесть, баланс цел', async () => {
  const { m, wallet } = await mk({ P: 10 }), p = conn('P');
  await assert.rejects(m.create(p, 'poker-simple', { size: 2, name: 'Бедный', ante: 50 }), /no-funds/);
  assert.strictEqual(await bal(wallet, 'P'), 10);
  m.stop();
});

test('онлайн-покер: следующая раздача снова берёт залог, закрыть идущую раздачу нельзя, а пустой стол возвращает стеки', async () => {
  const { m, wallet } = await mk(), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'poker-simple', { size: 2, name: 'Аня', ante: 50, minBet: 100 });
  await m.join(b, 'poker-simple', code, { name: 'Боря' });
  await wait(60);
  m.act(a, code, { type: 'start' });
  await wait(150);
  await playOut(m, code, [a, b]);
  await wait(120);
  m.act(a, code, { type: 'ready' }); m.act(b, code, { type: 'ready' });
  await wait(250);
  assert.strictEqual(state(a).phase, 'preflop', 'новая раздача');
  assert.strictEqual(state(a).round, 2);
  m.act(a, code, { type: 'close' });                                  // идущую раздачу закрыть нельзя
  await wait(300);
  assert.strictEqual(m.rooms.size, 1, 'стол остался');
  m.leave(a, code); m.leave(b, code);                                 // все ушли: раздача отменена, стеки возвращены
  await wait(500);
  try { assert.strictEqual((await bal(wallet, 'A')) + (await bal(wallet, 'B')), 10000, 'залоги вернулись'); } finally { m.stop(); }
});

test('онлайн-покер: стек урезается до баланса, если в другой игре потрачено', async () => {
  const { m, wallet } = await mk(), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'poker-simple', { size: 2, name: 'Аня', ante: 50, minBet: 100 });
  await m.join(b, 'poker-simple', code, { name: 'Боря' });
  await wait(60);
  await wallet.act('A', { op: 'minesStart', mines: 3 });
  await wallet.act('A', { op: 'minesOpen', index: 0 }).catch(() => {});
  const left = await bal(wallet, 'A');
  m.act(a, code, { type: 'start' });
  await wait(150);
  const st = state(a);
  assert.ok(st.seats[0].chips + st.seats[0].total <= Math.max(left, 0) + 0, 'стек не больше баланса на момент раздачи: ' + (st.seats[0].chips + st.seats[0].total) + ' ≤ ' + left);
  m.stop();
});
