// Запуск: node --test games/checkers/tests/bot.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ JSON, Math, Object, Array, Number, String, Error, Infinity });
['logic.js', 'bot.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx));
const C = ctx.Checkers, Bot = ctx.CheckersBot;
function rngOf(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

function play(levels, seed) {
  const rng = rngOf(seed);
  let st = C.init([{ id: 'a' }, { id: 'b' }], { white: seed % 2 }, rng), n = 0;
  while (!st.gameOver && n < 300) {
    const a = Bot.choose(C.view(st), st.current, levels[st.current], rng, 40);
    const r = C.reduce(st, a);
    assert.equal(r.ok, true, 'бот ходит по правилам: ' + JSON.stringify(a));
    st = r.state; n++;
  }
  return st;
}

test('бот всегда делает законный ход и доигрывает партию', () => {
  for (let g = 0; g < 6; g++) { const st = play(['easy', 'easy'], g + 1); assert.ok(st.gameOver || st.turns === 300); }
});

test('эксперт уверенно обыгрывает лёгкого', () => {
  let wins = 0, losses = 0;
  const G = 12;
  for (let g = 0; g < G; g++) {
    const st = play(['expert', 'easy'], 100 + g);
    if (st.winner === 0) wins++; else if (st.winner === 1) losses++;
  }
  assert.ok(wins >= 10 && losses === 0, 'эксперт: ' + wins + ' побед, ' + losses + ' поражений из ' + G);
});

test('эксперт не упускает выигрыш шашки и забирает больше', () => {
  // у белых выбор: бить одну или серию из двух
  const st = C.init([{ id: 'a' }, { id: 'b' }], { white: 0 });
  st.board = new Array(64).fill(0);
  const sq = (s) => (8 - Number(s[1])) * 8 + (s.charCodeAt(0) - 97);
  st.board[sq('c3')] = 1; st.board[sq('g3')] = 1; st.board[sq('d4')] = -1; st.board[sq('d6')] = -1; st.board[sq('h4')] = -1; st.board[sq('a7')] = -1;
  const a = Bot.choose(C.view(st), 0, 'expert', rngOf(3));
  assert.deepEqual(Array.from(a.path), [sq('c3'), sq('e5'), sq('c7')]);
});
