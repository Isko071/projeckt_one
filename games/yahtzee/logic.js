// Чистая логика игры «Ятзи»: правила подсчёта, состояние партии, компьютерный соперник.
// Без обращений к window и document, поэтому тестируется через node (tests/logic.test.js).
// ===== Константы =====
var UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
var LOWER = ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'];
var CATEGORIES = UPPER.concat(LOWER);
var NUM_DICE = 5;
var MAX_ROLLS = 3;
var UPPER_BONUS_THRESHOLD = 63;
var UPPER_BONUS = 35;
var YAHTZEE_BONUS = 100;
var FIXED_SCORES = { fullHouse: 25, smallStraight: 30, largeStraight: 40, yahtzee: 50 };

// ===== Чистые функции подсчёта =====
function isRolled(dice) {
  return dice.length === NUM_DICE && dice.every(function (d) { return d >= 1 && d <= 6; });
}

// counts[1..6] — сколько раз выпала каждая грань
function countFaces(dice) {
  var counts = [0, 0, 0, 0, 0, 0, 0];
  dice.forEach(function (d) { counts[d]++; });
  return counts;
}

function sum(dice) {
  return dice.reduce(function (a, b) { return a + b; }, 0);
}

function hasRun(dice, length) {
  var counts = countFaces(dice);
  for (var start = 1; start + length - 1 <= 6; start++) {
    var ok = true;
    for (var f = start; f < start + length; f++) if (counts[f] === 0) ok = false;
    if (ok) return true;
  }
  return false;
}

function isYahtzee(dice) {
  return isRolled(dice) && dice.every(function (d) { return d === dice[0]; });
}

// Очки категории по обычным правилам (без жокера)
function scoreRaw(cat, dice) {
  if (!isRolled(dice)) return 0;
  var counts = countFaces(dice);
  var max = Math.max.apply(null, counts);
  var upperIdx = UPPER.indexOf(cat);
  if (upperIdx >= 0) return counts[upperIdx + 1] * (upperIdx + 1);
  switch (cat) {
    case 'threeKind': return max >= 3 ? sum(dice) : 0;
    case 'fourKind': return max >= 4 ? sum(dice) : 0;
    case 'fullHouse': return counts.indexOf(3) >= 0 && counts.indexOf(2) >= 0 ? FIXED_SCORES.fullHouse : 0;
    case 'smallStraight': return hasRun(dice, 4) ? FIXED_SCORES.smallStraight : 0;
    case 'largeStraight': return hasRun(dice, 5) ? FIXED_SCORES.largeStraight : 0;
    case 'yahtzee': return max === 5 ? FIXED_SCORES.yahtzee : 0;
    case 'chance': return sum(dice);
  }
  return 0;
}

// ===== Игрок и таблица очков =====
function createPlayer(name) {
  var scores = {};
  CATEGORIES.forEach(function (c) { scores[c] = null; });
  return { name: name, scores: scores, yahtzeeBonuses: 0 };
}

function openCategories(player) {
  return CATEGORIES.filter(function (c) { return player.scores[c] === null; });
}

// Жокер: выпал ятзи, а клетка «Ятзи» уже заполнена (50 или 0)
function isJoker(player, dice) {
  return isYahtzee(dice) && player.scores.yahtzee !== null;
}

// Бонус +100: выпал ятзи, а в клетке «Ятзи» стоит 50
function earnsYahtzeeBonus(player, dice) {
  return isYahtzee(dice) && player.scores.yahtzee === FIXED_SCORES.yahtzee;
}

// Категории, в которые можно записать текущий бросок (с учётом жокера)
function allowedCategories(player, dice) {
  if (!isRolled(dice)) return [];
  var open = openCategories(player);
  if (!isJoker(player, dice)) return open;
  var upperCat = UPPER[dice[0] - 1];
  if (open.indexOf(upperCat) >= 0) return [upperCat];
  var lowerOpen = open.filter(function (c) { return LOWER.indexOf(c) >= 0; });
  return lowerOpen.length ? lowerOpen : open;
}

// Очки, которые получит игрок за категорию (по жокеру фулл-хаус и стриты дают полные очки)
function possibleScore(player, cat, dice) {
  if (isJoker(player, dice) && (cat === 'fullHouse' || cat === 'smallStraight' || cat === 'largeStraight')) {
    return FIXED_SCORES[cat];
  }
  return scoreRaw(cat, dice);
}

function upperSum(player) {
  return UPPER.reduce(function (a, c) { return a + (player.scores[c] || 0); }, 0);
}

function upperBonus(player) {
  return upperSum(player) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
}

function lowerSum(player) {
  return LOWER.reduce(function (a, c) { return a + (player.scores[c] || 0); }, 0);
}

function totalScore(player) {
  return upperSum(player) + upperBonus(player) + lowerSum(player) + player.yahtzeeBonuses * YAHTZEE_BONUS;
}

function isPlayerDone(player) {
  return openCategories(player).length === 0;
}

// ===== Состояние игры =====
function createGame(names) {
  return {
    players: names.map(createPlayer),
    current: 0,
    dice: [1, 1, 1, 1, 1],
    held: [false, false, false, false, false],
    rollsUsed: 0,
    gameOver: false
  };
}

function rollsLeft(state) {
  return MAX_ROLLS - state.rollsUsed;
}

// Бросает незафиксированные кубики (при первом броске — все)
function roll(state, rng) {
  rng = rng || Math.random;
  if (state.gameOver || state.rollsUsed >= MAX_ROLLS) return false;
  if (state.rollsUsed === 0) state.held = [false, false, false, false, false];
  for (var i = 0; i < NUM_DICE; i++) {
    if (!state.held[i]) state.dice[i] = 1 + Math.floor(rng() * 6);
  }
  state.rollsUsed++;
  return true;
}

// Фиксация/разблокировка кубика: возможна между бросками
function toggleHold(state, index) {
  if (state.gameOver || state.rollsUsed < 1 || state.rollsUsed >= MAX_ROLLS) return false;
  if (index < 0 || index >= NUM_DICE) return false;
  state.held[index] = !state.held[index];
  return true;
}

// Запись результата в категорию; передаёт ход следующему игроку
function scoreCategory(state, cat) {
  if (state.gameOver || state.rollsUsed < 1) return false;
  var player = state.players[state.current];
  if (allowedCategories(player, state.dice).indexOf(cat) < 0) return false;
  var points = possibleScore(player, cat, state.dice);
  if (earnsYahtzeeBonus(player, state.dice)) player.yahtzeeBonuses++;
  player.scores[cat] = points;
  endTurn(state);
  return true;
}

function endTurn(state) {
  state.dice = [1, 1, 1, 1, 1];
  state.held = [false, false, false, false, false];
  state.rollsUsed = 0;
  if (state.players.every(isPlayerDone)) {
    state.gameOver = true;
  } else {
    state.current = (state.current + 1) % state.players.length;
  }
}

// ===== Компьютерный соперник =====
// Решения принимаются по ожидаемой ценности: компьютер перебирает, какие кубики оставить,
// считает, что в среднем выпадет при добросе, и оценивает каждую клетку как
// «очки минус то, сколько в среднем даёт эта клетка», плюс вероятность бонуса 35.

// Средний результат клеток при хорошей игре (используется как «цена упущенной возможности»)
var CATEGORY_AVG = {
  ones: 2.1, twos: 5.3, threes: 8.6, fours: 12.1, fives: 15.7, sixes: 19.2,
  threeKind: 21.7, fourKind: 13.1, fullHouse: 22.9, smallStraight: 29.5,
  largeStraight: 32.7, yahtzee: 16.9, chance: 22
};

// Вероятность набрать 63 в верхней секции при ожидаемой итоговой сумме expected
function upperBonusChance(expected, settled) {
  if (settled) return expected >= UPPER_BONUS_THRESHOLD ? 1 : 0;
  return 1 / (1 + Math.exp(-(expected - UPPER_BONUS_THRESHOLD) / 5));
}

// Ценность записи текущего броска в клетку cat
function cpuCategoryValue(player, cat, dice) {
  var pts = possibleScore(player, cat, dice);
  var value = pts - CATEGORY_AVG[cat];
  var ui = UPPER.indexOf(cat);
  if (ui >= 0 && upperSum(player) < UPPER_BONUS_THRESHOLD) {
    var expectedBefore = upperSum(player);
    var expectedAfter = upperSum(player) + pts;
    var openAfter = 0;
    UPPER.forEach(function (c) {
      if (player.scores[c] === null) {
        expectedBefore += CATEGORY_AVG[c];
        if (c !== cat) { expectedAfter += CATEGORY_AVG[c]; openAfter++; }
      }
    });
    value += UPPER_BONUS * (upperBonusChance(expectedAfter, openAfter === 0) - upperBonusChance(expectedBefore, false));
  }
  if (earnsYahtzeeBonus(player, dice)) value += YAHTZEE_BONUS;
  return value;
}

// Лёгкий уровень: оставляет самое частое значение (при равенстве — большее)
function cpuEasyHold(dice) {
  var counts = countFaces(dice);
  var best = 1;
  for (var v = 1; v <= 6; v++) if (counts[v] >= counts[best]) best = v;
  return dice.map(function (d) { return d === best; });
}

// Лёгкий уровень: клетка с максимумом очков (при равенстве — первая в таблице)
function cpuEasyCategory(player, dice) {
  var allowed = allowedCategories(player, dice);
  var best = allowed[0], bestPts = -1;
  allowed.forEach(function (c) {
    var pts = possibleScore(player, c, dice);
    if (pts > bestPts) { bestPts = pts; best = c; }
  });
  return best;
}

// Лучшая клетка для записи: максимум ценности среди разрешённых (level: 'easy' или 'hard')
function cpuChooseCategory(player, dice, level) {
  if (level === 'easy') return cpuEasyCategory(player, dice);
  var allowed = allowedCategories(player, dice);
  var best = allowed[0], bestValue = -Infinity;
  allowed.forEach(function (c) {
    var v = cpuCategoryValue(player, c, dice);
    if (v > bestValue) { bestValue = v; best = c; }
  });
  return best;
}

// Все возможные исходы доброса k кубиков (с точностью до порядка) и их вероятности
var rollOutcomesCache = {};
function rollOutcomes(k) {
  if (rollOutcomesCache[k]) return rollOutcomesCache[k];
  var fact = [1, 1, 2, 6, 24, 120];
  var total = Math.pow(6, k), out = [];
  (function walk(prefix, min) {
    if (prefix.length === k) {
      var counts = [0, 0, 0, 0, 0, 0, 0], ways = fact[k];
      prefix.forEach(function (v) { counts[v]++; });
      for (var f = 1; f <= 6; f++) ways /= fact[counts[f]];
      out.push({ faces: prefix.slice(), p: ways / total });
      return;
    }
    for (var v = min; v <= 6; v++) { prefix.push(v); walk(prefix, v); prefix.pop(); }
  })([], 1);
  rollOutcomesCache[k] = out;
  return out;
}

function sortedDice(dice) {
  return dice.slice().sort(function (a, b) { return a - b; });
}

// Исходы доброса при оставленных кубиках held (отсортированный массив): итоговые кубики и вероятности.
// Не зависят от игрока, поэтому кэшируются между вызовами.
var transitionsCache = {};
function transitionsFor(held) {
  var key = held.join('');
  if (!transitionsCache[key]) {
    transitionsCache[key] = rollOutcomes(NUM_DICE - held.length).map(function (o) {
      var dice = sortedDice(held.concat(o.faces));
      return { dice: dice, key: dice.join(''), p: o.p };
    });
  }
  return transitionsCache[key];
}

// Варианты «что оставить» для набора кубиков (без повторов по составу, без варианта «оставить все»)
var holdOptionsCache = {};
function holdOptionsFor(sorted) {
  var key = sorted.join('');
  if (!holdOptionsCache[key]) {
    var seen = {}, options = [];
    for (var mask = 0; mask < (1 << NUM_DICE) - 1; mask++) {
      var held = sorted.filter(function (_, i) { return mask & (1 << i); });
      var hk = held.join('');
      if (!seen[hk]) { seen[hk] = true; options.push(held); }
    }
    holdOptionsCache[key] = options;
  }
  return holdOptionsCache[key];
}

// Выбор кубиков для сохранения: массив из пяти boolean.
// Если все true — лучше остановиться и записать результат (добрасывать невыгодно).
function cpuChooseHold(player, dice, rollsLeft, level) {
  var allHeld = [true, true, true, true, true];
  if (rollsLeft <= 0) return allHeld;
  if (level === 'easy') return cpuEasyHold(dice);
  var stopMemo = {};
  var evMemo = [];
  for (var r = 0; r <= rollsLeft; r++) evMemo.push({});

  function stopValue(sorted, key) {
    if (stopMemo[key] === undefined) {
      var best = -Infinity;
      allowedCategories(player, sorted).forEach(function (c) {
        var v = cpuCategoryValue(player, c, sorted);
        if (v > best) best = v;
      });
      stopMemo[key] = best;
    }
    return stopMemo[key];
  }

  // Ожидаемая ценность: оставить held и добросить остальные, когда после этого осталось rerolls добросов
  function rerollValue(held, rerolls) {
    var total = 0, list = transitionsFor(held);
    for (var i = 0; i < list.length; i++) total += list[i].p * bestValue(list[i].dice, list[i].key, rerolls);
    return total;
  }

  // Лучшая ценность позиции, если осталось rerolls добросов (можно и остановиться)
  function bestValue(sorted, key, rerolls) {
    if (rerolls === 0) return stopValue(sorted, key);
    var memo = evMemo[rerolls];
    if (memo[key] === undefined) {
      var best = stopValue(sorted, key), options = holdOptionsFor(sorted);
      for (var i = 0; i < options.length; i++) {
        var v = rerollValue(options[i], rerolls - 1);
        if (v > best) best = v;
      }
      memo[key] = best;
    }
    return memo[key];
  }

  var sortedAll = sortedDice(dice);
  var bestMask = null, bestV = stopValue(sortedAll, sortedAll.join('')) + 1e-9;
  for (var mask = 0; mask < (1 << NUM_DICE) - 1; mask++) {
    var held = [];
    dice.forEach(function (d, i) { if (mask & (1 << i)) held.push(d); });
    var v = rerollValue(sortedDice(held), rollsLeft - 1);
    if (v > bestV) { bestV = v; bestMask = mask; }
  }
  if (bestMask === null) return allHeld;
  return dice.map(function (_, i) { return (bestMask & (1 << i)) !== 0; });
}

var Yahtzee = {
  UPPER: UPPER, LOWER: LOWER, CATEGORIES: CATEGORIES, MAX_ROLLS: MAX_ROLLS,
  isRolled: isRolled, countFaces: countFaces, isYahtzee: isYahtzee,
  scoreRaw: scoreRaw, createPlayer: createPlayer, openCategories: openCategories,
  isJoker: isJoker, earnsYahtzeeBonus: earnsYahtzeeBonus,
  allowedCategories: allowedCategories, possibleScore: possibleScore,
  upperSum: upperSum, upperBonus: upperBonus, lowerSum: lowerSum, totalScore: totalScore,
  isPlayerDone: isPlayerDone, createGame: createGame, rollsLeft: rollsLeft,
  roll: roll, toggleHold: toggleHold, scoreCategory: scoreCategory,
  cpuChooseHold: cpuChooseHold, cpuChooseCategory: cpuChooseCategory,
  cpuEasyHold: cpuEasyHold, cpuEasyCategory: cpuEasyCategory
};
