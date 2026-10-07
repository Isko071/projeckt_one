// Запуск: node --test tests/catalog.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
function load(files) {
  const context = vm.createContext({});
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f }));
  return context;
}

const ctx = load(['locales/ru.js', 'games/games.js', 'catalog/logic.js']);
const L = ctx.CatalogLogic;
const GAMES = ctx.GAMES;
const DICT = ctx.LOCALES.ru;

test('реестр: все обязательные поля заполнены, id уникальны', () => {
  assert.deepEqual(Array.from(L.validateRegistry(GAMES)), []);
  assert.ok(GAMES.length >= 1);
});

test('реестр: файлы обложек и страниц игр существуют', () => {
  GAMES.forEach((g) => {
    assert.ok(fs.existsSync(path.join(root, g.cover)), 'нет обложки: ' + g.cover);
    if (g.status === 'available') {
      assert.ok(fs.existsSync(path.join(root, L.playHref(g))), 'нет страницы игры: ' + L.playHref(g));
    }
  });
});

test('реестр: названия и описания есть в словаре', () => {
  GAMES.forEach((g) => {
    assert.ok(DICT[g.titleKey], 'нет в словаре: ' + g.titleKey);
    assert.ok(DICT[g.descriptionKey], 'нет в словаре: ' + g.descriptionKey);
  });
});

test('реестр: у готовых игр папка называется как id', () => {
  GAMES.filter((g) => g.status === 'available').forEach((g) => {
    assert.equal(g.path, 'games/' + g.id + '/');
  });
});

test('словарь: ключи, используемые в catalog.js и страницах игр, существуют', () => {
  const files = ['catalog/catalog.js', 'catalog/profile-ui.js', 'shared/profile.js', 'index.html', 'games/yahtzee/index.html'];
  const keys = new Set();
  files.forEach((f) => {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    text.replace(/\bt\('([\w.]+)'\)/g, (m, k) => { keys.add(k); return m; });
    text.replace(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g, (m, k) => { keys.add(k); return m; });
  });
  assert.ok(keys.size > 5);
  keys.forEach((k) => assert.ok(k in DICT, 'нет в словаре: ' + k));
});

test('проверка реестра находит ошибки', () => {
  const bad = [
    { id: 'a', status: 'available', path: 'p/', cover: 'c', titleKey: 't', descriptionKey: 'd' },
    { id: 'a', status: 'broken', path: 'p/', cover: 'c', titleKey: 't', descriptionKey: 'd' },
    { id: 'Плохой id', status: 'soon', path: 'p/', cover: '', titleKey: 't', descriptionKey: 'd' }
  ];
  const problems = Array.from(L.validateRegistry(bad)).join('\n');
  assert.match(problems, /повторяется id/);
  assert.match(problems, /неизвестный status/);
  assert.match(problems, /нет поля cover/);
  assert.match(problems, /id должен быть/);
  assert.deepEqual(Array.from(L.validateRegistry([])), ['реестр пуст или не массив']);
});

test('адрес: выбранная игра берётся из хеша, неизвестное — null', () => {
  assert.equal(L.idFromHash('#yahtzee', GAMES), 'yahtzee');
  assert.equal(L.idFromHash('yahtzee', GAMES), 'yahtzee');
  assert.equal(L.idFromHash('#нет-такой', GAMES), null);
  assert.equal(L.idFromHash('', GAMES), null);
  assert.equal(L.idFromHash('#%E0%A4%A', GAMES), null, 'битая кодировка не ломает');
  assert.equal(L.idFromHash(undefined, GAMES), null);
});

test('адрес: хеш из идентификатора и обратно', () => {
  assert.equal(L.hashForId('poker'), '#poker');
  assert.equal(L.hashForId(null), '');
  GAMES.forEach((g) => assert.equal(L.idFromHash(L.hashForId(g.id), GAMES), g.id));
});

test('игра доступна только со статусом available; адрес страницы с index.html', () => {
  assert.equal(L.isPlayable({ status: 'available' }), true);
  assert.equal(L.isPlayable({ status: 'soon' }), false);
  assert.equal(L.isPlayable(null), false);
  assert.equal(L.playHref({ path: 'games/yahtzee/' }), 'games/yahtzee/index.html');
  assert.equal(L.playHref({ path: 'games/yahtzee' }), 'games/yahtzee/index.html');
});

test('findGame ищет по id', () => {
  assert.equal(L.findGame(GAMES, 'poker').id, 'poker');
  assert.equal(L.findGame(GAMES, 'нет'), null);
});
