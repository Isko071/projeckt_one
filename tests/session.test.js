// Запуск: node --test tests/session.test.js
// Проверяет каркас сессии (shared/game-session.js) и действия «Ятзи» (games/yahtzee/actions.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(read('shared/game-session.js'), ctx);
vm.runInContext(read('games/yahtzee/logic.js') + '\n' + read('games/yahtzee/actions.js') + '\nthis.Yahtzee = Yahtzee;', ctx);
const S = ctx.PlatformSession, Y = ctx.Yahtzee;
const plain = (x) => JSON.parse(JSON.stringify(x));

const seats = [{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Боря', kind: 'remote' }];
const yahtzeeGame = { init: (s) => Y.createGame(s.map((x) => x.name)), reduce: Y.reduce, view: Y.view };

test('генератор: один seed — одна последовательность, разные seed — разные', () => {
  const a = S.createRng(7), b = S.createRng(7), c = S.createRng(8);
  const xs = [a(), a(), a()], ys = [b(), b(), b()], zs = [c(), c(), c()];
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, zs);
  xs.forEach((x) => assert.ok(x >= 0 && x < 1));
});

test('ятзи: действие чужого игрока отклоняется, состояние не меняется', () => {
  const s = S.create({ game: yahtzeeGame, seats, seed: 1 });
  const before = plain(s.getState());
  assert.deepEqual(plain(s.dispatch({ type: 'roll', seat: 1 })), { ok: false, error: 'not-your-turn' });
  assert.deepEqual(plain(s.getState()), before);
  assert.equal(s.getLog().length, 0);
});

test('ятзи: некорректные действия отклоняются с причиной', () => {
  const s = S.create({ game: yahtzeeGame, seats, seed: 1 });
  assert.equal(s.dispatch({ type: 'score', seat: 0, category: 'chance' }).error, 'cannot-score', 'до броска писать нельзя');
  assert.equal(s.dispatch({ type: 'toggleHold', seat: 0, index: 0 }).error, 'cannot-hold');
  assert.equal(s.dispatch({ type: 'dance', seat: 0 }).error, 'unknown-action');
  assert.equal(s.dispatch(null).error, 'bad-action');
  assert.equal(s.dispatch({ type: 'roll', seat: 0 }).ok, true);
  assert.equal(s.dispatch({ type: 'toggleHold', seat: 0, index: 9 }).error, 'cannot-hold');
  assert.equal(s.dispatch({ type: 'toggleHold', seat: 0, index: 1.5 }).error, 'cannot-hold');
  assert.equal(s.dispatch({ type: 'score', seat: 0, category: 'nope' }).error, 'cannot-score');
});

test('ятзи: reduce не меняет исходное состояние', () => {
  const state = Y.createGame(['a', 'b']);
  const frozen = plain(state);
  const res = Y.reduce(state, { type: 'roll', seat: 0 }, S.createRng(3));
  assert.equal(res.ok, true);
  assert.deepEqual(plain(state), frozen);
  assert.equal(res.state.rollsUsed, 1);
  assert.equal(res.events[0].type, 'rolled');
});

// Полная партия двух игроков по действиям: каждый бросает, фиксирует, пишет в первую допустимую клетку
function playAll(session) {
  let guard = 0;
  while (!session.getState().gameOver && guard++ < 500) {
    const st = session.getState(), seat = st.current, player = st.players[seat];
    session.dispatch({ type: 'roll', seat });
    session.dispatch({ type: 'toggleHold', seat, index: 0 });
    session.dispatch({ type: 'roll', seat });
    const cat = Y.allowedCategories(player, session.getState().dice)[0];
    assert.equal(session.dispatch({ type: 'score', seat, category: cat }).ok, true);
  }
}

test('ятзи: полная партия по действиям доходит до конца (26 записей)', () => {
  const s = S.create({ game: yahtzeeGame, seats, seed: 42 });
  playAll(s);
  assert.equal(s.getState().gameOver, true);
  assert.equal(s.getState().players.every(Y.isPlayerDone), true);
  assert.equal(s.getLog().filter((a) => a.type === 'score').length, 26);
});

test('повтор: тот же seed и журнал дают ту же партию (основа честной сетевой игры)', () => {
  const a = S.create({ game: yahtzeeGame, seats, seed: 42 });
  playAll(a);
  const r = S.replay({ game: yahtzeeGame, seats, seed: 42 }, a.getLog());
  assert.equal(r.ok, true);
  assert.deepEqual(plain(r.session.getState()), plain(a.getState()));
  const other = S.replay({ game: yahtzeeGame, seats, seed: 43 }, a.getLog());
  assert.notDeepEqual(plain(other.session ? other.session.getState() : null), plain(a.getState()));
});

test('транспорт: действия уходят наружу, чужие применяются и не отправляются обратно', () => {
  const sent = [];
  let incoming = null;
  const transport = { send: (e) => sent.push(e), onRemote: (fn) => { incoming = fn; } };
  const s = S.create({ game: yahtzeeGame, seats, seed: 5, transport });
  s.dispatch({ type: 'roll', seat: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].index, 0);
  incoming({ action: { type: 'toggleHold', seat: 0, index: 2 } });
  assert.equal(s.getState().held[2], true);
  assert.equal(sent.length, 1, 'удалённое действие не пересылается обратно');
  assert.equal(s.getLog().length, 2);
});

test('подписчики получают состояние и события; сломанный не мешает; можно отписаться', () => {
  const s = S.create({ game: yahtzeeGame, seats, seed: 9 });
  const seen = [];
  s.subscribe(() => { throw new Error('boom'); });
  const off = s.subscribe((st, events) => seen.push(events[0].type));
  s.dispatch({ type: 'roll', seat: 0 });
  off();
  s.dispatch({ type: 'toggleHold', seat: 0, index: 0 });
  assert.deepEqual(seen, ['rolled']);
});

test('места за столом: нормализация и значения по умолчанию', () => {
  const s = S.create({ game: yahtzeeGame, seats: [{ name: 'А' }, { id: 7, name: 'Б', kind: 'cpu' }, { name: 'В', kind: 'что-то' }], seed: 1 });
  assert.deepEqual(plain(s.seats.map((x) => [x.id, x.kind])), [['seat0', 'human'], ['7', 'cpu'], ['seat2', 'human']]);
});

test('скрытая информация: view отдаёт каждому месту только его данные', () => {
  const hidden = {
    init: () => ({ hands: [['A', 'K'], ['2', '3']] }),
    reduce: (st) => ({ ok: true, state: st, events: [] }),
    view: (st, seat) => ({ hands: st.hands.map((h, i) => (i === seat ? h : h.map(() => '?'))) })
  };
  const s = S.create({ game: hidden, seats: [{}, {}], seed: 1 });
  assert.deepEqual(plain(s.viewFor(0).hands), [['A', 'K'], ['?', '?']]);
  assert.deepEqual(plain(s.viewFor(1).hands), [['?', '?'], ['2', '3']]);
});
