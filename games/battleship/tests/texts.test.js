// Запуск: node --test games/battleship/tests/texts.test.js
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
const dict = load(['locales/ru.js', 'games/battleship/ru.js']).LOCALES.ru;
const ui = fs.readFileSync(path.join(gameDir, 'ui.js'), 'utf8');
const PREFIX = 'games.battleship.';

test('словарь игры: все ключи, которые использует ui.js, существуют', () => {
  const keys = new Set();
  ui.replace(/\btr\('([\w.]+)'\s*[,)]/g, (m, k) => { keys.add(k); return m; });
  assert.ok(keys.size > 30, 'ключей найдено слишком мало: ' + keys.size);
  keys.forEach((k) => assert.ok((PREFIX + k) in dict, 'нет в словаре: ' + PREFIX + k));
});

test('словарь игры: динамические ключи (результат выстрела, итог, шаги правил, подписи полей) на месте', () => {
  ['miss', 'hit', 'sunk'].forEach((k) => assert.ok(dict[PREFIX + 'res.' + k], 'res.' + k));
  ['win.fleet', 'lose.fleet', 'win.concede', 'lose.concede'].forEach((k) => assert.ok(dict[PREFIX + 'over.' + k], 'over.' + k));
  [1, 2, 3, 4, 5, 6, 7].forEach((k) => assert.ok(dict[PREFIX + 'rules.step' + k], 'rules.step' + k));
  ['shoot', 'radar', 'sub', 'bomber'].forEach((k) => assert.ok(dict[PREFIX + 'fire.' + k] && dict[PREFIX + 'w.' + k], 'w/fire ' + k));
  ['radar', 'sub', 'bomber'].forEach((k) => assert.ok(dict[PREFIX + 'w.' + k + '.d'], 'w.' + k + '.d'));
  assert.equal(dict[PREFIX + 'letters'].length, 10, 'подписи строк поля: 10 букв');
  assert.ok(dict['theme.toLight'] && dict['theme.toDark']);
});

test('причины окончания партии из логики есть в словаре', () => {
  const B = load(['games/battleship/logic.js']).Battleship;
  const st = B.init([{ id: 'a' }, { id: 'b' }], { first: 0 });
  const r = B.reduce(st, { type: 'concede', seat: 0 });
  assert.ok(dict[PREFIX + 'over.win.' + r.state.reason] && dict[PREFIX + 'over.lose.' + r.state.reason]);
  assert.ok(dict[PREFIX + 'over.win.fleet'] && dict[PREFIX + 'over.lose.fleet']);
});

test('в коде интерфейса нет вшитых русских строк (всё через словарь)', () => {
  const withoutComments = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  const found = withoutComments.match(/[А-Яа-яЁё]+/g);
  assert.equal(found, null, 'русские слова в коде: ' + (found || []).slice(0, 5).join(', '));
});
