// Запуск: node --test tests/rating.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ Math, JSON, Object, Array, Number, String, Date, Promise, isFinite, encodeURIComponent });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'rating.js'), 'utf8'), ctx);
const R = ctx.PlatformRating;
const plain = (x) => JSON.parse(JSON.stringify(x));

test('строка рейтинга очищается: имя до 20 символов, аватар и баланс — целые числа не меньше нуля', () => {
  assert.deepEqual(plain(R.rowFields({ name: '  Аня   Иванова-Петрова-Сидорова-Кузнецова ', avatar: 3, icon: '🦊' }, 7500.9)), { name: 'Аня Иванова-Петрова-', avatar: 3, icon: '🦊', balance: 7500 });
  assert.deepEqual(plain(R.rowFields({ name: 'x', avatar: -2 }, -50)), { name: 'x', avatar: 0, icon: '', balance: 0 });
  assert.deepEqual(plain(R.rowFields(null, 'abc')), { name: '', avatar: 0, icon: '', balance: 0 });
  assert.equal(R.rowFields({ name: 'a' }, 1e15).balance, 1000000000);
});

test('отпечаток меняется вместе с именем, аватаром и балансом', () => {
  const a = R.fingerprint({ name: 'Аня', avatar: 1 }, 5000);
  assert.equal(a, R.fingerprint({ name: 'Аня', avatar: 1 }, 5000));
  [R.fingerprint({ name: 'Аня', avatar: 2 }, 5000), R.fingerprint({ name: 'Аня', avatar: 1 }, 5001), R.fingerprint({ name: 'Аля', avatar: 1 }, 5000), R.fingerprint({ name: 'Аня', avatar: 1, icon: '🐼' }, 5000)].forEach((x) => assert.notEqual(x, a));
});

test('публикация своей строки и топ по балансу: запросы и разбор ответа', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (/runQuery/.test(url)) return { ok: true, status: 200, json: async () => [
      { document: { name: 'projects/p/databases/d/documents/ratings/u1', fields: { name: { stringValue: 'Аня' }, avatar: { integerValue: '2' }, icon: { stringValue: '' }, balance: { integerValue: '9000' } } } },
      { document: { name: 'projects/p/databases/d/documents/ratings/u2', fields: { name: { stringValue: 'Боря' }, avatar: { integerValue: '1' }, icon: { stringValue: '🐼' }, balance: { integerValue: '8000' } } } },
      { readTime: 'x' }
    ] };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const api = R.create({ fetch: fakeFetch, projectId: 'p', db: 'd' });
  await api.publish('tok', 'u 1', { name: 'Аня', avatar: 2 }, 9000);
  assert.match(calls[0].url, /documents\/ratings\/u%201$/);
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(JSON.parse(calls[0].init.body).fields.balance.integerValue, '9000');
  const top = await api.top('tok', 20);
  assert.deepEqual(plain(top), [{ uid: 'u1', name: 'Аня', avatar: 2, icon: '', balance: 9000 }, { uid: 'u2', name: 'Боря', avatar: 1, icon: '🐼', balance: 8000 }]);
  const q = JSON.parse(calls[1].init.body).structuredQuery;
  assert.equal(q.orderBy[0].direction, 'DESCENDING'); assert.equal(q.orderBy[0].field.fieldPath, 'balance'); assert.equal(q.limit, 20);
});

test('нет доступа: ошибка denied; другая ошибка сервера: http-<код>', async () => {
  const mk = (status) => R.create({ fetch: async () => ({ ok: false, status, json: async () => ({}) }), projectId: 'p', db: 'd' });
  await assert.rejects(mk(403).top('t', 10), (e) => e.code === 'denied');
  await assert.rejects(mk(401).publish('t', 'u', {}, 1), (e) => e.code === 'denied');
  await assert.rejects(mk(500).top('t', 10), (e) => e.code === 'http-500');
});

test('победа онлайн: запись одним commit с прибавкой на единицу; топ игры по победам', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (/runQuery/.test(url)) return { ok: true, status: 200, json: async () => [{ document: { name: 'projects/p/databases/d/documents/ratings_wins/yahtzee/rows/u1', fields: { name: { stringValue: 'Аня' }, avatar: { integerValue: '2' }, icon: { stringValue: '' }, wins: { integerValue: '7' } } } }] };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const api = R.create({ fetch: fakeFetch, projectId: 'p', db: 'd' });
  await api.recordWin('tok', 'u1', { name: 'Аня', avatar: 2 }, 'yahtzee');
  assert.match(calls[0].url, /documents:commit$/);
  const w = JSON.parse(calls[0].init.body).writes;
  assert.equal(w[0].update.name, 'projects/p/databases/d/documents/ratings_wins/yahtzee/rows/u1');
  assert.deepEqual(plain(w[1].transform.fieldTransforms), [{ fieldPath: 'wins', increment: { integerValue: '1' } }]);
  const top = await api.topWins('tok', 'yahtzee', 5);
  assert.match(calls[1].url, /documents\/ratings_wins\/yahtzee:runQuery$/);
  assert.deepEqual(plain(top), [{ uid: 'u1', name: 'Аня', avatar: 2, icon: '', wins: 7 }]);
  assert.equal(JSON.parse(calls[1].init.body).structuredQuery.orderBy[0].field.fieldPath, 'wins');
  assert.deepEqual(plain(R.WIN_GAMES), ['yahtzee', 'blackjack', 'poker-simple', 'battleship']);
});
