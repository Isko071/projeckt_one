// Запуск: node --test tests/chat-logic.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ Array, String, Object, Math, JSON, Number });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'chat-logic.js'), 'utf8'), ctx, { filename: 'chat-logic.js' });
const C = ctx.PlatformChat;
const plain = (x) => JSON.parse(JSON.stringify(x));

test('очистка текста: пробелы, переносы и невидимые символы', () => {
  assert.equal(C.clean('  Привет,   мир \n\n  '), 'Привет, мир');
  assert.equal(C.clean('a\tb\r\nc'), 'a b c');
  assert.equal(C.clean('a' + String.fromCharCode(0) + 'b' + String.fromCharCode(0x200B) + 'c' + String.fromCharCode(0x202E) + 'd'), 'abcd');
  assert.equal(C.clean('   '), '');
  assert.equal(C.clean(null), '');
  assert.equal(C.clean(undefined), '');
  assert.equal(C.clean(12345), '12345');
});

test('очистка текста: не длиннее 200 символов, эмодзи не рвутся пополам', () => {
  assert.equal(C.clean('а'.repeat(500)).length, 200);
  const emoji = '😀'.repeat(300);
  const cut = C.clean(emoji);
  assert.equal(Array.from(cut).length, 200);
  assert.ok(!/[\uD800-\uDBFF]$/.test(cut), 'нет оборванной суррогатной пары');
  assert.equal(C.clean('x'.repeat(199) + ' ' + 'y'.repeat(10)), 'x'.repeat(199));
});

test('очистка текста: разметка остаётся обычным текстом (экранирует интерфейс)', () => {
  assert.equal(C.clean('<b>привет</b> & "ку"'), '<b>привет</b> & "ку"');
});

test('журнал: последние 20, id растут без пропусков', () => {
  const log = C.createLog();
  for (let i = 1; i <= 25; i++) log.add({ kind: 'msg', text: 'm' + i });
  const list = log.list();
  assert.equal(list.length, 20);
  assert.equal(list[0].text, 'm6');
  assert.equal(list[19].id, 25);
  assert.equal(log.last(), 25);
  list.push({ id: 999 });
  assert.equal(log.list().length, 20, 'список наружу копией');
  assert.deepEqual(plain(C.createLog({ keep: 2 }).add({ kind: 'sys', code: 'join' })), { kind: 'sys', code: 'join', id: 1 });
});

test('ограничение частоты: не чаще 0,8 с и не больше 20 в минуту, у каждого игрока своё', () => {
  const lim = C.createLimiter();
  assert.equal(lim.allow('a', 1000), true);
  assert.equal(lim.allow('a', 1500), false, 'через 0,5 с нельзя');
  assert.equal(lim.allow('b', 1500), true, 'другому игроку можно');
  assert.equal(lim.allow('a', 1800), true, 'через 0,8 с можно');
  let t = 3000, ok = 0;
  for (let i = 0; i < 40; i++) { if (lim.allow('c', t)) ok++; t += 850; }
  assert.ok(ok <= 20 && ok >= 19, 'в минуту не больше 20: ' + ok);
  assert.equal(lim.allow('c', t + 60000), true, 'через минуту снова можно');
});
