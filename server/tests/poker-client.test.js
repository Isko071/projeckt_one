// Стол «Покера» против ботов в серверном режиме: экранная часть (shared/poker-core.js) на настоящем серверном кошельке
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MemLedger } = require('../ledger');
const { WalletService } = require('../wallet-service');

const root = path.join(__dirname, '..', '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function clientCtx(svc, uid, opts) {
  const data = {}, backend = { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
  const ctx = vm.createContext({ localStorage: backend, JSON, Math, Object, Array, Number, String, Date, Promise, setTimeout, clearTimeout, Error });
  ['shared/storage.js', 'shared/wallet.js', 'games/poker/logic.js', 'games/poker/bots.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
  const W = ctx.PlatformWallet, calls = [];
  W.setServer({ active: () => true, queueing: () => true, claim() {} });
  ctx.PlatformWalletSync = {
    status: () => 'server',
    call(op, args, holdFor) {
      calls.push(op);
      if (opts && opts.failOnce && !opts.failed && op === 'pokerBot') { opts.failed = true; return Promise.reject(Object.assign(new Error('offline'), { code: 'offline' })); }
      return svc.act(uid, Object.assign({ op }, args)).then((r) => { if (holdFor) holdFor(r); W.applyServer(r.state); return r; });
    }
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'shared/poker-core.js'), 'utf8'), ctx, { filename: 'shared/poker-core.js' });
  return { ctx, W, calls };
}
const FAST = { botMs: 1, holdMs: 1, flipMs: 5, dealMs: 0 };
async function playHand(t) {
  for (let i = 0; i < 2000; i++) {
    const m = t.model();
    if (m.stage === 'summary' || m.stage === 'short' || m.stage === 'broke') return m;
    if (m.me.la) { const la = m.me.la; if (la.mustBet && la.raise) t.act('raise', { amount: la.raise.min }); else if (la.check) t.act('check'); else if (la.call && la.call <= 300) t.act('call'); else t.act('fold'); }
    await wait(4);
  }
  throw new Error('раздача не закончилась ' + JSON.stringify({ stage: t.model().stage, phase: t.model().phase, cur: t.st.current, busy: t.busy, fails: t.failures }));
}

test('стол с ботами на сервере: раздача идёт запросами, баланс на экране равен серверному', async () => {
  const svc = new WalletService({ ledger: new MemLedger() }); await svc.init();
  const { ctx, W, calls } = clientCtx(svc, 'A');
  const t = ctx.PokerCore.createSolo(Object.assign({ variant: 'simple', size: 3, ante: 50, name: 'Аня', wallet: W, source: 'poker-simple' }, FAST));
  t.begin();
  await wait(60);
  assert.ok(calls.includes('pokerStart'));
  const m0 = t.model();
  assert.strictEqual(m0.phase === 'preflop' || m0.phase === 'flop', true);
  assert.ok(m0.seats.filter((s) => !s.isMe).every((s) => s.cards.every((c) => c.code === null)), 'карты ботов клиенту не приходили');
  const m = await playHand(t);
  assert.ok(['summary', 'short'].includes(m.stage));
  assert.strictEqual(W.getBalance(), svc.balanceOf('A'), 'баланс на экране = серверный');
  assert.ok(calls.includes('pokerBot') && calls.includes('pokerAct'));
  t.back();
  await wait(60);
  assert.ok(calls.includes('pokerNext'));
  assert.strictEqual(t.model().round, 2, 'следующая раздача');
  t.leave();
  await wait(30);
  assert.ok(calls.includes('pokerLeave'));
  assert.strictEqual(await svc.ledger.get('rounds', 'A_pk'), null);
});

test('стол с ботами на сервере: обрыв связи на ходу бота — стол сверяется с сервером и продолжает', async () => {
  const svc = new WalletService({ ledger: new MemLedger() }); await svc.init();
  const opts = { failOnce: true };
  const { ctx, W, calls } = clientCtx(svc, 'A', opts);
  const t = ctx.PokerCore.createSolo(Object.assign({ variant: 'simple', size: 3, ante: 50, name: 'Аня', wallet: W, source: 'poker-simple' }, FAST));
  t.begin();
  const m = await playHand(t);
  assert.ok(opts.failed, 'сбой был');
  assert.ok(['summary', 'short'].includes(m.stage));
  assert.ok(calls.includes('pokerState'), 'после сбоя состояние запрошено у сервера');
  t.leave();
});
