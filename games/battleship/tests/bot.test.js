// Запуск: node --test games/battleship/tests/bot.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ JSON, Math, Object, Array });
['logic.js', 'bot.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f }));
const B = ctx.Battleship, Bot = ctx.BattleshipBot;
function seeded(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Бот (место 0) против поля, по которому соперник (место 1) никого не трогает: считаем ходы, за сколько потоплен весь флот (оружие у бота с запасом по желанию)
function play(level, seed, arsenal, noWeapons) {
  const rng = seeded(seed);
  let st = B.init([{ id: 'bot' }, { id: 'dummy' }], { first: 0 }, rng);
  st = B.reduce(st, { type: 'place', seat: 1, ships: B.randomLayout(rng), arsenal: { radar: 1, sub: 1, bomber: 2 } }, rng).state;
  st = B.reduce(st, { type: 'place', seat: 0, ships: B.randomLayout(rng), arsenal }, rng).state;
  if (noWeapons) st.seats[0].arsenal = { radar: 0, sub: 0, bomber: 0 };
  let actions = 0;
  while (!st.gameOver && actions < 400) {
    if (st.current === 1) {                                              // соперник бьёт по первой свободной клетке, нас это не касается
      const i = st.seats[0].marks.findIndex((m) => m === 0);
      st = B.reduce(st, { type: 'shoot', seat: 1, x: i % 10, y: Math.floor(i / 10) }, rng).state;
      continue;
    }
    const a = Bot.choose(B.view(st, 0), 0, level, rng), r = B.reduce(st, a, rng);
    assert.equal(r.ok, true, level + ': ход бота допустим ' + JSON.stringify(a) + ' ' + (r.error || ''));
    st = r.state; actions++;
  }
  assert.equal(st.gameOver, true, level + ': партия закончилась');
  return actions;
}

test('оба уровня бота всегда делают допустимые ходы и доводят партию до конца (с оружием и без)', () => {
  for (let s = 1; s <= 12; s++) { play('easy', s, { radar: 1, sub: 1, bomber: 2 }); play('expert', s, { radar: 1, sub: 1, bomber: 2 }); }
});

test('эксперт топит флот быстрее лёгкого бота: и без оружия, и с оружием', () => {
  const avg = (level, weapons) => { let sum = 0; for (let k = 1; k <= 60; k++) sum += play(level, 500 + k, { radar: 1, sub: 1, bomber: 2 }, !weapons); return sum / 60; };
  const e0 = avg('easy', false), x0 = avg('expert', false), e1 = avg('easy', true), x1 = avg('expert', true);
  assert.ok(x0 < e0 * 0.97, 'без оружия: эксперт ' + x0.toFixed(1) + ', лёгкий ' + e0.toFixed(1));
  assert.ok(x1 < e1 * 0.9, 'с оружием: эксперт ' + x1.toFixed(1) + ', лёгкий ' + e1.toFixed(1));
});

test('эксперт сразу бьёт по клетке, где радар нашёл корабль, и добивает раненого рядом', () => {
  let st = B.init([{ id: 'a' }, { id: 'b' }], { first: 0 }, seeded(7));
  st.seats[1].marks[44] = 4;
  st.seats[1].ships = [{ len: 1, cells: [44], hit: [false] }]; st.seats[1].ready = true;
  st.seats[0].arsenal = { radar: 0, sub: 0, bomber: 0 };
  const v = B.view(st, 0);
  v.seats[1].left = { 1: 1 };
  const a = Bot.choose(v, 0, 'expert', seeded(1));
  assert.deepEqual({ type: a.type, x: a.x, y: a.y }, { type: 'shoot', x: 4, y: 4 });
  const w = B.view(st, 0); w.seats[1].marks = w.seats[1].marks.map(() => 0); w.seats[1].marks[55] = 2; w.seats[1].left = { 3: 1 };
  const b = Bot.choose(w, 0, 'expert', seeded(2));
  assert.ok([54, 56, 45, 65, 53, 57, 35, 75].indexOf(b.y * 10 + b.x) >= 0, 'добивает рядом с раненой клеткой: ' + (b.y * 10 + b.x));
});

test('лёгкий бот после попадания стреляет по соседней клетке', () => {
  const st = B.init([{ id: 'a' }, { id: 'b' }], { first: 0 }, seeded(3));
  const v = B.view(st, 0); v.seats[1].marks[33] = 2; v.seats[0].arsenal = { radar: 0, sub: 0, bomber: 0 };
  for (let s = 0; s < 20; s++) { const a = Bot.choose(v, 0, 'easy', seeded(s)); assert.ok([23, 43, 32, 34].indexOf(a.y * 10 + a.x) >= 0); assert.equal(a.type, 'shoot'); }
});
