// Запуск: node --test games/yahtzee/tests/texts.test.js
// Проверяет, что все надписи игры лежат в словаре, а в коде интерфейса нет вшитых русских строк.
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

const dict = load(['locales/ru.js', 'games/yahtzee/ru.js']).LOCALES.ru;
const Y = load(['games/yahtzee/logic.js']).Yahtzee;
const ui = ['ui.js', 'online.js'].map((f) => fs.readFileSync(path.join(gameDir, f), 'utf8')).join('\n');
const PREFIX = 'games.yahtzee.';

test('словарь игры: все ключи, которые использует ui.js, существуют', () => {
  const keys = new Set();
  ui.replace(/\btr\('([\w.]+)'\s*[,)]/g, (m, k) => { keys.add(k); return m; });
  assert.ok(keys.size > 40, 'ключей найдено слишком мало: ' + keys.size);
  keys.forEach((k) => assert.ok((PREFIX + k) in dict, 'нет в словаре: ' + PREFIX + k));
});

test('словарь игры: подписи всех 13 категорий и все блоки правил на месте', () => {
  Y.CATEGORIES.forEach((c) => assert.ok(dict[PREFIX + 'cat.' + c], 'нет подписи категории ' + c));
  assert.equal(Y.CATEGORIES.length, 13);
  ['turn', 'upper', 'lower', 'joker', 'total'].forEach((b) => {
    assert.ok(dict[PREFIX + 'rules.' + b + '.title'], 'нет заголовка правил ' + b);
    assert.ok(dict[PREFIX + 'rules.' + b + '.text'], 'нет текста правил ' + b);
  });
});

test('словарь игры: общие ключи платформы для кнопки темы существуют', () => {
  assert.ok(dict['theme.toLight']);
  assert.ok(dict['theme.toDark']);
});

test('в коде интерфейса нет вшитых русских строк (всё через словарь)', () => {
  const withoutComments = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  const found = withoutComments.match(/[А-Яа-яЁё]+/g);
  assert.equal(found, null, 'русские слова в коде: ' + (found || []).slice(0, 5).join(', '));
});

test('в логике игры нет обращений к браузеру', () => {
  ['logic.js', 'table.js'].forEach((f) => {
    const code = fs.readFileSync(path.join(gameDir, f), 'utf8');
    assert.doesNotMatch(code.replace(/\/\/.*$/gm, '').replace(/typeof window !== 'undefined' \? window : globalThis/, ''), /\b(window|document|localStorage)\b/, f);
  });
});

test('параметры в текстах словаря заданы корректно ({имя} из латиницы)', () => {
  Object.keys(dict).filter((k) => k.startsWith(PREFIX)).forEach((k) => {
    const params = dict[k].match(/\{[^}]*\}/g) || [];
    params.forEach((p) => assert.match(p, /^\{[a-z]+\}$/, 'странный параметр в ' + k + ': ' + p));
  });
});
