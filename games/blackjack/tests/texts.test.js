// Запуск: node --test games/blackjack/tests/texts.test.js
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
const dict = load(['locales/ru.js', 'games/blackjack/ru.js']).LOCALES.ru;
const ui = fs.readFileSync(path.join(gameDir, 'ui.js'), 'utf8');
const PREFIX = 'games.blackjack.';

test('словарь игры: все ключи, которые использует ui.js, существуют', () => {
  const keys = new Set();
  ui.replace(/\btr\('([\w.]+)'\s*[,)]/g, (m, k) => { keys.add(k); return m; });
  assert.ok(keys.size > 80, 'ключей найдено слишком мало: ' + keys.size);
  keys.forEach((k) => assert.ok((PREFIX + k) in dict, 'нет в словаре: ' + PREFIX + k));
});

test('словарь игры: динамические ключи (результаты, статусы, ошибки, правила, масти) на месте', () => {
  ['win', 'bj', 'push', 'lose', 'bust', 'dealerBj'].forEach((k) => assert.ok(dict[PREFIX + 'res.' + k], 'res.' + k));
  ['notFound', 'full', 'closed', 'denied', 'network', 'other'].forEach((k) => { assert.ok(dict[PREFIX + 'err.' + k]); assert.ok(dict[PREFIX + 'err.' + k + 'Text']); });
  ['goal', 'cards', 'turn', 'pay', 'dealer'].forEach((k) => { assert.ok(dict[PREFIX + 'rules.' + k + '.title']); assert.ok(dict[PREFIX + 'rules.' + k + '.text']); });
  ['s', 'c', 'h', 'd'].forEach((k) => assert.ok(dict[PREFIX + 'suit.' + k]));
  ['error', 'unsupported', 'domain', 'popup'].forEach((k) => assert.ok(dict[PREFIX + 'login.' + k], 'login.' + k));
  assert.ok(dict['wallet.src.blackjack'] && dict['theme.toLight'] && dict['theme.toDark'] && dict['games.blackjack.title']);
  ['confirmCatalog', 'confirmTable', 'confirmClose'].forEach((k) => { assert.ok(dict[PREFIX + k + '.title']); assert.ok(dict[PREFIX + k + '.text']); });
});

test('в коде интерфейса нет вшитых русских строк (всё через словарь)', () => {
  const withoutComments = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  const found = withoutComments.match(/[А-Яа-яЁё]+/g);
  assert.equal(found, null, 'русские слова в коде: ' + (found || []).slice(0, 5).join(', '));
});

test('на экранах нет пометок про виртуальные аконы и реальные деньги (решение владельца)', () => {
  const all = Object.keys(dict).filter((k) => k.startsWith(PREFIX)).map((k) => dict[k]).join(' ').toLowerCase();
  assert.ok(!/реальн|виртуальн/.test(all), 'в словаре игры есть пометка про деньги');
  const wallet = dict['wallet.note'];
  assert.equal(wallet, undefined);
});

test('параметры в текстах словаря заданы корректно ({имя} из латиницы)', () => {
  Object.keys(dict).filter((k) => k.startsWith(PREFIX)).forEach((k) => {
    (dict[k].match(/\{[^}]*\}/g) || []).forEach((p) => assert.match(p, /^\{[a-z]+\}$/, k + ': ' + p));
  });
});
