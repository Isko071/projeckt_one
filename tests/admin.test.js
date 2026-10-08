// Запуск: node --test tests/admin.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ JSON, Date, Object, Array, Number, String });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'admin', 'logic.js'), 'utf8'), ctx);
const L = ctx.AdminLogic;
const plain = (x) => JSON.parse(JSON.stringify(x));
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0), DAY = 24 * 3600 * 1000;

function doc(uid, o) {
  const snap = { v: 1, data: { 'platform:profile': { name: o.name }, 'platform:wallet': { balance: o.balance, plays: o.plays } } };
  const f = { data: { stringValue: JSON.stringify(snap) }, updatedAt: { integerValue: String(o.updatedAt || 0) } };
  if (o.createdAt) f.createdAt = { integerValue: String(o.createdAt) };
  if (o.lastSeen) f.lastSeen = { integerValue: String(o.lastSeen) };
  return { document: { name: 'projects/p/databases/(default)/documents/users/' + uid, fields: f } };
}

test('запись игрока разбирается: ник, баланс, партии, даты', () => {
  const r = L.parseQuery([doc('abc123', { name: 'Аня', balance: 7500, plays: { yahtzee: 3, blackjack: 4 }, createdAt: NOW - DAY, lastSeen: NOW - 1000 })])[0];
  assert.deepEqual(plain(r), { uid: 'abc123', name: 'Аня', balance: 7500, streak: 0, createdAt: NOW - DAY, lastSeen: NOW - 1000, plays: { yahtzee: 3, minesweeper: 0, blackjack: 4 }, total: 7 });
});

test('старая запись без новых полей: визит берётся из updatedAt, регистрации нет', () => {
  const r = L.parseQuery([doc('old', { name: 'Боря', balance: 100, updatedAt: NOW - 5 * DAY })])[0];
  assert.equal(r.createdAt, 0);
  assert.equal(r.lastSeen, NOW - 5 * DAY);
  assert.equal(r.total, 0);
});

test('повреждённые данные не ломают разбор', () => {
  const bad = { document: { name: 'x/users/u9', fields: { data: { stringValue: '{не json' } } } };
  const r = L.parseQuery([bad, null, {}, { document: { name: 'x/users/u8', fields: { data: { stringValue: JSON.stringify({ data: { 'platform:wallet': { balance: -5, plays: { yahtzee: 'много' } } } }) } } } }]);
  assert.equal(r.length, 2);
  assert.equal(r[0].name, '');
  assert.equal(r[1].balance, 0);
  assert.equal(r[1].plays.yahtzee, 0);
  assert.deepEqual(plain(L.parseQuery(null)), []);
});

test('итоги: активные и новые за сутки и неделю, партии по играм', () => {
  const rows = L.parseQuery([
    doc('a', { name: 'А', balance: 1, plays: { yahtzee: 2 }, createdAt: NOW - 3600000, lastSeen: NOW - 60000 }),
    doc('b', { name: 'Б', balance: 1, plays: { minesweeper: 5, blackjack: 1 }, createdAt: NOW - 3 * DAY, lastSeen: NOW - 3 * DAY }),
    doc('c', { name: 'В', balance: 1, plays: {}, createdAt: NOW - 30 * DAY, lastSeen: NOW - 30 * DAY })
  ]);
  assert.deepEqual(plain(L.summary(rows, NOW)), { players: 3, activeToday: 1, active7: 2, newToday: 1, new7: 2, plays: { yahtzee: 2, minesweeper: 5, blackjack: 1 }, total: 8 });
});

test('поиск по нику и коду, сортировка по колонкам', () => {
  const rows = L.parseQuery([
    doc('u1', { name: 'Анна', balance: 300, plays: { yahtzee: 1 }, lastSeen: NOW - 2 }),
    doc('u2', { name: 'Борис', balance: 100, plays: { yahtzee: 9 }, lastSeen: NOW - 1 }),
    doc('u3', { name: 'аня', balance: 200, plays: {}, lastSeen: NOW - 3 })
  ]);
  assert.deepEqual(plain(L.filterRows(rows, 'ан').map((r) => r.uid)), ['u1', 'u3']);
  assert.deepEqual(L.filterRows(rows, 'U2').map((r) => r.uid), ['u2']);
  assert.equal(L.filterRows(rows, '').length, 3);
  assert.deepEqual(L.sortRows(rows, 'balance', 'desc').map((r) => r.uid), ['u1', 'u3', 'u2']);
  assert.deepEqual(L.sortRows(rows, 'yahtzee', 'desc').map((r) => r.uid), ['u2', 'u1', 'u3']);
  assert.deepEqual(L.sortRows(rows, 'name', 'asc').map((r) => r.uid), ['u1', 'u3', 'u2']);
  assert.deepEqual(L.sortRows(rows, 'lastSeen', 'desc').map((r) => r.uid), ['u2', 'u1', 'u3']);
});
