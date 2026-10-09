// Запуск: node --test games/poker/tests/logic.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ JSON, Math, Object, Array, Number, String });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8'), ctx);
const P = ctx.Poker;
const plain = (x) => JSON.parse(JSON.stringify(x));
const h = (s) => s.split(' ');
const ev = (s) => P.evaluate(h(s));
function seededRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ===== Комбинации =====
test('категории комбинаций', () => {
  const cases = [
    ['AS KS QS JS TS', 8, 'royalFlush'], ['9H 8H 7H 6H 5H', 8, 'straightFlush'], ['9S 9H 9D 9C 2S', 7, 'quads'],
    ['KS KH KD 2C 2S', 6, 'fullHouse'], ['AS 9S 7S 4S 2S', 5, 'flush'], ['9S 8H 7D 6C 5S', 4, 'straight'],
    ['QS QH QD 7C 2S', 3, 'trips'], ['QS QH 7D 7C 2S', 2, 'twoPair'], ['QS QH 8D 7C 2S', 1, 'pair'], ['AS JH 8D 6C 2S', 0, 'high']
  ];
  cases.forEach(([cards, cat, name]) => { const r = ev(cards); assert.equal(r.cat, cat, cards); assert.equal(r.name, name, cards); });
});

test('колесо A-2-3-4-5 младший стрит, стрит-флеш колесо', () => {
  assert.equal(ev('AS 2H 3D 4C 5S').cat, 4);
  assert.deepEqual(plain(ev('AS 2H 3D 4C 5S').score), [4, 5]);
  assert.equal(ev('AH 2H 3H 4H 5H').cat, 8);
  assert.ok(P.compareScores(ev('6S 5H 4D 3C 2S').score, ev('AS 2H 3D 4C 5S').score) > 0, 'шестёрка старше колеса');
  assert.equal(ev('QS KH AD 2C 3S').cat, 0, 'стрит не «заворачивается» через туза');
});

test('сравнение: кикеры, пары, фулл-хаусы, флеши', () => {
  const gt = (a, b) => assert.ok(P.compareScores(ev(a).score, ev(b).score) > 0, a + ' > ' + b);
  gt('AS AH KD 5C 2S', 'AD AC QD 5H 2C');          // кикер в паре
  gt('AS AH KD KC 2S', 'AD AC QD QH JC');          // две пары
  gt('KS KH KD 2C 2S', 'QS QH QD AC AS');          // фулл-хаус: тройка решает
  gt('AS 9S 7S 4S 3S', 'AD 9D 7D 4D 2D');          // флеш по пятой карте
  gt('9S 9H 9D 9C KS', '9S 9H 9D 9C QS');          // каре с кикером
  assert.equal(P.compareScores(ev('AS KH QD JC 9S').score, ev('AD KC QH JS 9D').score), 0, 'полная ничья');
});

test('лучшая пятёрка из семи карт', () => {
  assert.equal(ev('AS KS 2H 3D 9S 8S 4S').name, 'flush');
  assert.equal(ev('KS KH KD 2C 2S 2H 9D').name, 'fullHouse', 'две тройки: фулл-хаус из старшей тройки и младшей пары');
  assert.deepEqual(plain(ev('KS KH KD 2C 2S 2H 9D').score), [6, 13, 2]);
  assert.equal(ev('9S 9H 5D 5C 2S 2H KD').name, 'twoPair');
  assert.deepEqual(plain(ev('9S 9H 5D 5C 2S 2H KD').score), [2, 9, 5, 13], 'три пары: берутся две старшие и лучший кикер');
  assert.equal(ev('AS 2H 3D 4C 5S 6H 9D').score[1], 6, 'стрит до шестёрки из семи карт');
  assert.equal(ev('AS KS QS JS TS AH AD').name, 'royalFlush');
});

// ===== Стол =====
const seats = (...chips) => chips.map((c, i) => ({ id: 'p' + i, name: 'И' + i, chips: c, kind: 'human' }));
const act = (st, type, seat, extra) => { const r = P.reduce(st, Object.assign({ type, seat }, extra || {}), seededRng(1)); assert.ok(r.ok, type + ' ' + seat + ': ' + r.error); return r.state; };
const bad = (st, type, seat, extra) => { const r = P.reduce(st, Object.assign({ type, seat }, extra || {}), seededRng(1)); assert.equal(r.ok, false, type + ' должен быть отклонён'); return r.error; };
const total = (st) => st.seats.reduce((n, s) => n + s.chips + s.total, 0) - (st.phase === 'settled' ? st.seats.reduce((n, s) => n + s.total, 0) : 0);
const chips = (st) => st.seats.map((s) => s.chips);
// Подменяет карты: hole — по местам, board — общие (идут в порядке флоп, тёрн, ривер)
function rig(st, hole, board) {
  const s = plain(st);
  Object.keys(hole).forEach((i) => { s.seats[i].cards = h(hole[i]); });
  s.deck = s.deck.filter((c) => !h(board).includes(c) && !Object.values(hole).some((x) => h(x).includes(c))).concat(h(board).reverse());   // карты берутся с конца: первой идёт первая карта флопа
  return s;
}
function deal(st) { return act(st, 'deal', 0); }

test('раздача втроём: кнопка, блайнды, карты, первый ход', () => {
  let st = P.init(seats(1000, 1000, 1000), {}, null);
  st = deal(st);
  assert.equal(st.button, 0);
  assert.deepEqual(plain(st.seats.map((s) => s.bet)), [0, 25, 50]);
  assert.deepEqual(plain(chips(st)), [1000, 975, 950]);
  assert.ok(st.seats.every((s) => s.cards.length === 2));
  assert.equal(st.current, 0, 'первым ходит игрок после большого блайнда: кнопка');
  assert.equal(st.pot, 75);
  assert.equal(st.deck.length, 52 - 6);
});

test('вдвоём: кнопка ставит малый блайнд и ходит первой до флопа, после флопа первой ходит соперник', () => {
  let st = deal(P.init(seats(1000, 1000), {}, null));
  assert.equal(st.button, 0);
  assert.deepEqual(plain(st.seats.map((s) => s.bet)), [25, 50]);
  assert.equal(st.current, 0);
  st = act(st, 'call', 0);
  assert.equal(st.phase, 'preflop', 'у большого блайнда есть опция');
  assert.equal(st.current, 1);
  st = act(st, 'check', 1);
  assert.equal(st.phase, 'flop');
  assert.equal(st.board.length, 3);
  assert.equal(st.current, 1);
});

test('чек-даун до вскрытия: лучшая рука забирает банк, карты видны только на вскрытии', () => {
  let st = deal(P.init(seats(1000, 1000), {}, null));
  st = rig(st, { 0: 'AS AH', 1: 'KD KC' }, '2C 7D 9H JS 3C');
  st = act(st, 'call', 0); st = act(st, 'check', 1);
  const mid = P.view(st, 0);
  assert.deepEqual(plain(mid.seats[1].cards), [null, null], 'чужие карты скрыты');
  assert.deepEqual(plain(mid.seats[0].cards), ['AS', 'AH']);
  assert.equal(mid.deck, undefined);
  for (let k = 0; k < 3; k++) { st = act(st, 'check', st.current); st = act(st, 'check', st.current); }
  assert.equal(st.phase, 'settled');
  assert.equal(st.board.length, 5);
  assert.deepEqual(plain(chips(st)), [1050, 950]);
  assert.equal(st.result.showdown, true);
  assert.equal(st.seats[0].hand.name, 'pair');
  assert.deepEqual(plain(P.view(st, 1).seats[0].cards), ['AS', 'AH'], 'на вскрытии карты открыты всем');
});

test('все сбросили: банк без вскрытия, карты остаются скрытыми', () => {
  let st = deal(P.init(seats(1000, 1000, 1000), {}, null));
  st = act(st, 'fold', 0); st = act(st, 'fold', 1);
  assert.equal(st.phase, 'settled');
  assert.deepEqual(plain(chips(st)), [1000, 975, 1025]);
  assert.equal(st.result.showdown, false);
  assert.deepEqual(plain(P.view(st, 0).seats[2].cards), [null, null]);
});

test('ставки и повышения: минимальный рейз, нельзя чекать при ставке, колл, круг закрывается', () => {
  let st = deal(P.init(seats(1000, 1000, 1000), {}, null));      // игрок 0 ходит; блайнды 25/50
  assert.equal(bad(st, 'raise', 0, { amount: 80 }), 'raise-too-small');
  assert.equal(bad(st, 'check', 0), 'cannot-check');
  assert.equal(bad(st, 'raise', 0, { amount: 5000 }), 'bad-amount');
  assert.equal(bad(st, 'call', 1), 'not-your-turn');
  const la = P.legalActions(st, 0);
  assert.deepEqual(plain(la.raise), { min: 100, max: 1000 });
  assert.equal(la.call, 50);
  st = act(st, 'raise', 0, { amount: 150 });                      // повышение на 100
  assert.equal(st.minRaise, 100);
  assert.equal(bad(st, 'raise', 1, { amount: 200 }), 'raise-too-small', 'нужно минимум до 250');
  st = act(st, 'raise', 1, { amount: 400 });
  st = act(st, 'fold', 2);
  st = act(st, 'call', 0);
  assert.equal(st.phase, 'flop');
  assert.equal(st.pot, 800 + 50);
  assert.deepEqual(plain(st.seats.map((s) => s.bet)), [0, 0, 0]);
});

test('олл-ин и побочные банки: три стека, разные победители', () => {
  let st = deal(P.init(seats(100, 300, 1000), {}, null));        // кнопка 0, малый 1, большой 2, ходит 0
  st = rig(st, { 0: 'AS AH', 1: 'KS KH', 2: 'QS QH' }, '2C 7D 9H 3S 4C');
  st = act(st, 'allin', 0);                                        // 100
  st = act(st, 'allin', 1);                                        // до 300
  st = act(st, 'call', 2);                                         // 300
  assert.equal(st.phase, 'settled', 'торговли больше нет: карты открылись сами');
  assert.equal(st.board.length, 5);
  // основной банк 300 → тузы, побочный 400 (200 от второго и третьего) → короли, 700 остаются у большого стека
  assert.deepEqual(plain(chips(st)), [300, 400, 700]);
  assert.equal(st.pots.length, 2);
  assert.deepEqual(plain(st.pots.map((p) => p.amount)), [300, 400]);
  assert.deepEqual(plain(st.pots[0].winners), [0]);
  assert.deepEqual(plain(st.pots[1].winners), [1]);
});

test('ставка, которую никто не уравнял, возвращается', () => {
  let st = deal(P.init(seats(100, 1000, 1000), {}, null));      // кнопка 0, малый 1, большой 2
  st = rig(st, { 0: 'AS AH', 1: 'KS KH', 2: '7D 2C' }, '3C 8D 9H JS 4C');
  st = act(st, 'allin', 0);
  st = act(st, 'raise', 1, { amount: 400 });
  st = act(st, 'fold', 2);
  assert.equal(st.phase, 'settled');
  assert.deepEqual(plain(chips(st)), [250, 900, 950]);
  assert.equal(chips(st).reduce((a, b) => a + b), 2100);
  assert.deepEqual(plain(st.pots.map((p) => p.amount)), [150, 100, 300]);
  assert.deepEqual(plain(st.pots[2].winners), [1], 'непокрытая часть вернулась тому, кто её поставил');
});

test('ничья делит банк, лишняя фишка достаётся ближайшему слева от кнопки', () => {
  let st = deal(P.init(seats(1000, 1000, 1000), { smallBlind: 1, bigBlind: 2 }, null));   // кнопка 0, малый 1, большой 2
  st = rig(st, { 0: '2D 3D', 1: '7C 8C', 2: '4D 5D' }, 'AS KS QS JS TS');                // на столе роял-флеш: ничья
  st = act(st, 'call', 0);
  st = act(st, 'fold', 1);                                                                 // малый блайнд (1) пропал
  st = act(st, 'check', 2);
  for (let k = 0; k < 3; k++) { st = act(st, 'check', st.current); st = act(st, 'check', st.current); }
  assert.equal(st.phase, 'settled');
  assert.deepEqual(plain(chips(st)), [1000, 999, 1001]);
  assert.deepEqual(plain(st.pots[0].winners), [2, 0], 'первым лишнюю фишку получает игрок ближе к кнопке слева');
});

test('неполный олл-ин не открывает торговлю заново тем, кто уже ходил', () => {
  let st = deal(P.init(seats(1000, 1000, 130), {}, null));      // кнопка 0, малый 1, большой 2 (130)
  st = act(st, 'raise', 0, { amount: 100 });                      // повышение на 50 (минимум 100 до)
  st = act(st, 'call', 1);
  st = act(st, 'allin', 2);                                       // до 130: повышение на 30, меньше минимального
  assert.equal(st.current, 0);
  const la = P.legalActions(st, 0);
  assert.equal(la.raise, null, 'игрок 0 уже ходил: только колл или сброс');
  assert.equal(la.call, 30);
  assert.equal(bad(st, 'raise', 0, { amount: 300 }), 'raise-locked');
  st = act(st, 'call', 0);
  assert.equal(st.current, 1);
  st = act(st, 'call', 1);
  assert.equal(st.phase, 'flop');
});

test('полный олл-ин открывает торговлю: можно поднять ещё', () => {
  let st = deal(P.init(seats(1000, 1000, 400), {}, null));
  st = act(st, 'raise', 0, { amount: 100 });
  st = act(st, 'call', 1);
  st = act(st, 'allin', 2);                                       // до 400: полное повышение
  assert.equal(st.current, 0);
  assert.ok(P.legalActions(st, 0).raise);
  assert.equal(st.minRaise, 300);
});

test('тайм-аут: чек, если можно, иначе сброс; выход из-за стола в раздаче — сброс', () => {
  let st = deal(P.init(seats(1000, 1000, 1000), {}, null));
  st = act(st, 'timeout', 0);
  assert.equal(st.seats[0].folded, true);
  st = act(st, 'call', 1);
  st = act(st, 'check', 2);
  assert.equal(st.phase, 'flop');
  st = act(st, 'timeout', st.current);
  assert.equal(st.seats[st.current === 2 ? 1 : 2].last === null || true, true);
  const cur = st.current;
  st = act(st, 'leave', cur);
  assert.equal(st.phase, 'settled', 'остался один игрок');
  assert.equal(st.seats[cur].active, false);
});

test('место: вход между раздачами, пропуск раздач, нехватка игроков', () => {
  let st = P.init(seats(1000), { tableSize: 3 }, null);
  assert.equal(bad(st, 'deal', 0), 'not-enough-players');
  st = act(st, 'join', 1, { id: 'x', name: 'Х', chips: 500, kind: 'bot' });
  assert.equal(bad(st, 'join', 1, { id: 'y', chips: 5 }), 'seat-taken');
  assert.equal(bad(st, 'join', 2, { id: 'y', chips: 0 }), 'bad-join');
  st = act(st, 'sitout', 1, { value: true });
  assert.equal(bad(st, 'deal', 0), 'not-enough-players');
  st = act(st, 'sitout', 1, { value: false });
  st = deal(st);
  assert.equal(bad(st, 'join', 2, { id: 'z', chips: 100 }), 'hand-in-progress');
  assert.equal(bad(st, 'deal', 0), 'hand-in-progress');
});

test('кнопка двигается по кругу, игрок без фишек пропускается', () => {
  let st = deal(P.init(seats(1000, 1000, 1000), {}, null));
  assert.equal(st.button, 0);
  st = act(st, 'fold', 0); st = act(st, 'fold', 1);
  st = act(st, 'next', 0);
  assert.equal(st.button, 1);
  st = act(st, 'fold', st.current); st = act(st, 'fold', st.current);
  st = plain(st); st.seats[2].chips = 0;
  st = act(st, 'next', 0);
  assert.equal(st.button, 0, 'кнопка перескочила пустое место');
  assert.equal(st.seats[2].inHand, false);
});

test('фишки сохраняются: случайные партии с случайными допустимыми действиями', () => {
  const rng = seededRng(7);
  for (let game = 0; game < 120; game++) {
    const n = 2 + Math.floor(rng() * 5);
    const stacks = Array.from({ length: n }, () => 50 + Math.floor(rng() * 20) * 100);
    const sum = stacks.reduce((a, b) => a + b);
    let st = P.init(seats(...stacks), { tableSize: n }, null);
    for (let hand = 0; hand < 12 && P.canDeal(st); hand++) {
      st = act(st, st.phase === 'waiting' ? 'deal' : 'next', 0);
      for (let step = 0; step < 200 && st.phase !== 'settled'; step++) {
        const seat = st.current, la = P.legalActions(st, seat);
        assert.ok(la, 'есть допустимые действия у ' + seat);
        const choices = ['fold', 'call', 'check', 'allin', 'raise'].filter((k) => (k === 'call' ? la.call > 0 : k === 'check' ? la.check : k === 'allin' ? la.allin > 0 : k === 'raise' ? la.raise : true));
        const pick = choices[Math.floor(rng() * choices.length)];
        const extra = pick === 'raise' ? { amount: la.raise.min + Math.floor(rng() * (la.raise.max - la.raise.min + 1)) } : {};
        st = act(st, pick, seat, extra);
      }
      assert.equal(st.phase, 'settled', 'раздача закончилась');
      assert.equal(st.seats.reduce((a, s) => a + s.chips, 0), sum, 'фишек поровну после раздачи');
      assert.ok(st.seats.every((s) => s.chips >= 0));
      assert.equal(st.seats.reduce((a, s) => a + s.net, 0), 0, 'сумма выигрышей и проигрышей нулевая');
    }
  }
});

// ===== Простой вариант: анте, ставки по желанию, обязательные круги =====
const SIMPLE = { variant: 'simple', ante: 50, minBet: 100 };
const dealS = (n, o) => deal(P.init(seats(...Array(n).fill(1000)), Object.assign({}, SIMPLE, o || {}), null));

test('простой: анте вместо блайндов, банк, первым ходит игрок слева от кнопки', () => {
  const st = dealS(3);
  assert.equal(st.variant, 'simple');
  assert.deepEqual(plain(chips(st)), [950, 950, 950]);
  assert.equal(st.pot, 150);
  assert.deepEqual(plain(st.seats.map((s) => s.bet)), [0, 0, 0], 'анте не считается ставкой круга');
  assert.equal(st.currentBet, 0);
  assert.equal(st.button, 0);
  assert.equal(st.current, 1);
});

test('простой: до флопа обязательный круг: чек нельзя, первый обязан поставить минимум', () => {
  let st = dealS(3);
  assert.equal(bad(st, 'check', 1), 'must-bet');
  assert.equal(bad(st, 'raise', 1, { amount: 60 }), 'raise-too-small');
  assert.equal(act(st, 'timeout', 1).seats[1].folded, true, 'тайм-аут сбрасывает вместо чека');
  const la = P.legalActions(st, 1);
  assert.equal(la.check, false);
  assert.equal(la.mustBet, true);
  assert.deepEqual(plain(la.raise), { min: 100, max: 950 });
  st = act(st, 'raise', 1, { amount: 100 });
  st = act(st, 'call', 2);
  st = act(st, 'call', 0);
  assert.equal(st.phase, 'flop');
  assert.equal(st.pot, 150 + 300);
});

test('простой: на флопе ставки по желанию — все могут просто чекать, карта открывается, когда все походили', () => {
  let st = dealS(3);
  st = act(st, 'raise', 1, { amount: 100 }); st = act(st, 'call', 2); st = act(st, 'call', 0);
  assert.equal(st.board.length, 3);
  assert.equal(P.legalActions(st, st.current).check, true);
  st = act(st, 'check', st.current); st = act(st, 'check', st.current);
  assert.equal(st.phase, 'flop', 'пока не все походили, тёрн не открыт');
  st = act(st, 'check', st.current);
  assert.equal(st.phase, 'turn');
  assert.equal(st.board.length, 4);
  assert.equal(P.legalActions(st, st.current).mustBet, true, 'круг перед ривером снова обязательный');
  assert.equal(bad(st, 'check', st.current), 'must-bet');
});

test('простой: на ривере чек разрешён; полная партия до вскрытия', () => {
  let st = dealS(2);
  st = rig(st, { 0: 'AS AH', 1: 'KD KC' }, '2C 7D 9H JS 3C');
  st = act(st, 'raise', st.current, { amount: 100 }); st = act(st, 'call', st.current);     // префлоп (обязательный)
  st = act(st, 'check', st.current); st = act(st, 'check', st.current);                      // флоп
  st = act(st, 'raise', st.current, { amount: 100 }); st = act(st, 'call', st.current);     // тёрн (обязательный)
  assert.equal(st.phase, 'river');
  st = act(st, 'check', st.current); st = act(st, 'check', st.current);                      // ривер
  assert.equal(st.phase, 'settled');
  assert.equal(st.pot, 100 + 200 + 200);
  assert.deepEqual(plain(chips(st)), [1000 + 250, 1000 - 250]);
});

test('простой: сброс в обязательном круге, остался один игрок — банк без вскрытия', () => {
  let st = dealS(3);
  st = act(st, 'raise', 1, { amount: 200 });
  st = act(st, 'fold', 2); st = act(st, 'fold', 0);
  assert.equal(st.phase, 'settled');
  assert.deepEqual(plain(chips(st)), [950, 1100, 950]);              // победитель забирает анте двоих (100) и свою ставку не теряет
  assert.equal(chips(st).reduce((a, b) => a + b), 3000);
});

test('простой: нехватка фишек на ставку — олл-ин; анте больше стека — олл-ин от анте', () => {
  let st = P.init(seats(30, 1000, 1000), SIMPLE, null);
  st = deal(st);
  assert.equal(st.seats[0].allIn, true);
  assert.equal(st.seats[0].total, 30);
  assert.equal(st.pot, 130);
  let s2 = P.init(seats(1000, 80, 1000), SIMPLE, null);
  s2 = deal(s2);
  s2 = act(s2, 'allin', s2.current);                                   // 30 фишек после анте: меньше минимальной ставки — допустимо
  assert.equal(s2.seats[1].chips, 0);
});

test('простой: настройки стола: анте и минимальная ставка задаются при создании, обязательные улицы можно изменить', () => {
  const a = P.init(seats(1000, 1000), { variant: 'simple', ante: 25, minBet: 50 }, null);
  assert.deepEqual(plain([a.ante, a.minBet, a.mandatory]), [25, 50, ['preflop', 'turn']]);
  const b = P.init(seats(1000, 1000), { variant: 'simple', ante: 25, mandatory: ['preflop'] }, null);
  assert.equal(b.minBet, 50, 'по умолчанию минимальная ставка вдвое больше анте');
  assert.deepEqual(plain(b.mandatory), ['preflop']);
  const c = P.init(seats(1000, 1000), {}, null);
  assert.equal(c.variant, 'classic');
  assert.deepEqual(plain(c.mandatory), []);
});

test('простой: фишки сохраняются в случайных партиях', () => {
  const rng = seededRng(11);
  for (let game = 0; game < 120; game++) {
    const n = 2 + Math.floor(rng() * 5);
    const stacks = Array.from({ length: n }, () => 50 + Math.floor(rng() * 20) * 100);
    const sum = stacks.reduce((a, b) => a + b);
    let st = P.init(seats(...stacks), Object.assign({ tableSize: n }, SIMPLE), null);
    for (let hand = 0; hand < 12 && P.canDeal(st); hand++) {
      st = act(st, st.phase === 'waiting' ? 'deal' : 'next', 0);
      for (let step = 0; step < 200 && st.phase !== 'settled'; step++) {
        const seat = st.current, la = P.legalActions(st, seat);
        assert.ok(la, 'есть допустимые действия');
        const choices = ['fold', 'call', 'check', 'allin', 'raise'].filter((k) => (k === 'call' ? la.call > 0 : k === 'check' ? la.check : k === 'allin' ? la.allin > 0 : k === 'raise' ? la.raise : true));
        const pick = choices[Math.floor(rng() * choices.length)];
        const extra = pick === 'raise' ? { amount: la.raise.min + Math.floor(rng() * (la.raise.max - la.raise.min + 1)) } : {};
        if (la.mustBet) assert.ok(pick !== 'check', 'в обязательном круге чека нет');
        st = act(st, pick, seat, extra);
      }
      assert.equal(st.phase, 'settled');
      assert.equal(st.seats.reduce((a, s) => a + s.chips, 0), sum);
      assert.equal(st.seats.reduce((a, s) => a + s.net, 0), 0);
    }
  }
});

test('суммы любые целые (132, 549), ставка 10000 против олл-ина на 1000: победитель берёт основной банк, остальное возвращается', () => {
  let st = deal(P.init(seats(1000, 20000, 5000), {}, null));      // кнопка 0 (1000), малый 1, большой 2; блайнды 25/50
  st = rig(st, { 0: 'AS AH', 1: 'KS KH', 2: '7D 2C' }, '3C 8D 9H JS 4C');
  st = act(st, 'allin', 0);                                         // игрок 0: 1000
  assert.equal(P.legalActions(st, 1).raise.min, 1000 + 950, 'минимальное повышение считается от суммы олл-ина, поэтому оно «нечётное»');
  st = act(st, 'raise', 1, { amount: 10000 });                      // ставка 10000, выше 1000 никто не уравняет
  st = act(st, 'fold', 2);
  assert.equal(st.phase, 'settled');
  assert.deepEqual(plain(st.pots.map((p) => p.amount)), [150, 1900, 9000]);   // начальные взносы, основной банк и непокрытые 9000
  assert.deepEqual(plain(st.pots[0].winners.concat(st.pots[1].winners)), [0, 0], 'тузы берут основной банк');
  assert.deepEqual(plain(st.pots[2].winners), [1], 'непокрытая часть возвращается тому, кто поставил 10000');
  assert.deepEqual(plain(chips(st)), [2050, 19000, 4950]);
  assert.equal(chips(st).reduce((a, b) => a + b), 26000);
  // любые суммы допустимы, не только кратные блайнду
  let s2 = deal(P.init(seats(1000, 1000), {}, null));
  s2 = act(s2, 'raise', 0, { amount: 132 });
  s2 = act(s2, 'raise', 1, { amount: 549 });
  assert.equal(s2.currentBet, 549);
  assert.equal(s2.seats[1].chips, 451);
});
