// Запуск: node --test games/mines/tests/texts.test.js
// Проверяет словарь игры и отсутствие вшитых русских строк в виджете.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const gameDir = path.join(__dirname, '..');
const rootDir = path.join(gameDir, '..', '..');
function load(files) {
  const ctx = vm.createContext({});
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(rootDir, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}
const dict = load(['locales/ru.js', 'games/mines/ru.js']).LOCALES.ru;
const ui = fs.readFileSync(path.join(gameDir, 'widget.js'), 'utf8');

test('словарь игры: все ключи tr(...) из widget.js существуют', () => {
  const keys = new Set();
  ui.replace(/\btr\('([\w.]+)'\s*[,)]/g, (m, k) => { keys.add(k); return m; });
  assert.ok(keys.size > 15, 'ключей найдено мало: ' + keys.size);
  keys.forEach((k) => assert.ok(('games.mines.' + k) in dict, 'нет в словаре: ' + k));
  [1, 2, 3, 4, 5].forEach((k) => assert.ok(dict['games.mines.rules.step' + k]));
  ['title', 'description'].forEach((k) => assert.ok(dict['games.mines.' + k], 'каталог: ' + k));
  assert.ok(dict['wallet.src.mines'] && dict['admin.col.mines']);
});

test('в коде интерфейса нет вшитых русских строк', () => {
  const clean = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  const found = clean.match(/[А-Яа-яЁё]+/g);
  assert.equal(found, null, 'русские слова в коде: ' + (found || []).slice(0, 5).join(', '));
});
