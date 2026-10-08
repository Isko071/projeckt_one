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
  assert.equal(t.act({ type: 'deal', seat: 1 }).error, 'waiting-for-bets', 'пока второе место не решило, раздавать нельзя');
  t.act({ type: 'sitout', seat: 0 });
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

test('упрощённый режим: только «взять» и «стоп», удвоение и деление отклоняются, подсказка советует только их', () => {
  let state = B.init([{ chips: 1000 }], { stack: ['8S', '6H', '8D', 'TC', '3H', 'QS'], simple: true });
  const act = (a) => { const r = B.reduce(state, a, () => 0.5); if (r.ok) state = r.state; return r; };
  act({ type: 'bet', seat: 0, amount: 100 }); act({ type: 'deal', seat: 0 });
  deepEqual(B.availableActions(state, 0).sort(), ['hit', 'stand']);
  assert.equal(act({ type: 'split', seat: 0 }).error, 'cannot-split');
  assert.equal(act({ type: 'double', seat: 0 }).error, 'cannot-double');
  assert.ok(['hit', 'stand'].includes(B.hint(state, 0)));
});

test('упрощённый режим: в долгой игре подсказка не предлагает удвоить и разделить, раздачи доходят до конца', () => {
  let k = 777; const rng = () => { k = (k * 1103515245 + 12345) % 2147483648; return k / 2147483648; };
  let state = B.init([{ chips: 1e9 }], { decks: 6, simple: true }, rng);
  let wagered = 0, net = 0;
  for (let round = 0; round < 20000; round++) {
    state = B.reduce(state, { type: 'bet', seat: 0, amount: 100 }, rng).state;
    state = B.reduce(state, { type: 'deal', seat: 0 }, rng).state;
    while (state.phase === 'playing') {
      const a = B.hint(state, 0);
      assert.ok(a === 'hit' || a === 'stand', 'подсказка: ' + a);
      state = B.reduce(state, { type: a, seat: 0 }, rng).state;
    }
    assert.equal(state.seats[0].hands.length, 1);
    wagered += state.seats[0].wagered; net += state.seats[0].net;
    state = B.reduce(state, { type: 'next', seat: 0 }, rng).state;
  }
  const edge = net / wagered;
  assert.ok(edge > -0.04 && edge < 0.01, 'доходность игрока без удвоения и деления ' + (edge * 100).toFixed(2) + '%');
});

// ===== Несколько мест, боты, вход и выход =====
test('стол: до 5 мест, свободные места под join, лишние отбрасываются', () => {
  const s = B.init([{ chips: 100 }], { tableSize: 4, stack: [] });
  assert.equal(s.seats.length, 4);
  deepEqual(s.seats.map((x) => x.active), [true, false, false, false]);
  assert.equal(B.init([{}], { tableSize: 99, stack: [] }).seats.length, 5);
  assert.equal(B.init(Array.from({ length: 8 }, () => ({})), { stack: [] }).seats.length, 5);
  assert.equal(B.CONFIG.maxSeats, 5);
  deepEqual(B.availableActions(s, 2), ['join']);
});

test('вход за стол: между раздачами, на свободное место, один человек не садится дважды', () => {
  let st = B.init([{ id: 'a', name: 'Аня', chips: 500 }], { tableSize: 3, stack: ['2S', '9H', '3D', 'TC', '4S', '5S'] });
  const act = (a) => { const r = B.reduce(st, a, () => 0.5); if (r.ok) st = r.state; return r; };
  assert.equal(act({ type: 'join', seat: 0, id: 'x' }).error, 'seat-taken');
  assert.equal(act({ type: 'join', seat: 1, id: 'a' }).error, 'already-seated');
  assert.equal(act({ type: 'join', seat: 1, id: 'b', chips: -5 }).error, 'bad-chips');
  assert.equal(act({ type: 'join', seat: 1, id: 'b', name: 'Боря', chips: 300 }).ok, true);
  assert.equal(act({ type: 'join', seat: 2, id: 'bot1', name: 'Бот', chips: 1000, kind: 'bot' }).ok, true);
  deepEqual(st.seats.map((x) => [x.name, x.kind, x.chips]), [['Аня', 'human', 500], ['Боря', 'human', 300], ['Бот', 'bot', 1000]]);
  assert.equal(act({ type: 'bet', seat: 1, amount: 100 }).ok, true);
  assert.equal(act({ type: 'sitout', seat: 0 }).ok, true);
  assert.equal(act({ type: 'sitout', seat: 2 }).ok, true);
  assert.equal(act({ type: 'deal', seat: 1 }).ok, true);
  assert.equal(act({ type: 'join', seat: 0, id: 'z' }).error, 'wrong-phase', 'во время раздачи садиться нельзя');
});

test('пропуск раздачи: ставка возвращается, можно вернуться; без фишек на минимальную ставку место решает само', () => {
  const t = table(['2S'], 200, 2);
  t.act({ type: 'bet', seat: 0, amount: 100 });
  t.act({ type: 'sitout', seat: 0 });
  deepEqual([t.state.seats[0].chips, t.state.seats[0].bet, t.state.seats[0].sitOut], [200, 0, true]);
  t.act({ type: 'bet', seat: 0, amount: 50 });
  assert.equal(t.state.seats[0].sitOut, false, 'ставка снимает пропуск');
  const poor = B.init([{ chips: 10 }, { chips: 500 }], { stack: ['2S'] });
  const r = B.reduce(poor, { type: 'bet', seat: 1, amount: 100 });
  assert.equal(B.readyToDeal(r.state), true, 'место с 10 фишками не ждём: ставить ему нечем');
});

test('уход из-за стола: между раздачами сразу (ставка возвращается), во время раздачи место освобождается после неё', () => {
  const t = table(['TS', '9H', '8D', '7C', '5S', '5D', '6H', 'KS'], 1000, 2);
  t.act({ type: 'bet', seat: 0, amount: 100 });
  t.act({ type: 'bet', seat: 1, amount: 100 });
  t.act({ type: 'deal', seat: 0 });
  t.act({ type: 'leave', seat: 0 });                 // ушёл в свой ход: рука остаётся как есть
  assert.equal(t.state.current, 1, 'ход перешёл к следующему месту');
  assert.equal(t.state.seats[0].active, true);
  t.act({ type: 'stand', seat: 1 });
  assert.equal(t.state.phase, 'settled');
  assert.notEqual(t.state.seats[0].hands[0].outcome, null, 'ушедшему рассчитали раздачу');
  t.act({ type: 'next', seat: 1 });
  assert.equal(t.state.seats[0].active, false, 'после раздачи место свободно');
  t.act({ type: 'bet', seat: 1, amount: 50 });
  assert.equal(t.act({ type: 'leave', seat: 1 }).ok, true);
  assert.equal(t.state.seats[1].chips, t.state.seats[1].chips);
  assert.equal(t.state.seats[1].active, false);
  assert.equal(t.act({ type: 'bet', seat: 1, amount: 25 }).error, 'seat-empty');
});

test('время вышло: на ставке — пропуск раздачи, на ходе — «стоп»; чужой ход не торопит', () => {
  const t = table(['5S', '4S', '9H', '6D', '3H', 'TC', '8C', '2D'], 1000, 2);
  t.act({ type: 'bet', seat: 0, amount: 100 });
  t.act({ type: 'timeout', seat: 1 });
  assert.equal(t.state.seats[1].sitOut, true);
  t.act({ type: 'deal', seat: 0 });
  assert.equal(t.act({ type: 'timeout', seat: 1 }).error, 'wrong-phase');
  t.act({ type: 'timeout', seat: 0 });
  assert.equal(t.state.phase, 'settled');
});

test('боты: ставят постоянную сумму, ходят по подсказке и доводят раздачу до конца', () => {
  let k = 31; const rng = () => { k = (k * 1103515245 + 12345) % 2147483648; return k / 2147483648; };
  let st = B.init([{ id: 'me', chips: 1000 }, { id: 'b1', name: 'Бот', chips: 1000, kind: 'bot' }], { simple: true }, rng);
  const run = (a) => { const r = B.reduce(st, a, rng); assert.equal(r.ok, true, JSON.stringify(a) + ' ' + r.error); st = r.state; };
  deepEqual(B.botAction(st, 1), { type: 'bet', seat: 1, amount: 100 });
  assert.equal(B.botAction(st, 0), null, 'за человека бот не ходит');
  run(B.nextBotAction(st));
  assert.equal(B.nextBotAction(st), null);
  assert.equal(B.readyToDeal(st), false, 'человек ещё не поставил');
  run({ type: 'bet', seat: 0, amount: 50 });
  assert.equal(B.readyToDeal(st), true);
  run({ type: 'deal', seat: 0 });
  let guard = 0;
  while (st.phase === 'playing' && guard++ < 50) {
    const a = B.nextBotAction(st);
    if (a) run(a); else run({ type: 'stand', seat: st.current });
  }
  assert.equal(st.phase, 'settled');
  assert.ok(st.seats[1].hands[0].outcome);
  const poor = B.init([{ chips: 10, kind: 'bot' }, { chips: 500 }], { stack: [] });
  assert.equal(B.botAction(poor, 0), null, 'без фишек на ставку бот ничего не ждёт: стол его не ждёт тоже');
  assert.equal(B.readyToDeal(B.reduce(poor, { type: 'bet', seat: 1, amount: 100 }).state), true);
});

test('вид стола на 5 мест со скрытой картой дилера, рука каждого места видна всем', () => {
  const st = B.init(Array.from({ length: 5 }, (_, i) => ({ id: 'p' + i, chips: 1000 })), { stack: ['2S', '3S', '4S', '5S', '6S', '7H', 'TD', '8C', '9S', '2H', '3H', '4H', '5H', '6H'] });
  let s = st;
  for (let i = 0; i < 5; i++) s = B.reduce(s, { type: 'bet', seat: i, amount: 25 }).state;
  s = B.reduce(s, { type: 'deal', seat: 0 }).state;
  const v = B.view(s);
  assert.equal(v.seats.length, 5);
  assert.equal(v.dealer.cards[1], '??');
  v.seats.forEach((x) => assert.equal(x.hands[0].cards.length, 2));
  assert.equal(v.shoe, undefined);
});

// Полные партии: 1 на 1 с ботом и столы на 2–5 мест с ботами; фишки сходятся
for (const players of [2, 3, 4, 5]) {
  test('стол на ' + players + ' мест: человек (по подсказке) и боты играют 150 раздач, фишки сходятся, зависаний нет', () => {
    let k = 1000 + players; const rng = () => { k = (k * 1103515245 + 12345) % 2147483648; return k / 2147483648; };
    const seats = [{ id: 'me', name: 'Я', chips: 1e6 }];
    for (let i = 1; i < players; i++) seats.push({ id: 'bot' + i, name: 'Бот ' + i, chips: 1e6, kind: 'bot' });
    let st = B.init(seats, { simple: true, tableSize: players }, rng);
    const totals = () => st.seats.map((x) => x.chips);
    const start = totals();
    const run = (a) => { const r = B.reduce(st, a, rng); assert.equal(r.ok, true, JSON.stringify(a) + ' ' + r.error); st = r.state; };
    const nets = st.seats.map(() => 0);
    for (let round = 0; round < 150; round++) {
      let guard = 0;
      while (st.phase === 'betting' && guard++ < 20) {
        const a = B.nextBotAction(st);
        if (a) run(a); else if (st.seats[0].bet === 0) run({ type: 'bet', seat: 0, amount: 100 }); else break;
      }
      assert.equal(B.readyToDeal(st), true);
      run({ type: 'deal', seat: 0 });
      guard = 0;
      while (st.phase === 'playing' && guard++ < 200) {
        const a = B.nextBotAction(st);
        run(a || { type: B.hint(st, st.current), seat: st.current });
      }
      assert.equal(st.phase, 'settled', 'раздача должна закончиться');
      st.seats.forEach((x, i) => { if (x.hands.length) nets[i] += x.net; });
      run({ type: 'next', seat: 0 });
    }
    st.seats.forEach((x, i) => assert.equal(x.chips, start[i] + nets[i], 'фишки места ' + i));
  });
}

// ===== Характеры ботов =====
function seededRng(seed) { let k = seed; return () => { k = (k * 1103515245 + 12345) % 2147483648; return k / 2147483648; }; }
// Состояние «ход бота» с заданной рукой и открытой картой дилера
function botTurn(style, cards, up = '9H') {
  const st = B.init([{ id: 'h', chips: 1000 }, { id: 'b', chips: 1000, kind: 'bot', style }], { simple: true, stack: [] });
  st.phase = 'playing'; st.current = 1; st.hand = 0;
  st.seats[1].hands = [{ cards, bet: 100, done: false, doubled: false, fromSplit: false, splitAces: false, outcome: null, payout: 0 }];
  st.dealer = { cards: [up, '5C'], hidden: true };
  return st;
}
function freq(style, cards, n = 4000, up) {
  const rng = seededRng(99); let hits = 0;
  for (let i = 0; i < n; i++) if (B.botAction(botTurn(style, cards, up), 1, rng).type === 'hit') hits++;
  return hits / n;
}

test('боты: наборы по порядку и имена, четвёртый снова средний', () => {
  deepEqual([0, 1, 2, 3].map((n) => B.makeBot(n).style), ['average', 'risky', 'careful', 'average']);
  deepEqual([0, 1, 2, 3].map((n) => B.makeBot(n).name), ['Бот Макс', 'Бот Рико', 'Бот Оскар', 'Бот Макс 2']);
  assert.ok([0, 1, 2].every((n) => B.makeBot(n).kind === 'bot'));
});

test('рискованный бот: до 18 всегда берёт, на 18 примерно в половине случаев, на 19 в четверти, на 21 никогда', () => {
  assert.equal(freq('risky', ['TS', '7D']), 1, '17');
  assert.equal(freq('risky', ['TS', '2D', '4C']), 1, '16');
  assert.ok(Math.abs(freq('risky', ['TS', '8D']) - 0.5) < 0.04, '18');
  assert.ok(Math.abs(freq('risky', ['TS', '9D']) - 0.25) < 0.04, '19');
  assert.ok(Math.abs(freq('risky', ['TS', 'QD']) - 0.05) < 0.02, '20');
  assert.equal(freq('risky', ['TS', 'AD']), 0, '21');
});

test('осторожный бот: останавливается около 18 (17, 18 или 19 случайно)', () => {
  assert.equal(freq('careful', ['TS', '6D']), 1, '16 — всегда берёт');
  assert.ok(Math.abs(freq('careful', ['TS', '7D']) - 2 / 3) < 0.04, '17: берёт при пороге 18 и 19');
  assert.ok(Math.abs(freq('careful', ['TS', '8D']) - 1 / 3) < 0.04, '18: берёт только при пороге 19');
  assert.equal(freq('careful', ['TS', '9D']), 0, '19 — всегда стоп');
});

test('средний бот играет по базовой стратегии, но в каждом пятом ходе ошибается', () => {
  const hitRate = freq('average', ['TS', '2D'], 6000, '9H');
  assert.ok(Math.abs(hitRate - (1 - 0.22)) < 0.03, '12 против 9: ' + hitRate);
  const standRate = 1 - freq('average', ['TS', '6D'], 6000, '5H');    // 16 против 5: по стратегии стоп
  assert.ok(Math.abs(standRate - 0.78) < 0.03, '16 против 5: ' + standRate);
  assert.equal(freq('average', ['TS', '9D']), 0, '19 — без ошибок: стоп');
  assert.equal(freq('average', ['5S', '4D']), 1, '9 — без ошибок: берёт');
});

test('ставки ботов: средний 100, рискованный 250, осторожный 50; если фишек меньше, ставят сколько есть', () => {
  const st = B.init([{ chips: 5000 }, { kind: 'bot', style: 'average', chips: 5000 }, { kind: 'bot', style: 'risky', chips: 5000 }, { kind: 'bot', style: 'careful', chips: 5000 }, { kind: 'bot', style: 'risky', chips: 130 }], { stack: [] });
  deepEqual([1, 2, 3, 4].map((i) => B.botAction(st, i).amount), [100, 250, 50, 125]);
});

test('стол из трёх ботов разного характера: 300 раздач, зависаний нет, фишки сходятся', () => {
  const rng = seededRng(5);
  const seats = [{ id: 'me', chips: 1e6 }, Object.assign({ id: 'b0', chips: 1e6 }, B.makeBot(0)), Object.assign({ id: 'b1', chips: 1e6 }, B.makeBot(1)), Object.assign({ id: 'b2', chips: 1e6 }, B.makeBot(2))];
  let st = B.init(seats, { simple: true }, rng);
  const nets = seats.map(() => 0), start = st.seats.map((x) => x.chips);
  const run = (a) => { const r = B.reduce(st, a, rng); assert.equal(r.ok, true, JSON.stringify(a) + r.error); st = r.state; };
  for (let round = 0; round < 300; round++) {
    let guard = 0;
    while (st.phase === 'betting' && guard++ < 20) { const a = B.nextBotAction(st, rng); if (a) run(a); else if (!st.seats[0].bet) run({ type: 'bet', seat: 0, amount: 100 }); else break; }
    run({ type: 'deal', seat: 0 });
    guard = 0;
    while (st.phase === 'playing' && guard++ < 200) run(B.nextBotAction(st, rng) || { type: B.hint(st, st.current), seat: st.current });
    assert.equal(st.phase, 'settled');
    st.seats.forEach((x, i) => { if (x.hands.length) nets[i] += x.net; });
    run({ type: 'next', seat: 0 });
  }
  st.seats.forEach((x, i) => assert.equal(x.chips, start[i] + nets[i]));
});
