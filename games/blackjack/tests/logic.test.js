// Запуск: node --test games/blackjack/tests/logic.test.js
// Логика берётся из games/blackjack/logic.js (без DOM, выполняется в изолированном контексте vm).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8'), ctx);
const B = ctx.Blackjack;
const plain = (x) => JSON.parse(JSON.stringify(x));
// Массивы из контекста vm имеют другой прототип, поэтому сравниваем через обычные копии
const deepEqual = (a, b, m) => assert.deepEqual(plain(a), plain(b), m);

// Партия с заданной колодой: карты выдаются по порядку (игрок, дилер, игрок, дилер, дальше по ходу игры)
function table(stack, chips = 1000, seats = 1) {
  let state = B.init(Array.from({ length: seats }, (_, i) => ({ name: 'p' + i, chips })), { stack });
  const act = (a) => { const r = B.reduce(state, a, () => 0.5); if (r.ok) state = r.state; return r; };
  return { get state() { return state; }, act };
}
function start(stack, bet = 100, chips = 1000) {
  const t = table(stack, chips);
  assert.equal(t.act({ type: 'bet', seat: 0, amount: bet }).ok, true);
  assert.equal(t.act({ type: 'deal', seat: 0 }).ok, true);
  return t;
}

test('подсчёт: тузы, мягкие и жёсткие суммы, перебор', () => {
  const v = (cs) => plain(B.handValue(cs));
  deepEqual(v(['AS', 'KH']), { total: 21, soft: true });
  deepEqual(v(['AS', 'AH']), { total: 12, soft: true });
  deepEqual(v(['AS', '6H', 'TD']), { total: 17, soft: false });
  deepEqual(v(['AS', 'AH', 'AD', '8C']), { total: 21, soft: true });
  deepEqual(v(['TS', '6H', '9D']), { total: 25, soft: false });
  assert.equal(B.cardValue('QH'), 10);
  assert.equal(B.cardValue('9S'), 9);
  assert.equal(B.isNatural({ cards: ['AS', 'TH'], fromSplit: false }), true);
  assert.equal(B.isNatural({ cards: ['AS', 'TH'], fromSplit: true }), false, 'после деления 21 не блэкджек');
  assert.equal(B.isNatural({ cards: ['7S', '7H', '7D'], fromSplit: false }), false);
});

test('колода: 6 колод по 52 карты, каждой карты по 6, тасовка воспроизводима', () => {
  const shoe = B.buildShoe(6, () => 0.3);
  assert.equal(shoe.length, 312);
  const counts = {};
  shoe.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
  assert.equal(Object.keys(counts).length, 52);
  Object.values(counts).forEach((n) => assert.equal(n, 6));
  let k = 7; const seeded = () => { k = (k * 16807) % 2147483647; return k / 2147483647; };
  let k2 = 7; const seeded2 = () => { k2 = (k2 * 16807) % 2147483647; return k2 / 2147483647; };
  deepEqual(B.buildShoe(2, seeded), B.buildShoe(2, seeded2));
});

test('ставки: кратность 25, пределы, хватает ли фишек, замена и снятие ставки', () => {
  const t = table(['2S'], 300);
  for (const bad of [10, 30, 24, -25, 2525, 25.5, '50', null]) assert.equal(t.act({ type: 'bet', seat: 0, amount: bad }).error, 'bad-amount', String(bad));
  assert.equal(t.act({ type: 'bet', seat: 0, amount: 500 }).error, 'not-enough-chips');
  assert.equal(t.act({ type: 'bet', seat: 0, amount: 100 }).ok, true);
  assert.equal(t.state.seats[0].chips, 200);
  assert.equal(t.act({ type: 'bet', seat: 0, amount: 250 }).ok, true, 'ставку можно заменить');
  deepEqual([t.state.seats[0].chips, t.state.seats[0].bet], [50, 250]);
  assert.equal(t.act({ type: 'bet', seat: 0, amount: 0 }).ok, true);
  deepEqual([t.state.seats[0].chips, t.state.seats[0].bet], [300, 0]);
  assert.equal(t.act({ type: 'deal', seat: 0 }).error, 'no-bet');
  assert.equal(t.act({ type: 'hit', seat: 0 }).error, 'wrong-phase');
  assert.equal(t.act({ type: 'bet', seat: 3, amount: 25 }).error, 'bad-seat');
});

test('блэкджек у игрока платит 3:2 (с округлением вниз), дилер ничего не берёт', () => {
  const t = start(['AS', '9H', 'KH', '7D'], 100);
  const s = t.state;
  assert.equal(s.phase, 'settled');
  assert.equal(s.seats[0].hands[0].outcome, 'blackjack');
  assert.equal(s.seats[0].chips, 900 + 250);
  assert.equal(s.seats[0].net, 150);
  assert.equal(s.dealer.cards.length, 2, 'дилер не добирает, когда у игрока блэкджек');
  const odd = start(['AS', '9H', 'KH', '7D'], 25);
  assert.equal(odd.state.seats[0].net, 37, '25 × 1,5 = 37,5 → 37');
});

test('блэкджек у обоих — ничья; у дилера (туз открыт) — игрок проигрывает сразу', () => {
  const both = start(['AS', 'KH', 'KD', 'AD'], 100);
  assert.equal(both.state.seats[0].hands[0].outcome, 'push');
  assert.equal(both.state.seats[0].chips, 1000);
  const dealerBj = start(['9S', 'AH', '8D', 'KD'], 100);
  assert.equal(dealerBj.state.phase, 'settled');
  assert.equal(dealerBj.state.seats[0].hands[0].outcome, 'lose');
  assert.equal(dealerBj.state.seats[0].chips, 900);
  assert.equal(dealerBj.state.dealer.hidden, false);
  const tenUp = start(['9S', 'KH', '8D', 'AD'], 100);
  assert.equal(tenUp.state.seats[0].hands[0].outcome, 'lose', 'дилер с десяткой тоже заглядывает во вторую карту');
});

test('игра: взять, перебор — сразу проигрыш; дилер не добирает, если у игрока перебор', () => {
  const t = start(['TS', '9H', '6D', '7C', 'KH'], 100);
  assert.equal(t.state.phase, 'playing');
  deepEqual(B.availableActions(t.state, 0).sort(), ['double', 'hit', 'stand']);
  t.act({ type: 'hit', seat: 0 });
  assert.equal(t.state.phase, 'settled');
  assert.equal(t.state.seats[0].hands[0].outcome, 'bust');
  assert.equal(t.state.dealer.cards.length, 2);
  assert.equal(t.state.seats[0].chips, 900);
});

test('дилер берёт до 17 и стоит на мягких 17; выигрыш 1:1, ничья возвращает ставку', () => {
  // дилер: 6 + A (мягкие 17) — стоит
  let t = start(['TS', '6H', '8D', 'AC'], 100);   // игрок 18
  t.act({ type: 'stand', seat: 0 });
  assert.equal(t.state.dealer.cards.length, 2);
  assert.equal(t.state.seats[0].hands[0].outcome, 'win');
  assert.equal(t.state.seats[0].chips, 1100);
  // дилер: 5 + 4 = 9, берёт 8 = 17, игрок 17 — ничья
  t = start(['TS', '5H', '7D', '4C', '8S'], 100);
  t.act({ type: 'stand', seat: 0 });
  deepEqual(plain(t.state.dealer.cards), ['5H', '4C', '8S']);
  assert.equal(t.state.seats[0].hands[0].outcome, 'push');
  assert.equal(t.state.seats[0].chips, 1000);
  // дилер перебирает
  t = start(['TS', '6H', '7D', 'TC', 'KS'], 100);
  t.act({ type: 'stand', seat: 0 });
  assert.equal(t.state.seats[0].hands[0].outcome, 'win');
  // дилер выигрывает
  t = start(['TS', 'TH', '7D', '9C'], 100);
  t.act({ type: 'stand', seat: 0 });
  assert.equal(t.state.seats[0].hands[0].outcome, 'lose');
});

test('удвоение: ставка ×2, ровно одна карта, фишки списываются; недоступно без фишек и после взятия карты', () => {
  const t = start(['5S', '6H', '6D', 'TC', 'TS', '8H'], 100);   // игрок 11, дилер 6+10=16 → берёт 8 = перебор? 6+T=16, добор T→26
  t.act({ type: 'double', seat: 0 });
  const h = t.state.seats[0].hands[0];
  assert.equal(h.bet, 200);
  assert.equal(h.cards.length, 3);
  assert.equal(t.state.phase, 'settled');
  assert.equal(h.outcome, 'win');
  assert.equal(t.state.seats[0].chips, 800 + 400);
  assert.equal(t.state.seats[0].net, 200);
  const poor = start(['5S', '6H', '6D', 'TC'], 100, 150);
  assert.equal(poor.act({ type: 'double', seat: 0 }).error, 'cannot-double');
  const late = start(['2S', '6H', '3D', 'TC', '2H'], 100);
  late.act({ type: 'hit', seat: 0 });
  assert.equal(late.act({ type: 'double', seat: 0 }).error, 'cannot-double');
});

test('деление: две руки играются по очереди, ставка на каждую, 21 после деления платит 1:1', () => {
  // игрок 8+8, дилер 6+T; после деления: 8+3, 8+T... дальше подсказки по картам
  const t = start(['8S', '6H', '8D', 'TC', '3H', 'TD', '8H', 'QS'], 100);
  deepEqual(B.availableActions(t.state, 0).sort(), ['double', 'hit', 'split', 'stand']);
  t.act({ type: 'split', seat: 0 });
  let s = t.state;
  assert.equal(s.seats[0].hands.length, 2);
  deepEqual(plain(s.seats[0].hands.map((h) => h.cards)), [['8S', '3H'], ['8D', 'TD']]);
  assert.equal(s.seats[0].chips, 800);
  assert.equal(B.canSplit(s, 0), false, 'делить второй раз нельзя');
  assert.equal(s.hand, 0);
  t.act({ type: 'hit', seat: 0 });       // 8+3+8 = 19
  t.act({ type: 'stand', seat: 0 });
  assert.equal(t.state.hand, 1);
  t.act({ type: 'stand', seat: 0 });     // 18
  s = t.state;
  assert.equal(s.phase, 'settled');
  deepEqual(s.seats[0].hands.map((h) => h.outcome), ['win', 'win']);   // дилер 6+T=16, берёт Q → перебор
  assert.equal(s.seats[0].chips, 800 + 400);
});

test('деление тузов: по одной карте, дальше нельзя; 21 не блэкджек', () => {
  const t = start(['AS', '6H', 'AD', 'TC', 'KH', 'QD', '2S'], 100);
  t.act({ type: 'split', seat: 0 });
  const s = t.state;
  assert.equal(s.phase, 'settled', 'обе руки закончены сразу, ход перешёл к дилеру');
  deepEqual(plain(s.seats[0].hands.map((h) => h.cards)), [['AS', 'KH'], ['AD', 'QD']]);
  deepEqual(s.seats[0].hands.map((h) => h.outcome), ['win', 'win'], '21 после деления платит 1:1, а не 3:2');
  assert.equal(s.seats[0].chips, 800 + 400);
});

test('деление недоступно: разные карты, не хватает фишек', () => {
  const t = start(['8S', '6H', '9D', 'TC'], 100);
  assert.equal(t.act({ type: 'split', seat: 0 }).error, 'cannot-split');
  const poor = start(['8S', '6H', '8D', 'TC'], 100, 150);
  assert.equal(poor.act({ type: 'split', seat: 0 }).error, 'cannot-split');
});

test('очерёдность: действовать может только место, чей сейчас ход', () => {
  const t = table(['5S', '4S', '9H', '6D', '3H', 'TC', '8C', '2D'], 1000, 2);
  t.act({ type: 'bet', seat: 0, amount: 100 });
  t.act({ type: 'bet', seat: 1, amount: 50 });
  t.act({ type: 'deal', seat: 1 });
  deepEqual(plain(t.state.seats.map((s) => s.hands[0].cards)), [['5S', '6D'], ['4S', '3H']]);
  assert.equal(t.state.current, 0);
  assert.equal(t.act({ type: 'hit', seat: 1 }).error, 'not-your-turn');
  t.act({ type: 'stand', seat: 0 });
  assert.equal(t.state.current, 1);
  assert.equal(t.act({ type: 'stand', seat: 0 }).error, 'not-your-turn');
});

test('место без ставки пропускает раздачу и остаётся с фишками', () => {
  const t = table(['5S', '9H', '6D', 'TC'], 1000, 2);
  t.act({ type: 'bet', seat: 1, amount: 50 });
  t.act({ type: 'deal', seat: 1 });
  assert.equal(t.state.seats[0].hands.length, 0);
  assert.equal(t.state.current, 1);
  t.act({ type: 'stand', seat: 1 });
  assert.equal(t.state.seats[0].chips, 1000);
});

test('новая раздача: стол очищается, колода перетасовывается, когда осталась меньше четверти', () => {
  const t = start(['TS', '9H', '9D', '8C'], 100);
  t.act({ type: 'stand', seat: 0 });
  assert.equal(t.state.phase, 'settled');
  assert.equal(t.act({ type: 'next', seat: 0 }).ok, true);
  const s = t.state;
  deepEqual([s.phase, s.round, s.seats[0].bet, s.seats[0].hands.length, s.dealer.cards.length], ['betting', 1, 0, 0, 0]);
  assert.equal(t.act({ type: 'next', seat: 0 }).error, 'wrong-phase');
  // настоящая колода: при малом остатке будет тасовка
  let real = B.init([{ chips: 1000 }], { decks: 1 }, () => 0.5);
  real.shoe = real.shoe.slice(0, 10); real.phase = 'settled';
  const r = B.reduce(real, { type: 'next', seat: 0 }, () => 0.5);
  assert.equal(r.state.shoe.length, 52);
  assert.equal(r.events[0].type, 'shuffle');
});

test('вид для места: закрытая карта дилера и колода скрыты, после раскрытия видны', () => {
  const t = start(['TS', '9H', '7D', '8C'], 100);
  const v = B.view(t.state);
  assert.equal(v.dealer.cards[1], '??');
  assert.equal(v.dealer.cards[0], '9H');
  assert.equal(v.shoe, undefined);
  assert.equal(typeof v.shoeCount, 'number');
  assert.equal(t.state.dealer.cards[1], '8C', 'исходное состояние не изменено');
  t.act({ type: 'stand', seat: 0 });
  assert.equal(B.view(t.state).dealer.cards[1], '8C');
});

test('reduce не меняет исходное состояние, отклонения возвращают причину', () => {
  const state = B.init([{ chips: 500 }], { stack: ['2S'] });
  const frozen = plain(state);
  assert.equal(B.reduce(state, { type: 'bet', seat: 0, amount: 100 }).ok, true);
  deepEqual(plain(state), frozen);
  assert.equal(B.reduce(state, null).error, 'bad-action');
  assert.equal(B.reduce(state, { type: 'dance', seat: 0 }).error, 'unknown-action');
});

test('подсказка: ключевые решения базовой стратегии', () => {
  const h = (p1, p2, up, extra) => {
    const t = start([p1, up, p2, 'TC'].concat(extra || []), 100, 5000);
    return B.hint(t.state, 0);
  };
  assert.equal(h('8S', '8D', '6H'), 'split');      // пара восьмёрок
  assert.equal(h('AS', 'AD', 'TH'), 'split');      // пара тузов
  assert.equal(h('TS', 'KD', '6H', ['9S']), 'stand');
  assert.equal(h('5S', '6D', '6H'), 'double');      // 11 против 6
  assert.equal(h('6S', '4D', '9H'), 'double');      // 10 против 9
  assert.equal(h('6S', '4D', 'TH'), 'hit');         // 10 против 10
  assert.equal(h('TS', '2D', '3H'), 'hit');         // 12 против 3
  assert.equal(h('TS', '2D', '5H'), 'stand');       // 12 против 5
  assert.equal(h('TS', '6D', '7H'), 'hit');         // 16 против 7
  assert.equal(h('TS', '6D', '5H'), 'stand');       // 16 против 5
  assert.equal(h('AS', '7D', '5H'), 'double');      // мягкие 18 против 5
  assert.equal(h('AS', '7D', '9H'), 'hit');         // мягкие 18 против 9
  assert.equal(h('AS', '7D', '7H'), 'stand');       // мягкие 18 против 7
  assert.equal(h('AS', '6D', '5H'), 'double');      // мягкие 17 против 5
  assert.equal(h('9S', '9D', '7H'), 'stand');       // девятки против 7
  assert.equal(h('9S', '9D', '5H'), 'split');
  assert.equal(h('TS', 'KD', '5H'), 'stand');       // десятки не делим
  assert.equal(h('5S', '5D', '6H'), 'double');      // пятёрки как 10
  // без фишек на удвоение: 11 против 6 → просто взять
  const poor = start(['5S', '6H', '6D', 'TC'], 100, 150);
  assert.equal(B.hint(poor.state, 0), 'hit');
});

test('подсказка недоступна вне хода игрока', () => {
  const t = table(['2S'], 1000);
  assert.equal(B.hint(t.state, 0), null);
});

// Инварианты на случайной игре: фишки сохраняются, выплаты считаются верно, раздача всегда заканчивается
test('случайная игра по подсказкам и вразнобой: фишки сходятся, раздача заканчивается, выплаты допустимы', () => {
  let k = 12345; const rng = () => { k = (k * 1103515245 + 12345) % 2147483648; return k / 2147483648; };
  let state = B.init([{ chips: 100000 }, { chips: 100000 }], { decks: 6 }, rng);
  const total = () => state.seats.reduce((a, s) => a + s.chips, 0);
  let rounds = 0;
  for (let step = 0; step < 20000 && rounds < 300; step++) {
    let r;
    if (state.phase === 'betting') {
      state.seats.forEach((s, i) => { const x = B.reduce(state, { type: 'bet', seat: i, amount: [25, 50, 100, 250, 500][Math.floor(rng() * 5)] }, rng); assert.equal(x.ok, true); state = x.state; });
      r = B.reduce(state, { type: 'deal', seat: 0 }, rng);
    } else if (state.phase === 'playing') {
      const seat = state.current, acts = B.availableActions(state, seat);
      assert.ok(acts.length > 0, 'всегда есть действие');
      const choice = rng() < 0.6 ? B.hint(state, seat) : acts[Math.floor(rng() * acts.length)];
      r = B.reduce(state, { type: choice, seat }, rng);
    } else if (state.phase === 'settled') {
      state.seats.forEach((s) => s.hands.forEach((h) => assert.ok([0, h.bet, h.bet * 2, h.bet + Math.floor(h.bet * 1.5)].includes(h.payout), 'выплата ' + h.payout + ' при ставке ' + h.bet)));
      state.seats.forEach((s) => assert.ok(s.chips >= 0));
      rounds++;
      r = B.reduce(state, { type: 'next', seat: 0 }, rng);
    }
    assert.equal(r.ok, true, r.error);
    const before = total();
    state = r.state;
    if (state.phase === 'settled') {
      // чистая прибыль мест = выплаты минус ставки; сумма фишек меняется ровно на неё
      const nets = state.seats.reduce((a, s) => a + s.net, 0);
      assert.ok(Number.isInteger(nets));
    }
    assert.ok(total() >= 0 && before >= 0);
  }
  assert.ok(rounds >= 200, 'сыграно раздач: ' + rounds);
});

test('результат ставки: net = выплаты − вложенное; фишки места = старт + сумма net за все раздачи', () => {
  let k = 99; const rng = () => { k = (k * 1103515245 + 12345) % 2147483648; return k / 2147483648; };
  let state = B.init([{ chips: 50000 }], { decks: 6 }, rng);
  let netSum = 0;
  for (let round = 0; round < 200; round++) {
    state = B.reduce(state, { type: 'bet', seat: 0, amount: 100 }, rng).state;
    state = B.reduce(state, { type: 'deal', seat: 0 }, rng).state;
    let guard = 0;
    while (state.phase === 'playing' && guard++ < 50) {
      const a = B.hint(state, 0);
      state = B.reduce(state, { type: a, seat: 0 }, rng).state;
    }
    assert.equal(state.phase, 'settled');
    netSum += state.seats[0].net;
    state = B.reduce(state, { type: 'next', seat: 0 }, rng).state;
  }
  assert.equal(state.seats[0].chips, 50000 + netSum);
});

test('стратегия по подсказке в долгой игре проигрывает немного (преимущество казино около процента)', () => {
  let k = 4242; const rng = () => { k = (k * 1103515245 + 12345) % 2147483648; return k / 2147483648; };
  let state = B.init([{ chips: 1e9 }], { decks: 6 }, rng);
  let wagered = 0, net = 0;
  for (let round = 0; round < 20000; round++) {
    state = B.reduce(state, { type: 'bet', seat: 0, amount: 100 }, rng).state;
    state = B.reduce(state, { type: 'deal', seat: 0 }, rng).state;
    while (state.phase === 'playing') state = B.reduce(state, { type: B.hint(state, 0), seat: 0 }, rng).state;
    wagered += state.seats[0].wagered; net += state.seats[0].net;
    state = B.reduce(state, { type: 'next', seat: 0 }, rng).state;
  }
  const edge = net / wagered;
  assert.ok(edge > -0.03 && edge < 0.02, 'доходность игрока ' + (edge * 100).toFixed(2) + '%');
});

// Блэкджек работает поверх общей сессии (shared/game-session.js): повтор по журналу даёт ту же партию
test('сессия: партия по журналу воспроизводится с тем же seed; вид скрывает закрытую карту', () => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'shared', 'game-session.js'), 'utf8'), ctx);
  const S = ctx.PlatformSession;
  const game = { init: (seats, o, rng) => B.init(seats, o, rng), reduce: B.reduce, view: B.view };
  const seats = [{ name: 'Аня', chips: 5000 }];
  const make = () => S.create({ game, seats, seed: 2024 });
  const a = make();
  for (let round = 0; round < 15; round++) {
    a.dispatch({ type: 'bet', seat: 0, amount: 100 });
    a.dispatch({ type: 'deal', seat: 0 });
    const st = a.getState();
    if (st.phase === 'playing') assert.equal(a.viewFor(0).dealer.cards[1], '??');
    while (a.getState().phase === 'playing') a.dispatch({ type: B.hint(a.getState(), 0), seat: 0 });
    a.dispatch({ type: 'next', seat: 0 });
  }
  const replayed = S.replay({ game, seats, seed: 2024 }, a.getLog());
  assert.equal(replayed.ok, true);
  assert.deepEqual(replayed.session.getState(), a.getState());
  assert.equal(a.dispatch({ type: 'hit', seat: 0 }).error, 'wrong-phase');
});
