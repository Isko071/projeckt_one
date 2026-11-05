// Запуск: node --test games/durak/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ JSON, Math, Object, Array, Number, String, Error });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8'), ctx);
const D = ctx.Durak, B = ctx.DurakBot;
const plain = (x) => JSON.parse(JSON.stringify(x));
function rngOf(seed) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }
// Готовая позиция: руки, козырь, колода; ходит attacker
function pos(o) {
  const n = o.hands.length;
  const st = D.init(o.hands.map((h, i) => ({ id: 'p' + i, name: 'P' + i })), { mode: o.mode || 'podkidnoy' }, rngOf(1));
  st.seats.forEach((s, i) => { s.hand = o.hands[i].slice(); });
  st.trump = o.trump || 'H'; st.trumpCard = '6' + st.trump; st.deck = (o.deck || []).slice(); st.discard = 36 - st.deck.length - o.hands.reduce((a, h) => a + h.length, 0);
  st.attacker = o.attacker || 0; st.defender = D.nextAlive(st, st.attacker); st.actor = st.attacker; st.phase = 'attack'; st.table = [];
  st.limit = Math.min(6, st.seats[st.defender].hand.length);
  return plain(st);
}
const act = (st, a) => { const r = D.reduce(st, Object.assign({ seat: st.actor }, a)); assert.ok(r.ok, JSON.stringify(a) + ' → ' + r.error); return plain(r.state); };
const cardsTotal = (st) => st.seats.reduce((a, s) => a + s.hand.length, 0) + st.deck.length + st.discard + st.table.reduce((a, p) => a + (p.d ? 2 : 1), 0);

test('раздача: 36 карт, по 6 на руки, козырь — последняя карта колоды, первым ходит младший козырь', () => {
  for (let seed = 1; seed < 30; seed++) {
    const st = D.init([{ id: 'a' }, { id: 'b' }, { id: 'c' }], {}, rngOf(seed));
    assert.equal(cardsTotal(st), 36);
    st.seats.forEach((s) => assert.equal(s.hand.length, 6));
    assert.equal(st.deck[st.deck.length - 1], st.trumpCard);
    assert.equal(D.suit(st.trumpCard), st.trump);
    const lows = st.seats.map((s) => Math.min(99, ...s.hand.filter((c) => D.suit(c) === st.trump).map(D.rank)));
    if (Math.min(...lows) < 99) assert.equal(st.attacker, lows.indexOf(Math.min(...lows)));
    assert.equal(st.defender, (st.attacker + 1) % 3);
  }
});

test('какая карта бьёт: старшая той же масти, козырь бьёт некозырь, козырь — только старшим козырем', () => {
  assert.ok(D.beats('TS', '9S', 'H')); assert.ok(!D.beats('8S', '9S', 'H')); assert.ok(!D.beats('AC', '9S', 'H'));
  assert.ok(D.beats('6H', 'AS', 'H')); assert.ok(D.beats('7H', '6H', 'H')); assert.ok(!D.beats('6H', '7H', 'H')); assert.ok(!D.beats('AS', '6H', 'H'));
});

test('заход: ход, отбой, подкидывание только того же достоинства, «бито», добор и смена ходящего', () => {
  let st = pos({ hands: [['7S', '7C', 'KD', 'AS', '9C', '8D'], ['8S', '9S', 'JC', 'QD', '6H', '6C']], deck: ['TD', 'TC', 'JD', 'JS', '6S'] });
  assert.equal(D.legal(st).pass, false, 'первую карту класть обязательно');
  st = act(st, { type: 'attack', card: '7S' });
  assert.equal(st.phase, 'defend'); assert.equal(st.actor, 1);
  assert.ok(D.legal(st).defend.some((d) => d.card === '8S'));
  assert.ok(!D.legal(st).defend.some((d) => d.card === 'JC'), 'другая масть не кроет');
  st = act(st, { type: 'defend', card: '8S', target: 0 });
  assert.equal(st.phase, 'throw'); assert.equal(st.actor, 0);
  assert.deepEqual(plain(D.legal(st).attack).sort(), ['7C', '8D'], 'подкинуть можно только семёрки и восьмёрки');
  assert.equal(D.reduce(st, { seat: 0, type: 'attack', card: 'KD' }).ok, false);
  st = act(st, { type: 'attack', card: '7C' });
  st = act(st, { type: 'defend', card: 'JC', target: 1 });
  const discard0 = st.discard;
  st = act(st, { type: 'pass' });
  assert.equal(st.table.length, 0, 'бито'); assert.equal(st.discard, discard0 + 4, 'четыре карты ушли в отбой');
  assert.equal(st.attacker, 1, 'отбился — ходит он'); assert.equal(st.defender, 0);
  assert.equal(st.seats[0].hand.length, 6, 'ходивший добирает первым'); assert.equal(st.seats[1].hand.length, 6); assert.equal(st.deck.length, 1);
  assert.equal(cardsTotal(st), 36);
});

test('забрал: подкидывают ещё, отбивающийся берёт всё, ходит следующий за ним', () => {
  let st = pos({ hands: [['7S', '7C', '7D', 'AS'], ['8C', '9D'], ['KS', '7H', 'QC']], deck: [] });
  st = act(st, { type: 'attack', card: '7S' });
  assert.equal(D.legal(st).defend.length, 0); assert.equal(D.legal(st).take, true);
  st = act(st, { type: 'take' });
  assert.ok(st.taking); assert.equal(st.actor, 0);
  st = act(st, { type: 'attack', card: '7C' });
  // больше двух карт нельзя (у отбивающегося было 2): третий игрок подкинул бы семёрку, но лимит исчерпан — стол сразу уходит отбивающемуся
  assert.equal(st.table.length, 0);
  assert.deepEqual(plain(st.seats[1].hand).sort(), ['7C', '7S', '8C', '9D']);
  assert.equal(st.attacker, 2, 'ходит следующий за забравшим'); assert.equal(st.defender, 0);
});

test('переводной: перевод картой того же достоинства, пока ничего не побито; в подкидном перевода нет', () => {
  const hands = [['7S', 'AS', 'KD'], ['7C', 'QD', '8S'], ['9H', 'TH', 'JH', 'QH']];
  let st = pos({ hands, mode: 'perevodnoy', deck: ['6D'] });
  st = act(st, { type: 'attack', card: '7S' });
  assert.deepEqual(plain(D.legal(st).transfer), ['7C']);
  st = act(st, { type: 'transfer', card: '7C' });
  assert.equal(st.attacker, 1); assert.equal(st.defender, 2); assert.equal(st.actor, 2);
  assert.equal(st.table.length, 2);
  let p = pos({ hands, mode: 'podkidnoy', deck: ['6D'] });
  p = act(p, { type: 'attack', card: '7S' });
  assert.equal(D.legal(p).transfer.length, 0);
  // побил одну — переводить уже нельзя
  let q = pos({ hands: [['7S', '7D'], ['8S', '7C', '9D'], ['KH']], mode: 'perevodnoy', deck: ['6D'] });
  q = act(q, { type: 'attack', card: '7S' }); q = act(q, { type: 'defend', card: '8S', target: 0 }); q = act(q, { type: 'attack', card: '7D' });
  assert.equal(D.legal(q).transfer.length, 0);
});

test('конец: кто остался с картами при пустой колоде — дурак; выход из-за стола — тоже дурак', () => {
  let st = pos({ hands: [['7S'], ['8S', '6C']], deck: [] });
  st = act(st, { type: 'attack', card: '7S' });
  st = act(st, { type: 'defend', card: '8S', target: 0 });
  // ходивший вышел без карт, подкидывать некому — бито; у второго осталась карта, он дурак
  assert.ok(st.gameOver); assert.equal(st.reason, 'finished'); assert.equal(st.loser, 1);
  let d = pos({ hands: [['7S'], ['8S']], deck: [] });
  d = act(d, { type: 'attack', card: '7S' }); d = act(d, { type: 'defend', card: '8S', target: 0 });
  assert.ok(d.gameOver); assert.equal(d.loser, -1, 'вышли оба — ничья');
  const r = D.reduce(pos({ hands: [['7S'], ['8S'], ['9S']], deck: [] }), { seat: 2, type: 'leave' });
  assert.ok(r.state.gameOver); assert.equal(r.state.loser, 2); assert.equal(r.state.reason, 'left');
});

test('чужие карты и колода не видны: в виде стола только число карт, свои — отдельно каждому', () => {
  const st = D.init([{ id: 'a' }, { id: 'b' }], {}, rngOf(5));
  const v = D.view(st);
  assert.equal(v.deck, undefined); assert.equal(v.deckCount, 24);
  v.seats.forEach((s) => { assert.equal(s.hand, undefined); assert.equal(s.count, 6); });
  const sec = D.secrets(st);
  assert.deepEqual(plain(sec.a), plain(st.seats[0].hand));
  assert.equal(JSON.stringify(v).indexOf(st.seats[1].hand[0] + '"') >= 0 && st.seats[1].hand[0] !== st.trumpCard ? 'leak' : 'ok', 'ok');
});

test('чужой ход и неверные действия отклоняются', () => {
  const st = pos({ hands: [['7S', '8S'], ['9S', 'TS']], deck: ['6D'] });
  assert.equal(D.reduce(st, { seat: 1, type: 'attack', card: '9S' }).ok, false);
  assert.equal(D.reduce(st, { seat: 0, type: 'attack', card: 'AS' }).ok, false, 'карты нет на руке');
  assert.equal(D.reduce(st, { seat: 0, type: 'pass' }).ok, false);
  assert.equal(D.reduce(st, { seat: 0, type: 'take' }).ok, false);
  assert.equal(D.reduce(st, { seat: 5, type: 'attack', card: '7S' }).ok, false);
});

test('много случайных партий на 2–4 игрока: карты не теряются, партия всегда заканчивается', () => {
  const rng = rngOf(42);
  for (let g = 0; g < 300; g++) {
    const n = 2 + (g % 3);
    let st = D.init(Array.from({ length: n }, (_, i) => ({ id: 'p' + i })), { mode: g % 2 ? 'perevodnoy' : 'podkidnoy' }, rng), k = 0;
    while (!st.gameOver && k++ < 3000) {
      const L = D.legal(st), opts = [];
      L.attack.forEach((c) => opts.push({ type: 'attack', card: c })); L.defend.forEach((d) => opts.push({ type: 'defend', card: d.card, target: d.target }));
      L.transfer.forEach((c) => opts.push({ type: 'transfer', card: c })); if (L.pass) opts.push({ type: 'pass' }); if (L.take && (!opts.length || rng() < 0.2)) opts.push({ type: 'take' });
      st = act(st, opts[Math.floor(rng() * opts.length)]);
      assert.equal(cardsTotal(st), 36);
    }
    assert.ok(st.gameOver);
  }
});

test('боты: ходят только по правилам на всех уровнях, сложный обыгрывает лёгкого', () => {
  const rng = rngOf(9);
  let easyFool = 0, games = 0;
  for (let g = 0; g < 120; g++) {
    const lv = g % 2 ? ['easy', 'expert'] : ['expert', 'easy'];
    let st = D.init([{ id: 'a' }, { id: 'b' }], { mode: g % 4 < 2 ? 'podkidnoy' : 'perevodnoy' }, rng), k = 0;
    while (!st.gameOver && k++ < 3000) st = act(st, B.choose(st, st.actor, lv[st.actor], rng));
    assert.ok(st.gameOver); games++;
    if (st.loser >= 0 && lv[st.loser] === 'easy') easyFool++;
  }
  assert.ok(easyFool > games * 0.8, 'лёгкий чаще дурак: ' + easyFool + ' из ' + games);
  // средний на троих: тоже без ошибок
  let st = D.init([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { mode: 'perevodnoy' }, rng), k = 0;
  while (!st.gameOver && k++ < 3000) st = act(st, B.choose(st, st.actor, 'medium', rng));
  assert.ok(st.gameOver);
});

test('колода 52: от двойки до туза, без джокеров', () => {
  for (let seed = 1; seed < 20; seed++) {
    const st = D.init([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { mode: 'perevodnoy-52' }, rngOf(seed));
    assert.equal(st.mode, 'perevodnoy'); assert.equal(st.deckSize, 52);
    assert.equal(cardsTotal(st), 52);
    const all = st.seats.flatMap((x) => x.hand).concat(st.deck);
    assert.equal(new Set(all).size, 52);
    assert.ok(all.includes('2S') && all.includes('5H') && all.includes('AH'));
    assert.ok(all.every((c) => c[0] !== 'X'), 'джокеров нет');
  }
  const st36 = D.init([{ id: 'a' }, { id: 'b' }], { mode: 'podkidnoy' }, rngOf(2));
  assert.equal(st36.deckSize, 36);
  assert.ok(st36.seats.flatMap((x) => x.hand).concat(st36.deck).every((c) => D.rank(c) >= D.RANKS.indexOf('6')), 'в колоде на 36 — от шестёрки');
});

test('за столом до 6 игроков; 36 карт на шестерых — колоды нет, козырь — последняя розданная карта', () => {
  const st = D.init(Array.from({ length: 6 }, (_, i) => ({ id: 'p' + i })), { mode: 'podkidnoy' }, rngOf(3));
  assert.equal(st.seats.length, 6); assert.equal(st.deck.length, 0); assert.equal(cardsTotal(st), 36);
  assert.ok(st.seats[5].hand.includes(st.trumpCard));
  assert.equal(D.reduce(st, { seat: 6, type: 'pass' }).ok, false);
});

test('боты на 2–6 игроков с обеими колодами: партии доходят до конца, карты не теряются', () => {
  const rng = rngOf(77), levels = ['easy', 'medium', 'expert'];
  for (let g = 0; g < 100; g++) {
    const n = 2 + (g % 5), deck = g % 2 ? 52 : 36, mode = (g % 4 < 2 ? 'podkidnoy' : 'perevodnoy') + (deck === 52 ? '-52' : '');
    let st = D.init(Array.from({ length: n }, (_, i) => ({ id: 'p' + i })), { mode }, rng), k = 0;
    while (!st.gameOver && k++ < 5000) { st = act(st, B.choose(st, st.actor, levels[(st.actor + g) % 3], rng)); assert.equal(cardsTotal(st), deck); }
    assert.ok(st.gameOver);
  }
});
