// «Покер: Чожук» против ботов на серверном балансе (ledger в памяти)
const test = require('node:test');
const assert = require('node:assert');
const { MemLedger } = require('../ledger');
const { WalletService } = require('../wallet-service');

async function mk(seeds, rng) {
  const ledger = new MemLedger({ seeds: seeds || {} }), wallet = new WalletService({ ledger, rng });
  await wallet.init();
  return { wallet, ledger };
}
const op = (wallet, uid, o) => wallet.act(uid, o);
// Играет раздачу до конца: игрок отвечает check/call, боты ходят по запросу
async function playHand(wallet, uid, first) {
  let r = first;
  for (let i = 0; i < 80 && r.result.poker.st.phase !== 'settled'; i++) {
    const st = r.result.poker.st;
    if (st.current === 0) {
      const to = st.currentBet - st.seats[0].bet;
      const must = to <= 0 && st.mandatory.indexOf(st.phase) >= 0;
      r = await op(wallet, uid, { op: 'pokerAct', action: { type: to > 0 ? 'call' : (must ? (st.seats[0].chips > st.minBet ? 'raise' : 'allin') : 'check'), amount: st.minBet } });
    } else r = await op(wallet, uid, { op: 'pokerBot' });
  }
  return r;
}

test('покер: раздача, ставки списываются одной записью в конце, чужие карты скрыты', async () => {
  const { wallet } = await mk();
  const r = await op(wallet, 'A', { op: 'pokerStart', size: 4, ante: 50, name: 'Аня' });
  const p = r.result.poker, st = p.st;
  assert.strictEqual(st.phase, 'preflop');
  assert.strictEqual(st.seats.length, 4);
  assert.ok(st.seats[0].cards.every((c) => typeof c === 'string'), 'свои карты видны');
  assert.ok(st.seats[1].cards.every((c) => c === null), 'карты бота скрыты');
  assert.strictEqual(st.deck, undefined, 'колоды в виде нет');
  assert.ok(p.spent >= 50, 'поставленное учтено');
  assert.strictEqual(r.state.balance, 5000, 'пока раздача идёт, баланс не трогается (запись в базу — в конце)');
});

test('покер: до конца раздачи баланс сходится с итогом, раунд сохраняется в хранилище', async () => {
  const { wallet, ledger } = await mk();
  let r = await op(wallet, 'A', { op: 'pokerStart', size: 3, ante: 50, name: 'Аня' });
  assert.ok(await ledger.get('rounds', 'A_pk'), 'партия записана');
  r = await playHand(wallet, 'A', r);
  const st = r.result.poker.st, me = st.seats[0];
  assert.strictEqual(st.phase, 'settled');
  assert.strictEqual(r.state.balance, 5000 + Math.min(me.net, 2500), 'баланс = старт + чистый результат (выигрыш не больше половины баланса на начало дня)');
  // сумма фишек за столом не меняется
  assert.strictEqual(st.seats.reduce((a, s) => a + s.net, 0), 0);
});

test('покер: ход не по очереди, чужая фаза и неизвестное действие отклоняются', async () => {
  const { wallet } = await mk();
  await assert.rejects(op(wallet, 'A', { op: 'pokerAct', action: { type: 'check' } }), /no-round/);
  await assert.rejects(op(wallet, 'A', { op: 'pokerBot' }), /no-round/);
  let r = await op(wallet, 'A', { op: 'pokerStart', size: 3, ante: 50 });
  await assert.rejects(op(wallet, 'A', { op: 'pokerAct', action: { type: 'cheat' } }), /bad-request/);
  await assert.rejects(op(wallet, 'A', { op: 'pokerNext' }), /bad-request/);
  const st = r.result.poker.st;
  if (st.current === 0) await assert.rejects(op(wallet, 'A', { op: 'pokerBot' }), /bad-request/);
  else await assert.rejects(op(wallet, 'A', { op: 'pokerAct', action: { type: 'fold' } }), /bad-request/);
});

test('покер: нельзя поставить больше, чем есть на балансе', async () => {
  const { wallet } = await mk({ A: 300 });
  let r = await op(wallet, 'A', { op: 'pokerStart', size: 2, ante: 100 });
  for (let i = 0; i < 30 && r.result.poker.st.phase !== 'settled'; i++) {
    const st = r.result.poker.st;
    if (st.current === 0) {
      await assert.rejects(op(wallet, 'A', { op: 'pokerAct', action: { type: 'raise', amount: 999999 } }), /bad-request/);
      r = await op(wallet, 'A', { op: 'pokerAct', action: { type: 'allin' } });
    } else r = await op(wallet, 'A', { op: 'pokerBot' });
  }
  assert.ok(r.state.balance >= 0);
});

test('покер: не хватает на начальную ставку — стол не открывается', async () => {
  const { wallet } = await mk({ A: 20 });
  const r = await op(wallet, 'A', { op: 'pokerStart', size: 3, ante: 50 });
  assert.strictEqual(r.result.poker, null);
  assert.strictEqual(r.result.broke, true);
  assert.strictEqual(r.state.balance, 20);
});

test('покер: следующая раздача за тем же столом и выход со сбросом', async () => {
  const { wallet, ledger } = await mk();
  let r = await op(wallet, 'A', { op: 'pokerStart', size: 3, ante: 50 });
  r = await playHand(wallet, 'A', r);
  const after = r.state.balance;
  r = await op(wallet, 'A', { op: 'pokerNext' });
  if (!r.result.poker) { assert.strictEqual(r.result.broke, true, 'проигрался до нуля: стол закрыт'); return; }
  assert.strictEqual(r.result.poker.st.round, 2);
  const bet = r.result.poker.free ? 0 : r.result.poker.spent;
  const left = await op(wallet, 'A', { op: 'pokerLeave' });
  assert.strictEqual(left.state.balance, after - bet, 'ушёл посреди раздачи — поставленное списано');
  assert.strictEqual(left.result.poker, null);
  assert.strictEqual(await ledger.get('rounds', 'A_pk'), null);
  await assert.rejects(op(wallet, 'A', { op: 'pokerAct', action: { type: 'fold' } }), /no-round/);
});

test('покер: новый стол посреди раздачи — поставленное не возвращается', async () => {
  const { wallet } = await mk();
  const a = await op(wallet, 'A', { op: 'pokerStart', size: 3, ante: 100 });
  const b = await op(wallet, 'A', { op: 'pokerStart', size: 3, ante: 100 });
  assert.strictEqual(b.state.balance, 5000 - a.result.poker.spent, 'брошенная раздача списана, новая ещё идёт');
});

test('покер: выигрыш против ботов упирается в дневной предел, дальше играют без аконов', async () => {
  const { wallet, ledger } = await mk({ A: 1000 });
  // дневной предел: половина баланса на начало дня, но не меньше 2500; считается чистый выигрыш — баланс не может вырасти больше чем на предел
  let total = 0, freeSeen = false;
  for (let g = 0; g < 120 && !freeSeen; g++) {
    let r = await op(wallet, 'A', g === 0 ? { op: 'pokerStart', size: 2, ante: 50 } : { op: 'pokerNext' }).catch(() => null);
    if (!r || !r.result.poker) break;
    if (r.result.poker.free) { freeSeen = true; break; }
    r = await playHand(wallet, 'A', r);
    total += r.result.poker.st.seats[0].net;
  }
  const s = await ledger.get('wallets', 'A');
  assert.ok(s.balance <= 1000 + 2500, 'чистый выигрыш за день не больше предела: ' + s.balance);
});

test('лимит записей базы: раздача покера и раунд «Мин» — несколько записей, а не запись на каждый ход', async () => {
  const { wallet, ledger } = await mk();
  let writes = 0; const commit = ledger.commit.bind(ledger);
  ledger.commit = (list) => { writes += list.length; return commit(list); };
  let r = await op(wallet, 'A', { op: 'pokerStart', size: 4, ante: 50 });
  let moves = 0;
  for (let i = 0; i < 80 && r.result.poker.st.phase !== 'settled'; i++, moves++) {
    const st = r.result.poker.st;
    r = await op(wallet, 'A', st.current === 0 ? { op: 'pokerAct', action: { type: st.currentBet > st.seats[0].bet ? 'call' : 'check' } } : { op: 'pokerBot' });
  }
  assert.ok(moves >= 3, 'раздача шла несколько ходов: ' + moves);
  assert.ok(writes <= 5, 'новый кошелёк + начало + итог раздачи: ' + writes + ' записей на ' + moves + ' ходов');
  writes = 0;
  await op(wallet, 'B', { op: 'minesStart', mines: 3 });
  const round = wallet.rounds.get('B');
  const safe = round.layout.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0).slice(0, 4);
  for (const i of safe) await op(wallet, 'B', { op: 'minesOpen', index: i, rid: 'rid-open-' + i });
  await op(wallet, 'B', { op: 'minesCash' });
  assert.ok(writes <= 4, 'новый кошелёк + начало + итог раунда: ' + writes);
  assert.ok((await wallet.load('B')).balance > 5000, 'выигрыш начислен');
});
