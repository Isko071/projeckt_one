// Шашки на сервере столов: партия на ставку до конца, ничья возвращает ставки, войти в идущую партию нельзя
const test = require('node:test');
const assert = require('node:assert');
const { loadEngine } = require('../load-engine');
const { RoomManager } = require('../manager');
const { MemLedger } = require('../ledger');
const { WalletService } = require('../wallet-service');

const engine = loadEngine(), C = engine.Checkers;
function conn(uid) { const c = { uid, msgs: [], send(o) { this.msgs.push(o); } }; c.last = () => { const d = c.msgs.filter((m) => m.t === 'doc'); return d.length ? d[d.length - 1].doc : null; }; return c; }
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 40));
async function table(stake) {
  const ledger = new MemLedger(), wallet = new WalletService({ ledger });
  await wallet.init();
  const m = new RoomManager({ engine, wallet, config: { engineOptions: { startDelayMs: 0 }, strayMs: 50 } });
  const a = conn('A'), b = conn('B');
  const code = await m.create(a, 'checkers', { size: 2, name: 'Аня', stake });
  await m.join(b, 'checkers', code, { name: 'Боря' });
  await settle();
  m.act(a, code, { type: 'start' }); await settle();
  return { m, wallet, a, b, code };
}
const bal = async (wallet, uid) => (await wallet.act(uid, { op: 'sync' })).state.balance;
const stateOf = (c) => JSON.parse(c.last().state);
const seatOf = (c) => JSON.parse(c.last().meta).members.filter((x) => x.uid === c.uid)[0].seat;

test('шашки онлайн: партия до конца по правилам, победитель забирает банк', async () => {
  const { m, wallet, a, b, code } = await table(200);
  assert.strictEqual(await bal(wallet, 'A'), 4800);
  let seed = 5; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let n = 0; n < 400; n++) {
    const st = stateOf(a);
    if (st.gameOver) break;
    const who = [a, b].filter((c) => seatOf(c) === st.current)[0];
    const list = C.legalMoves(st), mv = list[Math.floor(rng() * list.length)];
    m.act(who, code, { type: 'move', seat: st.current, path: mv.path });
    await settle(15);
  }
  await settle(120);
  const st = stateOf(a);
  assert.ok(st.gameOver, 'партия закончилась');
  if (st.winner >= 0) {
    const winner = seatOf(a) === st.winner ? 'A' : 'B', loser = winner === 'A' ? 'B' : 'A';
    assert.strictEqual(await bal(wallet, winner), 5200);
    assert.strictEqual(await bal(wallet, loser), 4800);
  } else {
    assert.strictEqual(await bal(wallet, 'A'), 5000); assert.strictEqual(await bal(wallet, 'B'), 5000);
  }
});

test('шашки онлайн: ход не в свою очередь и чужим местом не проходит; войти в идущую партию нельзя', async () => {
  const { m, a, b, code } = await table(0);
  const st = stateOf(a), white = st.white;
  const notMine = [a, b].filter((c) => seatOf(c) !== white)[0];
  const mv = C.legalMoves(st)[0];
  m.act(notMine, code, { type: 'move', seat: white, path: mv.path });            // подделал своё место: сервер ставит настоящее
  await settle(60);
  assert.strictEqual(stateOf(a).turns, 0, 'ход не принят');
  await assert.rejects(m.join(conn('C'), 'checkers', code, { name: 'Вася' }), /started/);
});

test('шашки онлайн: сдача — победа сопернику и банк ему', async () => {
  const { m, wallet, a, b, code } = await table(300);
  m.act(b, code, { type: 'concede', seat: seatOf(b) }); await settle(120);
  assert.strictEqual(stateOf(a).reason, 'concede');
  assert.strictEqual(await bal(wallet, 'A'), 5300); assert.strictEqual(await bal(wallet, 'B'), 4700);
});

test('шашки онлайн: ничья — ставки возвращаются', async () => {
  const { m, wallet, a, code } = await table(250);
  const room = m.rooms.get(code);
  // доводим партию до ничьей прямо в документе стола: проверяем расчёт ставок по итогу «draw»
  const st = stateOf(a); st.gameOver = true; st.winner = -1; st.reason = 'draw'; st.current = -1;
  await m.settleStake(code, room, st, m.members(room));
  assert.strictEqual(await bal(wallet, 'A'), 5000); assert.strictEqual(await bal(wallet, 'B'), 5000);
});
