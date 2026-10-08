// Запуск: node --test games/yahtzee/tests/table.test.js
// Ятзи за онлайн-столом: режимы «по очереди» и «одновременно», выход игроков, таймаут, итоги.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ JSON, Math, Object, Array, Number, String, Error });
['logic.js', 'table.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f }));
const Y = vm.runInContext('Yahtzee', ctx), T = vm.runInContext('YahtzeeTable', ctx);
const plain = (x) => JSON.parse(JSON.stringify(x));

// Генератор, который выдаёт заданные грани по очереди (иначе единицы)
const dice = (...faces) => { let k = 0; return () => ((faces[k++ % faces.length] - 1) + 0.5) / 6; };
const seats = (n) => Array.from({ length: n }, (_, i) => ({ id: 'u' + i, name: 'И' + (i + 1) }));
function run(st, action, rng) { const r = T.reduce(st, action, rng); assert.equal(r.ok, true, JSON.stringify(action) + ' → ' + r.error); return r.state; }
const play = (st, seat, cat, rng) => run(run(st, { type: 'roll', seat }, rng), { type: 'score', seat, cat }, rng);

test('старт: до 6 мест, режим по умолчанию «по очереди», у каждого свои кубики и таблица', () => {
  const st = T.init(seats(8), {});
  assert.equal(st.players.length, 6);
  assert.equal(st.mode, 'turns');
  assert.equal(st.current, 0);
  assert.equal(st.round, 1);
  assert.deepEqual(plain(st.players[3].dice), [1, 1, 1, 1, 1]);
  assert.equal(T.init(seats(2), { mode: 'sync' }).current, -1);
});

test('по очереди: ходит только текущий игрок, после записи ход переходит дальше по кругу', () => {
  let st = T.init(seats(3), { mode: 'turns' });
  assert.equal(T.reduce(st, { type: 'roll', seat: 1 }).error, 'not-your-turn');
  st = play(st, 0, 'chance', dice(6));
  assert.equal(st.current, 1);
  assert.equal(st.players[0].scores.chance, 30);
  assert.deepEqual(plain(T.waitingSeats(st)), [1]);
  st = play(st, 1, 'ones', dice(1));
  st = play(st, 2, 'ones', dice(2));
  assert.equal(st.current, 0);
  assert.equal(st.round, 2);
  assert.equal(st.players[2].scores.ones, 0);
});

test('бросок: до трёх раз, фиксация кубиков только между бросками, запись без броска невозможна', () => {
  let st = T.init(seats(2), { mode: 'turns' });
  assert.equal(T.reduce(st, { type: 'score', seat: 0, cat: 'chance' }).error, 'bad-category');
  assert.equal(T.reduce(st, { type: 'hold', seat: 0, index: 0 }).error, 'bad-hold');
  st = run(st, { type: 'roll', seat: 0 }, dice(3, 4, 5, 6, 2));
  st = run(st, { type: 'hold', seat: 0, index: 0 });
  st = run(st, { type: 'roll', seat: 0 }, dice(1));
  assert.deepEqual(plain(st.players[0].dice), [3, 1, 1, 1, 1]);
  st = run(st, { type: 'roll', seat: 0 }, dice(1));
  assert.equal(T.reduce(st, { type: 'roll', seat: 0 }).error, 'no-rolls');
  assert.equal(T.reduce(st, { type: 'hold', seat: 0, index: 1 }).error, 'bad-hold');
  assert.equal(T.reduce(st, { type: 'score', seat: 0, cat: 'nonsense' }).error, 'bad-category');
});

test('одновременно: все играют сразу, но следующий раунд начинается, когда записали все', () => {
  let st = T.init(seats(3), { mode: 'sync' });
  assert.deepEqual(plain(T.waitingSeats(st)), [0, 1, 2]);
  st = run(st, { type: 'roll', seat: 2 }, dice(5));             // третий бросает первым
  st = run(st, { type: 'score', seat: 2, cat: 'fives' });
  assert.equal(st.players[2].done, true);
  assert.deepEqual(plain(T.waitingSeats(st)), [0, 1]);
  assert.equal(T.reduce(st, { type: 'roll', seat: 2 }).error, 'not-your-turn', 'записавший ждёт остальных');
  st = play(st, 0, 'ones', dice(1));
  assert.equal(st.round, 1, 'пока не записал второй игрок, раунд тот же');
  assert.deepEqual(plain(st.players.map((p) => p.done)), [true, false, true]);
  st = play(st, 1, 'twos', dice(2));
  assert.deepEqual(plain(st.players.map((p) => p.done)), [false, false, false], 'все записали: новый раунд');
  assert.equal(st.round, 2);
  assert.deepEqual(plain(T.waitingSeats(st)), [0, 1, 2]);
});

test('бросок с маской фиксации: кубики из маски остаются, остальные перебрасываются', () => {
  let st = T.init(seats(2), { mode: 'sync' });
  st = run(st, { type: 'roll', seat: 0 }, dice(3, 4, 5, 6, 2));
  st = run(st, { type: 'roll', seat: 0, held: [true, false, true, false, false] }, dice(1));
  assert.deepEqual(plain(st.players[0].dice), [3, 1, 5, 1, 1]);
  st = run(st, { type: 'roll', seat: 0, held: [true, true, true, true, true] }, dice(6));
  assert.deepEqual(plain(st.players[0].dice), [3, 1, 5, 1, 1], 'все зафиксированы: ничего не меняется, бросок засчитан');
  assert.equal(st.players[0].rollsUsed, 3);
});

test('итоги раунда: в одновременном режиме, когда записали все, остаётся список «кто куда записал»', () => {
  let st = T.init(seats(3), { mode: 'sync' });
  assert.equal(st.recap, undefined);
  st = play(st, 0, 'chance', dice(6));
  st = play(st, 1, 'ones', dice(1));
  assert.equal(st.recap, undefined, 'пока записали не все, итогов нет');
  st = play(st, 2, 'twos', dice(2));
  assert.equal(st.recap.id, 1);
  assert.equal(st.recap.round, 1);
  assert.deepEqual(plain(st.recap.rows), [{ seat: 0, cat: 'chance', pts: 30 }, { seat: 1, cat: 'ones', pts: 5 }, { seat: 2, cat: 'twos', pts: 10 }]);
  st = play(st, 2, 'threes', dice(3));
  st = play(st, 0, 'fours', dice(4));
  st = play(st, 1, 'fives', dice(5));
  assert.equal(st.recap.id, 2);
  assert.equal(st.recap.round, 2);
  assert.deepEqual(plain(st.recap.rows.map((r) => r.cat)), ['fours', 'fives', 'threes']);
});

test('итоги раунда: вышедший игрок в итоги не попадает; в режиме по очереди итогов нет', () => {
  let st = T.init(seats(3), { mode: 'sync' });
  st = play(st, 0, 'ones', dice(1));
  st = play(st, 1, 'ones', dice(1));
  st = run(st, { type: 'leave', seat: 2 });
  assert.deepEqual(plain(st.recap.rows.map((r) => r.seat)), [0, 1]);
  let tr = T.init(seats(2), { mode: 'turns' });
  tr = play(tr, 0, 'ones', dice(1)); tr = play(tr, 1, 'ones', dice(1));
  assert.equal(tr.recap, undefined);
});

test('ятзи и жокер работают у каждого игрока по своей таблице', () => {
  let st = T.init(seats(2), { mode: 'sync' });
  st = play(st, 0, 'yahtzee', dice(4));
  st = play(st, 1, 'chance', dice(1, 2, 3, 4, 6));
  assert.equal(st.players[0].scores.yahtzee, 50);
  st = run(st, { type: 'roll', seat: 0 }, dice(6));
  assert.deepEqual(plain(Y.allowedCategories(st.players[0], st.players[0].dice)), ['sixes']);
  st = run(st, { type: 'score', seat: 0, cat: 'sixes' });
  assert.equal(st.players[0].yahtzeeBonuses, 1);
  assert.equal(Y.totalScore(st.players[0]), 50 + 30 + 100);
});

test('выход игрока: в режиме по очереди ход переходит дальше, в одновременном не ждём вышедшего', () => {
  let st = T.init(seats(3), { mode: 'turns' });
  st = run(st, { type: 'leave', seat: 0 });
  assert.equal(st.current, 1);
  st = run(st, { type: 'leave', seat: 2 });
  assert.equal(st.gameOver, true, 'остался один игрок');
  assert.equal(st.reason, 'alone');
  assert.deepEqual(plain(T.standings(st).filter((r) => r.winner).map((r) => r.seat)), [1]);

  let sy = T.init(seats(3), { mode: 'sync' });
  sy = play(sy, 0, 'ones', dice(1));
  sy = play(sy, 1, 'ones', dice(1));
  sy = run(sy, { type: 'leave', seat: 2 });
  assert.deepEqual(plain(sy.players.map((p) => p.done)), [false, false, false], 'остальные уже записали: раунд закрыт без вышедшего');
  assert.equal(sy.round, 2);
  assert.equal(T.reduce(sy, { type: 'leave', seat: 2 }).error, 'not-active');
});

test('вся партия: 13 раундов в обоих режимах, итоги по убыванию, победитель помечен', () => {
  ['turns', 'sync'].forEach((mode) => {
    let st = T.init(seats(4), { mode });
    let guard = 0;
    while (!st.gameOver && guard++ < 1000) {
      const seat = T.waitingSeats(st)[0];
      const p = st.players[seat];
      st = run(st, { type: 'roll', seat }, Math.random);
      st = run(st, { type: 'score', seat, cat: Y.allowedCategories(st.players[seat], st.players[seat].dice)[0] }, Math.random);
    }
    assert.equal(st.gameOver, true, mode);
    assert.equal(st.reason, 'finished');
    assert.equal(guard, 4 * 13, mode + ': 52 записи');
    const rows = T.standings(st);
    assert.ok(rows[0].total >= rows[3].total);
    assert.ok(rows[0].winner);
    assert.deepEqual(plain(T.waitingSeats(st)), []);
    assert.equal(T.reduce(st, { type: 'roll', seat: 0 }).error, 'game-over');
  });
});

test('действия с чужим местом и неизвестные действия отклоняются, состояние не меняется', () => {
  const st = T.init(seats(2), { mode: 'sync' });
  assert.equal(T.reduce(st, { type: 'roll', seat: 5 }).error, 'bad-seat');
  assert.equal(T.reduce(st, { type: 'dance', seat: 0 }).error, 'bad-action');
  assert.equal(T.reduce(st, null).error, 'bad-seat');
  assert.deepEqual(plain(st), plain(T.init(seats(2), { mode: 'sync' })));
});

test('ключ прогресса меняется при броске и фиксации (для таймера «молчит»)', () => {
  let st = T.init(seats(2), { mode: 'sync' });
  const k0 = T.progressKey(st, 0);
  st = run(st, { type: 'roll', seat: 0 }, dice(3));
  const k1 = T.progressKey(st, 0);
  st = run(st, { type: 'hold', seat: 0, index: 2 });
  assert.notEqual(k0, k1);
  assert.notEqual(k1, T.progressKey(st, 0));
});
