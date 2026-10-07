// Запуск: node --test games/yahtzee/tests/logic.test.js
// Логика берётся из games/yahtzee/logic.js (без DOM, поэтому выполняется в изолированном контексте vm)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
const Y = vm.runInNewContext(code + ';Yahtzee');
// Массивы из контекста vm имеют другой прототип — приводим к обычным для deepEqual
const plain = (x) => JSON.parse(JSON.stringify(x));

// Игрок с заранее заполненными клетками
function playerWith(scores, bonuses) {
  const p = Y.createPlayer('Тест');
  Object.assign(p.scores, scores);
  p.yahtzeeBonuses = bonuses || 0;
  return p;
}

test('фулл-хаус: пять одинаковых без жокера дают 0', () => {
  assert.equal(Y.scoreRaw('fullHouse', [4, 4, 4, 4, 4]), 0);
  assert.equal(Y.possibleScore(Y.createPlayer('a'), 'fullHouse', [4, 4, 4, 4, 4]), 0);
});

test('фулл-хаус: пять одинаковых при жокере дают 25', () => {
  const p = playerWith({ yahtzee: 50 });
  assert.equal(Y.possibleScore(p, 'fullHouse', [4, 4, 4, 4, 4]), 25);
});

test('фулл-хаус: обычный 3+2 даёт 25', () => {
  assert.equal(Y.scoreRaw('fullHouse', [2, 2, 5, 5, 5]), 25);
  assert.equal(Y.scoreRaw('fullHouse', [2, 2, 5, 5, 6]), 0);
});

test('малый стрит с повтором считается', () => {
  assert.equal(Y.scoreRaw('smallStraight', [1, 2, 2, 3, 4]), 30);
  assert.equal(Y.scoreRaw('smallStraight', [3, 4, 4, 5, 6]), 30);
  assert.equal(Y.scoreRaw('smallStraight', [1, 2, 3, 5, 6]), 0);
});

test('большой стрит: только пять подряд', () => {
  assert.equal(Y.scoreRaw('largeStraight', [2, 3, 4, 5, 6]), 40);
  assert.equal(Y.scoreRaw('largeStraight', [1, 2, 3, 4, 6]), 0);
  assert.equal(Y.scoreRaw('largeStraight', [1, 2, 2, 3, 4]), 0);
});

test('ноль в категории, если комбинации нет', () => {
  assert.equal(Y.scoreRaw('fourKind', [1, 1, 1, 2, 3]), 0);
  assert.equal(Y.scoreRaw('threeKind', [1, 1, 2, 2, 3]), 0);
  assert.equal(Y.scoreRaw('yahtzee', [1, 1, 1, 1, 2]), 0);
  assert.equal(Y.scoreRaw('sixes', [1, 2, 3, 4, 5]), 0);
});

test('сет, каре, шанс считают сумму кубиков; верхняя секция — сумму граней', () => {
  assert.equal(Y.scoreRaw('threeKind', [3, 3, 3, 1, 6]), 16);
  assert.equal(Y.scoreRaw('fourKind', [5, 5, 5, 5, 2]), 22);
  assert.equal(Y.scoreRaw('chance', [1, 2, 3, 4, 6]), 16);
  assert.equal(Y.scoreRaw('fours', [4, 4, 1, 4, 2]), 12);
  assert.equal(Y.scoreRaw('yahtzee', [6, 6, 6, 6, 6]), 50);
});

test('бонус верхней секции: 63 даёт +35, 62 — нет', () => {
  const at63 = playerWith({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
  assert.equal(Y.upperSum(at63), 63);
  assert.equal(Y.upperBonus(at63), 35);
  assert.equal(Y.totalScore(at63), 98);
  const at62 = playerWith({ ones: 2, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
  assert.equal(Y.upperSum(at62), 62);
  assert.equal(Y.upperBonus(at62), 0);
  assert.equal(Y.totalScore(at62), 62);
});

test('повторный ятзи: +100 только если в клетке «Ятзи» стоит 50', () => {
  const dice = [3, 3, 3, 3, 3];
  assert.equal(Y.earnsYahtzeeBonus(playerWith({ yahtzee: 50 }), dice), true);
  assert.equal(Y.earnsYahtzeeBonus(playerWith({ yahtzee: 0 }), dice), false);
  assert.equal(Y.earnsYahtzeeBonus(Y.createPlayer('a'), dice), false);
  assert.equal(Y.earnsYahtzeeBonus(playerWith({ yahtzee: 50 }), [3, 3, 3, 3, 2]), false);
});

test('повторный ятзи в партии даёт бонус 100 и записывается по жокеру', () => {
  const g = Y.createGame(['A', 'B']);
  g.players[0].scores.yahtzee = 50;
  g.dice = [3, 3, 3, 3, 3];
  g.rollsUsed = 1;
  assert.deepEqual(plain(Y.allowedCategories(g.players[0], g.dice)), ['threes']);
  assert.equal(Y.scoreCategory(g, 'threes'), true);
  assert.equal(g.players[0].scores.threes, 15);
  assert.equal(g.players[0].yahtzeeBonuses, 1);
  assert.equal(Y.totalScore(g.players[0]), 50 + 15 + 100);
  assert.equal(g.current, 1);
});

test('жокер: соответствующая верхняя занята — любая нижняя; нижние заняты — любая верхняя', () => {
  const dice = [6, 6, 6, 6, 6];
  const lowerFilled = {};
  ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'chance'].forEach((c) => { lowerFilled[c] = 0; });
  const p1 = playerWith({ yahtzee: 0, sixes: 18 });
  assert.deepEqual(plain(Y.allowedCategories(p1, dice)), ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'chance']);
  assert.equal(Y.possibleScore(p1, 'largeStraight', dice), 40);
  assert.equal(Y.possibleScore(p1, 'smallStraight', dice), 30);
  const p2 = playerWith(Object.assign({ yahtzee: 50, sixes: 18 }, lowerFilled));
  assert.deepEqual(plain(Y.allowedCategories(p2, dice)), ['ones', 'twos', 'threes', 'fours', 'fives']);
  assert.equal(Y.possibleScore(p2, 'ones', dice), 0);
});

test('без жокера ятзи можно записать в любую свободную клетку', () => {
  const p = Y.createPlayer('a');
  assert.equal(Y.allowedCategories(p, [2, 2, 2, 2, 2]).length, 13);
});

test('бросок: до трёх раз за ход, зафиксированные кубики не меняются', () => {
  const g = Y.createGame(['A']);
  assert.equal(Y.toggleHold(g, 0), false, 'до броска фиксировать нельзя');
  let seq = [1, 2, 3, 4, 5].map((v) => (v - 0.5) / 6);
  let i = 0;
  assert.equal(Y.roll(g, () => seq[i++ % 5]), true);
  assert.deepEqual(plain(g.dice), [1, 2, 3, 4, 5]);
  assert.equal(Y.toggleHold(g, 0), true);
  assert.equal(Y.roll(g, () => 0.99), true);
  assert.deepEqual(plain(g.dice), [1, 6, 6, 6, 6]);
  assert.equal(Y.toggleHold(g, 0), true, 'снять фиксацию');
  assert.equal(g.held[0], false);
  assert.equal(Y.roll(g, () => 0.99), true);
  assert.equal(Y.rollsLeft(g), 0);
  assert.equal(Y.roll(g, () => 0.99), false, 'четвёртого броска нет');
  assert.equal(Y.toggleHold(g, 0), false, 'после третьего фиксировать нельзя');
});

test('нельзя записать до броска и дважды в одну клетку', () => {
  const g = Y.createGame(['A', 'B']);
  assert.equal(Y.scoreCategory(g, 'chance'), false);
  Y.roll(g);
  assert.equal(Y.scoreCategory(g, 'chance'), true);
  g.current = 0;
  Y.roll(g);
  assert.equal(Y.scoreCategory(g, 'chance'), false);
});

test('игра заканчивается, когда заполнены все клетки у всех игроков', () => {
  const g = Y.createGame(['A', 'B']);
  let turns = 0;
  while (!g.gameOver) {
    Y.roll(g);
    const cat = Y.allowedCategories(g.players[g.current], g.dice)[0];
    assert.equal(Y.scoreCategory(g, cat), true);
    turns++;
    assert.ok(turns <= 26);
  }
  assert.equal(turns, 26);
  assert.ok(g.players.every(Y.isPlayerDone));
  assert.equal(Y.roll(g), false);
});

test('компьютер оставляет тройку одинаковых и добрасывает остальное', () => {
  const p = Y.createPlayer('c');
  assert.deepEqual(plain(Y.cpuChooseHold(p, [6, 6, 6, 1, 2], 2)), [true, true, true, false, false]);
  assert.deepEqual(plain(Y.cpuChooseHold(p, [6, 6, 6, 6, 2], 1)), [true, true, true, true, false]);
});

test('компьютер останавливается, когда добрасывать невыгодно', () => {
  const p = Y.createPlayer('c');
  assert.deepEqual(plain(Y.cpuChooseHold(p, [2, 3, 4, 5, 6], 2)), [true, true, true, true, true]);
  assert.deepEqual(plain(Y.cpuChooseHold(p, [5, 5, 5, 5, 5], 2)), [true, true, true, true, true]);
  assert.deepEqual(plain(Y.cpuChooseHold(p, [1, 2, 3, 4, 6], 0)), [true, true, true, true, true], 'бросков нет');
});

test('компьютер с последним броском держит четыре подряд ради большого стрита', () => {
  const p = Y.createPlayer('c');
  const hold = plain(Y.cpuChooseHold(p, [1, 2, 3, 4, 4], 1));
  assert.deepEqual(hold.slice(0, 4), [true, true, true, true]);
  assert.equal(hold[4], false);
});

test('компьютер не тратит ятзи и шанс на слабый бросок, если есть дешёвая клетка', () => {
  const p = Y.createPlayer('c');
  assert.equal(Y.cpuChooseCategory(p, [1, 1, 3, 4, 6]), 'ones');
});

test('компьютер выбирает выгодную клетку', () => {
  assert.equal(Y.cpuChooseCategory(Y.createPlayer('c'), [2, 2, 5, 5, 5]), 'fullHouse');
  assert.equal(Y.cpuChooseCategory(Y.createPlayer('c'), [1, 2, 3, 4, 5]), 'largeStraight');
  assert.equal(Y.cpuChooseCategory(Y.createPlayer('c'), [3, 3, 3, 3, 3]), 'yahtzee');
});

test('компьютер учитывает жокер: при ятзи берёт разрешённую клетку', () => {
  const p = playerWith({ yahtzee: 50, sixes: 18 });
  const cat = Y.cpuChooseCategory(p, [6, 6, 6, 6, 6]);
  assert.ok(Y.allowedCategories(p, [6, 6, 6, 6, 6]).indexOf(cat) >= 0);
  assert.equal(cat, 'fourKind');
});

test('компьютер не записывает 0 в клетку, если есть вариант с очками', () => {
  const p = Y.createPlayer('c');
  [[2, 2, 3, 4, 6], [1, 3, 3, 5, 6], [4, 4, 5, 6, 6]].forEach((dice) => {
    const cat = Y.cpuChooseCategory(p, dice);
    assert.ok(Y.possibleScore(p, cat, dice) > 0, dice.join(',') + ' -> ' + cat);
  });
});

// Детерминированный генератор для воспроизводимых партий
function seeded(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function soloScore(seed, smart) {
  const rng = seeded(seed);
  const g = Y.createGame(['x']);
  while (!g.gameOver) {
    const player = g.players[0];
    Y.roll(g, rng);
    for (let k = 0; k < 2; k++) {
      const hold = plain(Y.cpuChooseHold(player, plain(g.dice), Y.rollsLeft(g), smart ? 'hard' : 'easy'));
      if (hold.every(Boolean)) break;
      g.held = hold;
      Y.roll(g, rng);
    }
    const cat = Y.cpuChooseCategory(player, g.dice, smart ? 'hard' : 'easy');
    assert.equal(Y.scoreCategory(g, cat), true);
  }
  return Y.totalScore(g.players[0]);
}

test('сильный компьютер заметно сильнее лёгкого на одинаковых бросках', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const avg = (smart) => seeds.reduce((a, s) => a + soloScore(s, smart), 0) / seeds.length;
  const smart = avg(true), greedy = avg(false);
  assert.ok(smart > greedy + 30, 'сильный ' + smart.toFixed(1) + ' против лёгкого ' + greedy.toFixed(1));
});

test('лёгкий компьютер: оставляет самое частое значение и берёт максимум очков', () => {
  const p = Y.createPlayer('c');
  assert.deepEqual(plain(Y.cpuChooseHold(p, [2, 2, 5, 5, 1], 2, 'easy')), [false, false, true, true, false]);
  assert.deepEqual(plain(Y.cpuChooseHold(p, [3, 3, 3, 1, 6], 2, 'easy')), [true, true, true, false, false]);
  assert.equal(Y.cpuChooseCategory(p, [1, 2, 3, 4, 5], 'easy'), 'largeStraight');
  // жокер: максимум очков среди разрешённых клеток — большой стрит (40)
  assert.equal(Y.cpuChooseCategory(playerWith({ yahtzee: 50, sixes: 18 }), [6, 6, 6, 6, 6], 'easy'), 'largeStraight');
});
