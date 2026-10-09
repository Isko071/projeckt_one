// Запуск: node --test games/poker/tests/bots.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ JSON, Math, Object, Array, Number, String });
['logic.js', 'bots.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx));
const P = ctx.Poker, B = ctx.PokerBots;
const plain = (x) => JSON.parse(JSON.stringify(x));
const h = (s) => s.split(' ');
function seededRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const act = (st, a, rng) => { const r = P.reduce(st, a, rng || seededRng(1)); assert.ok(r.ok, JSON.stringify(a) + ': ' + r.error); return r.state; };

// Стол из ботов заданных характеров и стеков
function table(styles, stacks, opts) {
  const seats = styles.map((style, i) => Object.assign(B.makeBot(i + 1), { style, chips: stacks[i] }));
  return act(P.init(seats, Object.assign({}, opts), null), { type: 'deal', seat: 0 }, seededRng(5));
}
// Подменяет карты у места и общие карты, делая нужный ход текущим
function setup(st, hole, board, phase) {
  const s = plain(st);
  Object.keys(hole).forEach((i) => { s.seats[i].cards = h(hole[i]); });
  s.board = h(board || '');
  if (phase) s.phase = phase;
  return s;
}

test('характеры и имена ботов: как в блэкджеке, по кругу', () => {
  assert.deepEqual(plain([1, 2, 3, 4].map((n) => B.makeBot(n).style)), ['average', 'risky', 'careful', 'average']);
  assert.equal(B.makeBot(2).name, 'Бот Рико');
  assert.equal(B.makeBot(1).kind, 'bot');
});

test('оценка шанса: тузы сильны, семёрка-двойка слаба, на столе уже есть комбинация', () => {
  const rng = seededRng(3);
  const aa = B.equity(h('AS AH'), [], 1, rng, 400), weak = B.equity(h('7D 2C'), [], 1, rng, 400);
  assert.ok(aa > 0.78 && aa < 0.92, 'AA против одного: ' + aa);
  assert.ok(weak > 0.28 && weak < 0.42, '72 против одного: ' + weak);
  assert.ok(B.equity(h('AS AH'), [], 5, rng, 300) < aa, 'против пятерых шансов меньше');
  const nuts = B.equity(h('AS KS'), h('QS JS TS 2D 3C'), 3, rng, 200);
  assert.equal(nuts, 1, 'роял-флеш на столе не проиграть');
});

test('бот всегда делает допустимое действие: боты друг против друга, оба варианта игры, фишки сохраняются', () => {
  const variants = [{}, { variant: 'simple', ante: 50, minBet: 100 }];
  variants.forEach((opts, v) => {
    for (let game = 0; game < 25; game++) {
      const rng = seededRng(100 + game + v * 1000);
      const n = 2 + Math.floor(rng() * 5), styles = Array.from({ length: n }, (_, i) => B.ORDER[i % 3]);
      const stacks = Array.from({ length: n }, () => 300 + Math.floor(rng() * 30) * 100);
      const sum = stacks.reduce((a, b) => a + b);
      let st = P.init(styles.map((style, i) => Object.assign(B.makeBot(i + 1), { style, chips: stacks[i] })), Object.assign({ tableSize: n }, opts), null);
      for (let hand = 0; hand < 6 && P.canDeal(st); hand++) {
        st = act(st, { type: 'deal', seat: 0 }, rng);
        for (let step = 0; step < 300 && st.phase !== 'settled'; step++) {
          const a = B.nextBotAction(st, rng);
          assert.ok(a, 'бот ходит');
          st = act(st, a, rng);
        }
        assert.equal(st.phase, 'settled');
        assert.equal(st.seats.reduce((x, s) => x + s.chips, 0), sum);
      }
    }
  });
});

test('в обязательном круге бот не чекает: сильная рука ставит, мусор сбрасывает', () => {
  const base = table(['careful', 'careful'], [2000, 2000], { variant: 'simple', ante: 50, minBet: 100 });
  const seat = base.current;
  let strong = setup(base, { [seat]: 'AS AH' }), a = B.botAction(strong, seat, seededRng(2));
  assert.ok(['raise', 'allin'].includes(a.type), 'тузы ставят: ' + a.type);
  assert.ok(P.reduce(strong, a, seededRng(1)).ok);
  const trash = setup(base, { [seat]: '7D 2C' });
  const folds = Array.from({ length: 30 }, (_, k) => B.botAction(trash, seat, seededRng(k)).type);
  assert.ok(folds.filter((t) => t === 'fold').length >= 25, 'мусор почти всегда сбрасывается');
  assert.ok(folds.every((t) => t !== 'check'), 'чекать нельзя');
});

test('без обязательного круга слабая рука чекает, сильная ставит', () => {
  const base = table(['average', 'average'], [2000, 2000], { variant: 'simple', ante: 50, minBet: 100 });
  let st = act(base, { type: 'raise', seat: base.current, amount: 100 }, seededRng(1));
  st = act(st, { type: 'call', seat: st.current }, seededRng(1));        // флоп: чек разрешён
  assert.equal(st.phase, 'flop');
  const seat = st.current;
  const weak = setup(st, { [seat]: '7D 2C' }, '9S KH AD');
  const types = Array.from({ length: 30 }, (_, k) => B.botAction(weak, seat, seededRng(k)).type);
  assert.ok(types.filter((t) => t === 'check').length >= 20, 'слабая рука в основном чекает');
  const strong = setup(st, { [seat]: 'AS AH' }, 'AD KH 2C');
  assert.ok(['raise', 'allin'].includes(B.botAction(strong, seat, seededRng(4)).type), 'сет тузов ставит');
});

test('на ставку бот: сильную руку повышает, дорогую ставку с мусором сбрасывает; осторожный сбрасывает чаще агрессивного', () => {
  const seatsFor = (style) => table([style, 'average'], [3000, 3000]);
  let base = seatsFor('careful');
  const first = base.current;                                           // кнопка (малый блайнд), ему доплатить 25
  let st = setup(base, { [first]: 'AS AH' });
  assert.ok(['raise', 'allin'].includes(B.botAction(st, first, seededRng(9)).type), 'тузы против блайнда повышают');
  const medium = { careful: 0, risky: 0 };
  ['careful', 'risky'].forEach((style) => {
    let t = table([style, 'average'], [3000, 3000]);
    let s2 = plain(t); s2.currentBet = 400; s2.seats[t.current].bet = 25; s2.seats[t.current].chips -= 0; s2.pot = 600;
    s2.seats[t.current].cards = h('QD 8H');                            // средняя рука против большой ставки
    for (let k = 0; k < 60; k++) if (B.botAction(s2, t.current, seededRng(k + 1)).type === 'fold') medium[style]++;
  });
  assert.ok(medium.careful > medium.risky, 'осторожный сбрасывает чаще агрессивного: ' + JSON.stringify(medium));
});

test('nextBotAction: только когда ходит бот', () => {
  const seats = [B.makeBot(1), { id: 'h', name: 'Игрок', kind: 'human' }].map((s) => Object.assign({ chips: 1000 }, s));
  let st = act(P.init(seats, {}, null), { type: 'deal', seat: 0 }, seededRng(2));
  const bot = st.seats.findIndex((s) => s.kind === 'bot');
  assert.equal(B.nextBotAction(st, seededRng(1)) !== null, st.current === bot);
  const human = plain(st); human.current = human.seats.findIndex((s) => s.kind === 'human');
  assert.equal(B.nextBotAction(human, seededRng(1)), null);
  assert.equal(B.nextBotAction({ current: -1, seats: [] }, seededRng(1)), null);
});
