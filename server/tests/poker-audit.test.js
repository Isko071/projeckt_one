// Исправления по аудиту онлайн-покера на серверном балансе (ledger в памяти)
const test = require('node:test');
const assert = require('node:assert');
const { loadEngine } = require('../load-engine');
const { RoomManager } = require('../manager');
const { MemLedger } = require('../ledger');
const { WalletService } = require('../wallet-service');

const engine = loadEngine();
function conn(uid) { const c = { uid, msgs: [], send(o) { this.msgs.push(o); } }; c.last = () => { const d = c.msgs.filter((m) => m.t === 'doc'); return d.length ? d[d.length - 1].doc : null; }; return c; }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function mk(seeds) {
  const ledger = new MemLedger({ seeds }), wallet = new WalletService({ ledger });
  await wallet.init();
  const m = new RoomManager({ engine, wallet, config: { tickMs: 20, strayMs: 50, engineOptions: { startDelayMs: 0, dealDelayMs: 0, readyWaitMs: 200, idleMs: 60000 } } }).start();
  return { m, wallet, ledger };
}
const bal = async (w, u) => (await w.act(u, { op: 'sync' })).state.balance;
const st = (c) => JSON.parse(c.last().state);
const holdsSum = async (l) => (await l.list('holds')).reduce((a, x) => a + x.data.amount, 0);

test('короткий стек: раздача закончилась внутри deal, но итог подведён, залоги не зависли', async () => {
  const { m, wallet, ledger } = await mk({ A: 5000, B: 60 }), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'poker-simple', { size: 2, ante: 50, name: 'A' });
  await m.join(b, 'poker-simple', code, { name: 'B' });
  await wait(60); m.act(a, code, { type: 'start' }); await wait(200);
  for (let i = 0; i < 20; i++) {                         // A повышает, B сбрасывает
    const s = st(a); if (s.phase === 'settled') break;
    const cur = s.current >= 0 ? s.seats[s.current].id : null;
    if (cur === 'A') m.act(a, code, s.currentBet > s.seats[s.current].bet ? { type: 'call' } : { type: 'raise', amount: s.minBet }); else if (cur === 'B') m.act(b, code, { type: 'fold' });
    await wait(60);
  }
  m.act(a, code, { type: 'ready' }); m.act(b, code, { type: 'ready' }); await wait(500);
  assert.strictEqual(await holdsSum(ledger), 0, 'залогов не осталось');
  assert.strictEqual((await bal(wallet, 'A')) + (await bal(wallet, 'B')), 5060, 'аконы сохранились');
  assert.strictEqual(await bal(wallet, 'A'), st(a).seats[0].chips);
  m.stop();
});

test('закрыть идущую раздачу нельзя: проигрыш не отменить', async () => {
  const { m, wallet, ledger } = await mk({ A: 5000, B: 5000 }), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'poker-simple', { size: 2, ante: 50, name: 'A' });
  await m.join(b, 'poker-simple', code, { name: 'B' });
  await wait(60); m.act(a, code, { type: 'start' }); await wait(200);
  for (let i = 0; i < 6; i++) { const s = st(a), cur = s.current >= 0 ? s.seats[s.current].id : null; if (cur === 'B') { m.act(b, code, { type: 'allin' }); break; } if (cur === 'A') m.act(a, code, { type: 'raise', amount: s.minBet }); await wait(60); }
  await wait(100);
  m.act(a, code, { type: 'close' }); await wait(5800);
  assert.strictEqual(m.rooms.size, 1, 'стол остался');
  assert.strictEqual(await holdsSum(ledger), 10000, 'стеки по-прежнему под залогом, раздача идёт');
  assert.strictEqual((await bal(wallet, 'A')) + (await bal(wallet, 'B')), 0);
  m.stop();
});

test('потеря ответа записи при залоге: залог принимается, игрока не выкидывает', async () => {
  const { m, wallet, ledger } = await mk({ A: 5000, B: 5000 }), a = conn('A'), b = conn('B');
  const code = await m.create(a, 'poker-simple', { size: 2, ante: 50, name: 'A' });
  await m.join(b, 'poker-simple', code, { name: 'B' });
  await wait(60);
  ledger.failAfterApply = 1;
  m.act(a, code, { type: 'start' }); await wait(3000);
  const room = m.rooms.get(code);
  assert.deepStrictEqual(m.members(room).map((x) => x.uid).sort(), ['A', 'B']);
  assert.strictEqual(JSON.parse(room.fields.state).phase, 'preflop');
  assert.strictEqual(await holdsSum(ledger), 10000);
  m.stop();
});

test('залог без средств не сбрасывает раунд «Мин»', async () => {
  const ledger = new MemLedger({ seeds: { Z: 5000 } }), wallet = new WalletService({ ledger }); await wallet.init();
  await wallet.act('Z', { op: 'minesStart', mines: 3 });
  const h = await wallet.hold('Z', 'ABCDE', 99999999);
  assert.strictEqual(h.ok, false);
  const s = await wallet.act('Z', { op: 'minesState' });
  assert.ok(s.result.mines && s.result.mines.status === 'playing', 'раунд цел');
});

test('после сбоя записи лимит залогов не обходится', async () => {
  const ledger = new MemLedger({ seeds: { Z: 50000 } }), wallet = new WalletService({ ledger }); await wallet.init();
  for (const c of ['AAAAA', 'BBBBB', 'CCCCC']) assert.strictEqual((await wallet.hold('Z', c, 100)).ok, true);
  ledger.failNext = 1;
  await wallet.act('Z', { op: 'claimDaily' }).catch(() => {});
  const h = await wallet.hold('Z', 'DDDDD', 100);
  assert.strictEqual(h.ok, false, '4-й залог отклонён');
});
