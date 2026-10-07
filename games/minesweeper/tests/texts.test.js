// Запуск: node --test games/minesweeper/tests/texts.test.js
// Проверяет словарь игры и отсутствие вшитых русских строк в интерфейсе.
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

const dict = load(['locales/ru.js', 'games/minesweeper/ru.js']).LOCALES.ru;
const M = load(['games/minesweeper/logic.js']).Minesweeper;
const ui = fs.readFileSync(path.join(gameDir, 'ui.js'), 'utf8');
const PREFIX = 'games.minesweeper.';

test('словарь игры: все ключи, которые использует ui.js, существуют', () => {
  const keys = new Set();
  ui.replace(/\btr\('([\w.]+)'\s*[,)]/g, (m, k) => { keys.add(k); return m; });
  assert.ok(keys.size > 30, 'ключей найдено слишком мало: ' + keys.size);
  keys.forEach((k) => assert.ok((PREFIX + k) in dict, 'нет в словаре: ' + PREFIX + k));
});

test('словарь игры: сложности, правила, подсказки и состояния клеток на месте', () => {
  M.LEVEL_IDS.forEach((id) => assert.ok(dict[PREFIX + 'level.' + id], 'нет сложности ' + id));
  ['goal', 'digits', 'flags', 'controls', 'first'].forEach((b) => {
    assert.ok(dict[PREFIX + 'rules.' + b + '.title'], 'нет заголовка правил ' + b);
    assert.ok(dict[PREFIX + 'rules.' + b + '.text'], 'нет текста правил ' + b);
  });
  [1, 2, 3, 4, 5].forEach((k) => assert.ok(dict[PREFIX + 'hint.key' + k]));
  ['closed', 'flag', 'zero', 'mine', 'boom', 'wrong'].forEach((s) => assert.ok(dict[PREFIX + 'cell.' + s]));
  assert.ok(dict['games.minesweeper.title']);
  assert.ok(dict['theme.toLight'] && dict['theme.toDark']);
});

test('в коде интерфейса нет вшитых русских строк (всё через словарь)', () => {
  const withoutComments = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  const found = withoutComments.match(/[А-Яа-яЁё]+/g);
  assert.equal(found, null, 'русские слова в коде: ' + (found || []).slice(0, 5).join(', '));
});

test('в логике игры нет обращений к браузеру', () => {
  const logic = fs.readFileSync(path.join(gameDir, 'logic.js'), 'utf8');
  assert.doesNotMatch(logic.replace(/\/\/.*$/gm, ''), /\b(window|document|localStorage)\b/);
});

test('параметры в текстах словаря заданы корректно', () => {
  Object.keys(dict).filter((k) => k.startsWith(PREFIX)).forEach((k) => {
    (dict[k].match(/\{[^}]*\}/g) || []).forEach((p) => assert.match(p, /^\{[a-z]+\}$/, k + ': ' + p));
  });
});
