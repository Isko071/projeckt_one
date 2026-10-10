// Каждая игра, где создаётся чат (PlatformChatUI.create), обязана передавать ему вид стола через chat.update(...):
// иначе отправленные сообщения не опознаются в журнале и показываются дважды, одно из них с ошибкой «Не отправлено».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
function files(dir) {
  const out = [];
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((e) => {
    if (e.isDirectory()) { if (e.name !== 'tests' && e.name !== 'node_modules') files(path.join(dir, e.name)).forEach((f) => out.push(f)); }
    else if (e.name.endsWith('.js')) out.push(path.join(dir, e.name));
  });
  return out;
}

test('игры с чатом вызывают chat.update(...) при каждом новом виде стола', () => {
  const withChat = files('games').filter((f) => /PlatformChatUI\.create\(/.test(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.ok(withChat.length >= 4, 'игр с чатом: ' + withChat.join(', '));
  withChat.forEach((f) => assert.ok(/\bchat\.update\(/.test(fs.readFileSync(path.join(root, f), 'utf8')), f + ': нет chat.update(...)'));
});
