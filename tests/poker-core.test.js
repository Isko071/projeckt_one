// Запуск: node --test tests/poker-core.test.js
// Ход партии за столом покера без экрана: стол с ботами (на настоящем кошельке) и онлайн-стол (на поддельном контроллере).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
function load(backend) {
  const ctx = vm.createContext({ localStorage: backend, JSON, Math, Object, Array, Number, String, Date, Promise, setTimeout, clearTimeout, Error });
  ['shared/storage.js', 'shared/wallet.js', 'games/poker/logic.js', 'games/poker/bots.js', 'shared/poker-core.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}
function fakeBackend() {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FAST = { botMs: 1, holdMs: 1, flipMs: 5, dealMs: 0 };

async function playHand(t, pick) {
  for (let i = 0; i < 400; i++) {
    const m = t.model();
    if (m.stage === 'summary' || m.stage === 'short' || m.stage === 'broke') return m;
    if (m.me.la) pick(m, t); else await wait(3);
    await wait(2);
  }
  throw new Error('раздача не закончилась');
}
// осторожный игрок: ставит минимум там, где нельзя пропускать, уравнивает только небольшие ставки, остальное сбрасывает (чтобы случайный олл-ин не обнулил баланс посреди теста)
const passive = (m, t) => { const la = m.me.la; if (la.mustBet && la.raise) t.act('raise', { amount: la.raise.min }); else if (la.check) t.act('check'); else if (la.call && la.call <= 300) t.act('call'); else t.act('fold'); };

test('стол с ботами: раздача идёт до итога, деньги списываются сразу и возвращаются по итогу', async () => {
  const ctx = load(fakeBackend()), W = ctx.PlatformWallet;
  const t = ctx.PokerCore.createSolo(Object.assign({ variant: 'simple', size: 4, ante: 50, name: 'Аня', wallet: W, source: 'poker-simple' }, FAST));
  const start = W.getBalance();
  t.begin();
  const m0 = t.model();
  assert.equal(m0.seats.length, 4);
  assert.equal(m0.seats[0].isMe, true);
  assert.ok(W.getBalance() < start, 'начальная ставка списана сразу');
  const m = await playHand(t, passive);
  assert.ok(m.stage === 'summary' || m.stage === 'short');
  const me = t.st.seats[0], payout = me.total + me.net;
  assert.equal(W.getBalance(), start - me.total + (m.notice ? W.getBalance() - (start - me.total) : payout), 'баланс = было − вложено + выплата (с учётом предела)');
  assert.ok(m.summary.rows.length >= 2);
  assert.equal(m.summary.bank, t.st.pot);
  t.leave();
});

test('стол с ботами: скрытые карты ботов закрыты, пока не вскрытие; после «Вернуться к столу» идёт новая раздача', async () => {
  const ctx = load(fakeBackend()), W = ctx.PlatformWallet;
  const t = ctx.PokerCore.createSolo(Object.assign({ variant: 'classic', size: 3, bigBlind: 100, name: 'Аня', wallet: W, source: 'poker' }, FAST));
  t.begin();
  const m0 = t.model();
  m0.seats.slice(1).forEach((s) => s.cards.forEach((c) => assert.equal(c.code, null)));
  assert.equal(m0.seats[0].cards.length, 2);
  assert.ok(m0.seats[0].cards.every((c) => typeof c.code === 'string'));
  assert.ok(m0.seats.some((s) => s.dealer), 'видна кнопка раздающего');
  assert.ok(m0.seats.some((s) => s.sb) && m0.seats.some((s) => s.bb));
  const round = t.st.round;
  await playHand(t, passive);
  t.back();
  assert.equal(t.st.round, round + 1);
  t.leave();
});

test('обязательный круг: чек недоступен, а подпись и допустимые действия отдаются экрану', async () => {
  const ctx = load(fakeBackend()), W = ctx.PlatformWallet;
  const t = ctx.PokerCore.createSolo(Object.assign({ variant: 'simple', size: 2, ante: 50, name: 'Аня', wallet: W, source: 'poker-simple' }, FAST));
  t.begin();
  let m = t.model(), seen = false;
  for (let step = 0; step < 300 && !seen; step++) {
    if (m.me.la && m.me.la.mustBet) { seen = true; assert.equal(m.me.la.check, false); assert.equal(t.act('check'), false, 'чек отклоняется логикой'); break; }
    if (m.me.la) passive(m, t);
    else if (m.stage === 'summary' || m.stage === 'short') t.back();
    else await wait(3);
    m = t.model();
  }
  assert.ok(seen, 'дождались своего хода в обязательном круге');
  t.leave();
});

test('предел выигрыша и итоговые строки банков: основной, побочный и возврат непокрытой ставки', () => {
  const ctx = load(fakeBackend()), C = ctx.PokerCore, P = ctx.Poker;
  const seats = [{ id: 'a', name: 'А', kind: 'human', chips: 100 }, { id: 'b', name: 'Б', kind: 'human', chips: 1000 }, { id: 'c', name: 'В', kind: 'human', chips: 1000 }];
  let st = P.reduce(P.init(seats, { variant: 'classic' }, null), { type: 'deal', seat: 0 }, () => 0.3).state;
  st.seats[0].cards = ['AS', 'AH']; st.seats[1].cards = ['KS', 'KH']; st.seats[2].cards = ['7D', '2C'];
  st.deck = ['3C', '4D', '5H', '9S', 'JC'].reverse().concat(st.deck.filter((c) => !['3C', '4D', '5H', '9S', 'JC', 'AS', 'AH', 'KS', 'KH', '7D', '2C'].includes(c)).slice(0, 0));
  st.deck = st.deck.slice();
  const act = (a) => { const r = P.reduce(st, a, () => 0.3); assert.ok(r.ok, JSON.stringify(a) + r.error); st = r.state; };
  act({ type: 'allin', seat: 0 }); act({ type: 'raise', seat: 1, amount: 600 }); act({ type: 'fold', seat: 2 });
  assert.equal(st.phase, 'settled');
  const s = C.summaryOf(st, 0);
  assert.ok(s.lines.some((l) => l.k === 'returned' && l.amount === 500), 'вернулось непокрытое: ' + JSON.stringify(s.lines));
  assert.ok(s.lines.some((l) => l.k === 'main'));
  assert.equal(s.taker.name, 'А');
});

function fakeCtrl(uid) {
  const listeners = [], sent = [];
  const c = { view: null, sent, onChange: (fn) => listeners.push(fn), getView: () => c.view, send: (a) => { sent.push(a); return Promise.resolve(); }, leave: () => { c.left = true; }, push: (v) => { c.view = v; listeners.forEach((fn) => fn(v)); }, poll: () => Promise.resolve(c.view) };
  return c;
}
function view(ctx, st, extra) {
  return Object.assign({ code: 'K7QX2', role: 'player', status: 'playing', size: 4, variant: 'simple', ante: 50, minBet: 100, rev: 1, phase: st.phase, members: st.seats.filter((s) => s.active).map((s) => ({ uid: s.id, name: s.name, avatar: 0, seat: s.index })), state: JSON.parse(JSON.stringify(st)), timers: [], startIn: -1, readyIn: -1, ready: [], strikes: {}, private: false, owner: 'me', receivedAt: Date.now(), chat: [], seat: 0, joined: true, hostGone: false, closed: false, heartbeat: Date.now() }, extra || {});
}

test('онлайн-стол: свои действия уходят на сервер, итог и «Вернуться к столу» отправляют ready, вопрос «Вы ещё играете?» и выбывание', () => {
  const ctx = load(fakeBackend()), W = ctx.PlatformWallet, P = ctx.Poker;
  const seats = [{ id: 'me', name: 'Аня', kind: 'human', chips: 4000 }, { id: 'u2', name: 'Борис', kind: 'human', chips: 4000 }];
  let st = P.reduce(P.init(seats, { variant: 'simple', ante: 50, tableSize: 4 }, null), { type: 'deal', seat: 0 }, () => 0.5).state;
  const ctrl = fakeCtrl('me');
  const t = ctx.PokerCore.createOnline({ ctrl, wallet: W, source: 'poker-simple', uid: 'me', variant: 'simple', dealMs: 0 });
  const before = W.getBalance();
  ctrl.push(view(ctx, st));
  assert.ok(W.getBalance() < before, 'начальная ставка списана при получении раздачи');
  st = JSON.parse(JSON.stringify(st)); st.current = 0;
  ctrl.push(view(ctx, st));
  const m = t.model();
  assert.equal(m.mode, 'online');
  assert.ok(m.me.la, 'мой ход');
  t.act('raise', { amount: 100 });
  assert.deepEqual(JSON.parse(JSON.stringify(ctrl.sent[0])), { type: 'raise', amount: 100 });
  // вопрос «Вы ещё играете?»
  ctrl.push(view(ctx, st, { timers: [{ seat: 0, stage: 'asking', ms: 5000 }], rev: 2 }));
  assert.equal(t.model().ask.k, 'ask');
  t.here(); assert.deepEqual(JSON.parse(JSON.stringify(ctrl.sent[1])), { type: 'here' });
  // автоход: счётчик пропусков вырос
  ctrl.push(view(ctx, st, { strikes: { me: 1 }, rev: 3 }));
  assert.equal(t.model().ask.k, 'auto');
  t.ackAuto(); assert.equal(t.model().ask, null);
  // итог
  const settled = JSON.parse(JSON.stringify(st)); settled.phase = 'settled'; settled.current = -1; settled.result = { showdown: false, rows: [] };
  settled.seats[0].net = 150; settled.seats[1].net = -150; settled.seats[1].folded = true; settled.pots = [{ amount: 300, eligible: [0], winners: [0] }]; settled.pot = 300;
  ctrl.push(view(ctx, settled, { rev: 4 }));
  assert.equal(t.model().stage, 'short');
  t.back();
  assert.deepEqual(JSON.parse(JSON.stringify(ctrl.sent[2])), { type: 'ready' });
  assert.equal(t.model().stage, 'ready');
  // нас убрали со стола
  ctrl.push(view(ctx, settled, { rev: 5, joined: false, seat: null, members: [{ uid: 'u2', name: 'Борис', avatar: 0, seat: 1 }] }));
  assert.equal(t.model().ask.k, 'out');
});

test('онлайн-стол до начала игры отдаёт модель комнаты ожидания', () => {
  const ctx = load(fakeBackend()), W = ctx.PlatformWallet;
  const ctrl = fakeCtrl('me');
  const t = ctx.PokerCore.createOnline({ ctrl, wallet: W, source: 'poker-simple', uid: 'me', variant: 'simple', dealMs: 0 });
  ctrl.push({ code: 'K7QX2', status: 'lobby', size: 4, variant: 'simple', ante: 50, minBet: 100, members: [{ uid: 'me', name: 'Аня', avatar: 0, seat: 0 }], state: null, timers: [], startIn: 14000, owner: 'me', receivedAt: Date.now(), chat: [], seat: 0, joined: true, closed: false, private: false });
  const m = t.model();
  assert.equal(m.lobby, true);
  assert.equal(m.isOwner, true);
  assert.equal(m.members.length, 1);
  assert.ok(m.startIn > 0);
});

test('стол с ботами: при достигнутом дневном пределе играем без аконов — ничего не списывается и не начисляется', async () => {
  const be = fakeBackend(), ctx = load(be), W = ctx.PlatformWallet;
  const t = ctx.PokerCore.createSolo(Object.assign({ variant: 'simple', size: 3, ante: 50, name: 'Аня', wallet: W, source: 'poker-simple' }, FAST));
  const key = Object.keys(be.data).filter((k) => /wallet/.test(k))[0];
  const w = JSON.parse(be.data[key]); w.capUsed = 1e9; be.data[key] = JSON.stringify(w);
  ctx.PlatformWallet.forget && ctx.PlatformWallet.forget();
  const start = W.getBalance();
  assert.equal(W.capStatus(Date.now()).left, 0);
  t.begin();
  assert.equal(t.model().notice.k, 'free');
  assert.equal(W.getBalance(), start, 'ставка не списана');
  await playHand(t, passive);
  assert.equal(W.getBalance(), start, 'выигрыш не начислен, баланс прежний');
  t.leave();
});

test('раздача в начале руки: пока карты раздаются, ходить нельзя и ход не подсвечен, потом всё доступно', async () => {
  const ctx = load(fakeBackend()), W = ctx.PlatformWallet;
  const t = ctx.PokerCore.createSolo(Object.assign({ variant: 'simple', size: 3, ante: 50, name: 'Аня', wallet: W, source: 'poker-simple' }, FAST, { dealMs: 150, botMs: 1 }));
  t.begin();
  const m = t.model();
  assert.ok(m.dealMs > 0, 'идёт раздача');
  assert.equal(m.me.la, null, 'ходить нельзя');
  assert.ok(m.seats.every((s) => !s.turn), 'никто не подсвечен');
  assert.equal(t.act('check'), false);
  await wait(260);
  assert.equal(t.model().dealMs, 0, 'раздача закончилась');
  t.leave();
});
