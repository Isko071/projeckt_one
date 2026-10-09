// Запуск: node --test games/poker-simple/tests/texts.test.js
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
const dict = load(['locales/ru.js', 'games/poker-simple/ru.js']).LOCALES.ru;
const ui = fs.readFileSync(path.join(gameDir, 'ui.js'), 'utf8');
const PREFIX = 'games.poker-simple.';

test('словарь игры: все ключи, которые использует ui.js, существуют', () => {
  const keys = new Set();
  ui.replace(/\btr\('([\w.]+)'\s*[,)]/g, (m, k) => { keys.add(k); return m; });
  assert.ok(keys.size > 60, 'ключей найдено слишком мало: ' + keys.size);
  keys.forEach((k) => assert.ok((PREFIX + k) in dict, 'нет в словаре: ' + PREFIX + k));
});

test('словарь игры: динамические ключи (комбинации, масти, шаги правил, статусы круга) на месте', () => {
  ['royalFlush', 'straightFlush', 'quads', 'fullHouse', 'flush', 'straight', 'trips', 'twoPair', 'pair', 'high'].forEach((k) => assert.ok(dict[PREFIX + 'hand.' + k], 'hand.' + k));
  ['S', 'H', 'D', 'C'].forEach((k) => assert.ok(dict[PREFIX + 'suit.' + k], 'suit.' + k));
  [1, 2, 3, 4, 5].forEach((k) => assert.ok(dict[PREFIX + 'rules.step' + k], 'rules.step' + k));
  ['pre', 'flop', 'turn', 'river', 'show', 'wait'].forEach((k) => assert.ok(dict[PREFIX + 'round.' + k], 'round.' + k));
  assert.ok(dict['wallet.src.poker-simple'] && dict['games.poker-simple.title'] && dict['games.poker-simple.description'] && dict['theme.toLight'] && dict['theme.toDark']);
});

test('названия комбинаций совпадают с теми, что отдаёт логика покера', () => {
  const ctx = load(['games/poker/logic.js']);
  Array.from(ctx.Poker.HAND_NAMES).concat(['royalFlush']).forEach((k) => assert.ok(dict[PREFIX + 'hand.' + k], 'hand.' + k));
});

test('в коде интерфейса нет вшитых русских строк (всё через словарь)', () => {
  const withoutComments = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  const found = withoutComments.match(/[А-Яа-яЁё]+/g);
  assert.equal(found, null, 'русские слова в коде: ' + (found || []).slice(0, 5).join(', '));
});
