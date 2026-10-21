// Запуск: node --test games/checkers/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ JSON, Math, Object, Array, Number, String, Error });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8'), ctx);
const C = ctx.Checkers;
const plain = (x) => JSON.parse(JSON.stringify(x));
// Клетка по шахматной записи: a1 — левый нижний угол (у белых), h8 — правый верхний
const sq = (s) => (8 - Number(s[1])) * 8 + (s.charCodeAt(0) - 97);
const name = (i) => String.fromCharCode(97 + (i % 8)) + (8 - Math.floor(i / 8));
// Позиция: { w: ['c3', ...], W: [дамки], b: [...], B: [...] }; ход белых (место 0 — белые)
function pos(o, turn) {
  const board = new Array(64).fill(0);
  (o.w || []).forEach((s) => { board[sq(s)] = 1; }); (o.W || []).forEach((s) => { board[sq(s)] = 2; });
  (o.b || []).forEach((s) => { board[sq(s)] = -1; }); (o.B || []).forEach((s) => { board[sq(s)] = -2; });
  const st = C.init([{ id: 'w', name: 'Белые' }, { id: 'b', name: 'Чёрные' }], { white: 0 });
  st.board = board; st.current = turn === 'b' ? 1 : 0;
  return st;
}
const moves = (st) => plain(C.legalMoves(st)).map((m) => m.path.map(name).join(m.captured.length ? ':' : '-')).sort();

test('начальная позиция: по 12 шашек на тёмных клетках, белые ходят первыми, 7 ходов', () => {
  const st = C.init([{ id: 'a' }, { id: 'b' }], { white: 1 });
  assert.equal(st.board.filter((p) => p === 1).length, 12);
  assert.equal(st.board.filter((p) => p === -1).length, 12);
  st.board.forEach((p, i) => { if (p) assert.ok(C.dark(i)); });
  assert.equal(st.current, 1, 'первыми ходят белые (место 1)');
  assert.equal(C.colorOf(st, 1), 'w');
  assert.deepEqual(moves(st), ['a3-b4', 'c3-b4', 'c3-d4', 'e3-d4', 'e3-f4', 'g3-f4', 'g3-h4']);
  assert.equal(sq('a1'), 56); assert.ok(C.dark(sq('a1')), 'a1 — тёмная клетка');
});

test('простая шашка ходит только вперёд; чёрные — вниз', () => {
  assert.deepEqual(moves(pos({ w: ['d4'], b: ['h8'] })), ['d4-c5', 'd4-e5']);
  assert.deepEqual(moves(pos({ w: ['a1'], b: ['d6'] }, 'b')), ['d6-c5', 'd6-e5']);
});

test('бить обязательно, в том числе назад; тихие ходы при взятии недоступны', () => {
  assert.deepEqual(moves(pos({ w: ['d4', 'a1'], b: ['e5'] })), ['d4:f6']);
  assert.deepEqual(moves(pos({ w: ['d4'], b: ['c3', 'h8'] })), ['d4:b2'], 'простая бьёт назад');
});

test('серия взятий доводится до конца; выбор между разными взятиями свободный (не обязательно больше)', () => {
  const st = pos({ w: ['a1', 'e3'], b: ['b2', 'd4', 'd6', 'f4'] });
  // a1 бьёт b2 → c3, дальше d4 → e5, дальше d6 → c7 (серия); e3 бьёт f4 → g5 или d4 → c5 (и дальше)
  const m = moves(st);
  assert.ok(m.includes('a1:c3:e5:c7'), m.join(' '));
  assert.ok(!m.includes('a1:c3'), 'остановиться посреди серии нельзя');
  assert.ok(m.includes('e3:g5'), 'одиночное взятие тоже разрешено');
  const r = C.reduce(st, { type: 'move', seat: 0, path: ['a1', 'c3', 'e5', 'c7'].map(sq) });
  assert.equal(r.ok, true);
  assert.deepEqual(['b2', 'd4', 'd6'].map((s) => r.state.board[sq(s)]), [0, 0, 0], 'сбитые сняты');
  assert.equal(r.state.board[sq('c7')], 1);
  assert.equal(r.state.current, 1);
  assert.equal(C.reduce(st, { type: 'move', seat: 0, path: [sq('a1'), sq('c3')] }).ok, false, 'неполная серия не принимается');
});

test('дамка: ходит на любое расстояние, бьёт издалека и встаёт на любую клетку за сбитой', () => {
  const st = pos({ W: ['a1'], b: ['h8'] });
  assert.ok(moves(st).includes('a1-g7'));
  const cap = pos({ W: ['a1'], b: ['d4'] });
  assert.deepEqual(moves(cap), ['a1:e5', 'a1:f6', 'a1:g7', 'a1:h8']);
});

test('дамка после взятия обязана встать туда, откуда бьёт дальше', () => {
  const st = pos({ W: ['a1'], b: ['c3', 'f4'] });
  // после c3 можно встать на d4, e5, f6, g7, h8; бить дальше (f4 → g3) можно только с e5
  assert.deepEqual(moves(st), ['a1:e5:g3', 'a1:e5:h2']);
});

test('турецкий удар: сбитая шашка стоит до конца хода, второй раз через неё не прыгнуть', () => {
  // дамка на a1, чёрные b2... классическая ловушка: после взятия путь назад закрыт ещё не снятой шашкой
  const st = pos({ W: ['e1'], b: ['c3', 'c5', 'e5', 'f2'] });
  const m = C.legalMoves(st);
  m.forEach((mv) => assert.equal(new Set(mv.captured).size, mv.captured.length, 'одна шашка не бьётся дважды'));
  assert.ok(m.some((mv) => mv.captured.length >= 3));
});

test('превращение в дамку: обычным ходом и посреди взятия (дальше бьёт как дамка)', () => {
  const st = pos({ w: ['c7'], b: ['h1'] });
  const r = C.reduce(st, { type: 'move', seat: 0, path: [sq('c7'), sq('d8')] });
  assert.equal(r.state.board[sq('d8')], 2);
  assert.equal(r.state.last.crowned, true);
  // c5 бьёт d6 → e7? нет: b6 → a7... берём: белая на e5 бьёт d6 → c7, затем с c7 бьёт b8? (b8 — последний ряд, за ним нет клетки)
  // белая f6 бьёт e7 → d8 (дамка) и дальше как дамка бьёт c7... нет, c7 рядом: d8 → c7 → b6, a5 свободны
  const st2 = pos({ w: ['f6'], b: ['e7', 'b6', 'h1'] });
  const m = moves(st2);
  assert.ok(m.some((x) => x.startsWith('f6:d8:')), 'после превращения продолжает бить как дамка: ' + m.join(' '));
  const mv = C.legalMoves(st2).find((x) => x.path.length === 3);
  const r2 = C.reduce(st2, { type: 'move', seat: 0, path: mv.path });
  assert.equal(r2.state.board[mv.path[2]], 2, 'стала дамкой');
  assert.equal(r2.state.board[sq('b6')], 0);
});

test('победа: соперник без шашек или без ходов; сдача и выход', () => {
  const r = C.reduce(pos({ w: ['d4'], b: ['e5'] }), { type: 'move', seat: 0, path: [sq('d4'), sq('f6')] });
  assert.equal(r.state.gameOver, true); assert.equal(r.state.winner, 0); assert.equal(r.state.reason, 'pieces');
  // чёрная a7 заперта: впереди b6 занята белой, бить нельзя (за ней c5 занята)
  const st = pos({ w: ['b6', 'c5', 'h2'], b: ['a7'] });
  const r2 = C.reduce(st, { type: 'move', seat: 0, path: [sq('h2'), sq('g3')] });
  assert.equal(r2.state.reason, 'blocked'); assert.equal(r2.state.winner, 0);
  const c = C.reduce(pos({ w: ['d4'], b: ['a7'] }), { type: 'concede', seat: 0 });
  assert.equal(c.state.winner, 1); assert.equal(c.state.reason, 'concede');
  const l = C.reduce(pos({ w: ['d4'], b: ['a7'] }), { type: 'leave', seat: 1 });
  assert.equal(l.state.winner, 0); assert.equal(l.state.reason, 'left');
  assert.equal(C.reduce(l.state, { type: 'move', seat: 0, path: [sq('d4'), sq('c5')] }).ok, false, 'после конца партии ходов нет');
});

test('ничья: 30 ходов подряд только дамками и без взятий', () => {
  let st = pos({ W: ['a1'], B: ['g1'] });
  const shuttle = { 0: [['a1', 'b2'], ['b2', 'a1']], 1: [['g1', 'h2'], ['h2', 'g1']] };
  for (let k = 0; k < 30; k++) {
    const seat = st.current, mv = shuttle[seat][Math.floor(k / 2) % 2];
    const r = C.reduce(st, { type: 'move', seat, path: mv.map(sq) });
    assert.equal(r.ok, true, 'ход ' + k);
    st = r.state;
  }
  assert.equal(st.gameOver, true); assert.equal(st.reason, 'draw'); assert.equal(st.winner, -1);
});

test('чужой ход, неверные данные и ход не по правилам отклоняются', () => {
  const st = C.init([{ id: 'a' }, { id: 'b' }], { white: 0 });
  assert.equal(C.reduce(st, { type: 'move', seat: 1, path: [sq('b6'), sq('a5')] }).error, 'not-your-turn');
  assert.equal(C.reduce(st, { type: 'move', seat: 0, path: [sq('c3'), sq('c4')] }).error, 'illegal');
  assert.equal(C.reduce(st, { type: 'move', seat: 0, path: 'x' }).error, 'bad-move');
  assert.equal(C.reduce(st, { type: 'fly', seat: 0 }).error, 'unknown-action');
  assert.deepEqual(plain(C.cleanAction({ type: 'move', path: ['1', 2, 3.7], x: 1 })), { type: 'move', path: [1, 2, 3] });
});

test('много случайных партий: фигур не прибавляется, ходы законны, партии заканчиваются', () => {
  let seed = 7; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let g = 0; g < 60; g++) {
    let st = C.init([{ id: 'a' }, { id: 'b' }], {}, rng), n = 0;
    while (!st.gameOver && n < 400) {
      const list = C.legalMoves(st), mv = list[Math.floor(rng() * list.length)];
      const before = st.board.filter((p) => p).length;
      const r = C.reduce(st, { type: 'move', seat: st.current, path: mv.path });
      assert.equal(r.ok, true);
      assert.equal(r.state.board.filter((p) => p).length, before - mv.captured.length);
      st = r.state; n++;
    }
    assert.ok(st.gameOver || n === 400);
  }
});

test('пограничные случаи: две шашки подряд не бьются, через свою не прыгнуть, простая назад без взятия не ходит', () => {
  assert.deepEqual(moves(pos({ W: ['a1'], b: ['c3', 'd4'], B: ['h8'] })).filter((m) => m.includes(':')), [], 'дамка не бьёт две шашки подряд');
  assert.deepEqual(moves(pos({ w: ['c3'], b: ['d4', 'e5'] })).filter((m) => m.includes(':')), [], 'простая тоже');
  assert.ok(!moves(pos({ w: ['c3', 'd4'], b: ['h8'] })).some((m) => m.startsWith('c3:')), 'через свою не прыгают');
  assert.deepEqual(moves(pos({ w: ['d4'], b: ['h8'] })), ['d4-c5', 'd4-e5'], 'назад без взятия нельзя');
});

test('шашка, взятием дошедшая до последнего ряда без продолжения, становится дамкой и ход заканчивается', () => {
  const st = pos({ w: ['c7'], b: ['d8', 'b8', 'h2'] });
  // c7 не бьёт (за d8 и b8 нет клеток) — просто ходов-взятий нет; проверим взятие на последний ряд
  const st2 = pos({ w: ['e6'], b: ['d7', 'h2'] });
  const r = C.reduce(st2, { type: 'move', seat: 0, path: [sq('e6'), sq('c8')] });
  assert.equal(r.ok, true);
  assert.equal(r.state.board[sq('c8')], 2);
  assert.equal(r.state.current, 1);
  assert.ok(st);
});
