// Запуск: node --test tests/
// Общие модули подключаются так же, как в браузере, но в изолированном контексте vm.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
function load(files, ctx) {
  const context = vm.createContext(ctx || {});
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f }));
  return context;
}

// Поддельное хранилище
function fakeBackend() {
  const data = {};
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
}

test('хранилище: записывает и читает значения (JSON)', () => {
  const ctx = load(['shared/storage.js'], { localStorage: fakeBackend() });
  const s = ctx.PlatformStorage;
  assert.equal(s.set('platform:test', { a: 1, b: [2, 3] }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(s.get('platform:test', null))), { a: 1, b: [2, 3] });
  assert.equal(s.get('нет-такого', 'по умолчанию'), 'по умолчанию');
  assert.equal(s.remove('platform:test'), true);
  assert.equal(s.get('platform:test', 'пусто'), 'пусто');
});

test('хранилище: недоступный localStorage не ломает работу', () => {
  const ctx = load(['shared/storage.js'], {});
  Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('доступ запрещён'); } });
  const s = ctx.PlatformStorage;
  assert.equal(s.available(), false);
  assert.equal(s.set('k', 1), false);
  assert.equal(s.get('k', 'запасное'), 'запасное');
  assert.equal(s.remove('k'), false);
});

test('хранилище: запись падает (переполнение) — возвращает false', () => {
  const backend = fakeBackend();
  backend.setItem = () => { throw new Error('QuotaExceededError'); };
  const s = load(['shared/storage.js'], { localStorage: backend }).PlatformStorage;
  assert.equal(s.set('k', 1), false);
  assert.equal(s.available(), false);
});

test('хранилище: битый JSON не ломает чтение', () => {
  const backend = fakeBackend();
  backend.data.k = '{не json';
  const s = load(['shared/storage.js'], { localStorage: backend }).PlatformStorage;
  assert.equal(s.get('k', 'запасное'), 'запасное');
});

test('тема: явный выбор главнее системной настройки', () => {
  const T = load(['shared/storage.js', 'shared/theme.js'], { localStorage: fakeBackend() }).PlatformTheme;
  assert.equal(T.resolveDark(null, true), true);
  assert.equal(T.resolveDark(null, false), false);
  assert.equal(T.resolveDark('light', true), false);
  assert.equal(T.resolveDark('dark', false), true);
  assert.equal(T.resolveDark('мусор', true), true, 'неизвестное значение игнорируется');
});

test('тема: кнопка переключает на противоположную', () => {
  const T = load(['shared/storage.js', 'shared/theme.js'], { localStorage: fakeBackend() }).PlatformTheme;
  assert.equal(T.nextChoice(null, false), 'dark');
  assert.equal(T.nextChoice(null, true), 'light');
  assert.equal(T.nextChoice('dark', false), 'light');
  assert.equal(T.nextChoice('light', true), 'dark');
});

test('тема: выбор запоминается в platform:theme и сообщается подписчикам', () => {
  const backend = fakeBackend();
  const T = load(['shared/storage.js', 'shared/theme.js'], { localStorage: backend }).PlatformTheme;
  const seen = [];
  T.onChange((dark) => seen.push(dark));
  assert.equal(T.toggle(), 'dark');
  assert.equal(backend.data['platform:theme'], '"dark"');
  assert.equal(T.isDark(), true);
  assert.equal(T.toggle(), 'light');
  assert.deepEqual(seen, [true, false]);
});

test('тема: без хранилища выбор действует до перезагрузки', () => {
  const ctx = load([], {});
  Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('доступ запрещён'); } });
  vm.runInContext(fs.readFileSync(path.join(root, 'shared/storage.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'shared/theme.js'), 'utf8'), ctx);
  const T = ctx.PlatformTheme;
  assert.equal(T.isDark(), false);
  assert.equal(T.toggle(), 'dark');
  assert.equal(T.isDark(), true, 'выбор помнится в памяти страницы');
});

test('словарь и i18n: тексты берутся по ключам, нет ключа — сам ключ', () => {
  const ctx = load(['locales/ru.js', 'shared/i18n.js'], {});
  const { t } = ctx.I18n;
  assert.equal(t('platform.name'), 'Игротека');
  assert.equal(t('нет.такого.ключа'), 'нет.такого.ключа');
});

test('i18n: подстановка параметров и запасной русский язык', () => {
  const ctx = load(['shared/i18n.js'], {
    LOCALES: { ru: { hello: 'Привет, {name}!', only_ru: 'Только по-русски' }, en: { hello: 'Hello, {name}!' } }
  });
  const I = ctx.I18n;
  assert.equal(I.t('hello', { name: 'Аня' }), 'Привет, Аня!');
  assert.equal(I.t('hello', {}), 'Привет, {name}!', 'нет параметра — оставляем как есть');
  I.setLocale('en');
  assert.equal(I.t('hello', { name: 'Anna' }), 'Hello, Anna!');
  assert.equal(I.t('only_ru'), 'Только по-русски', 'нет перевода — берём русский');
  assert.equal(I.setLocale('xx'), 'en', 'неизвестный язык игнорируется');
});

test('все ключи, используемые в разметке, есть в словаре', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const keys = new Set();
  html.replace(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g, (m, k) => { keys.add(k); return m; });
  const js = fs.readFileSync(path.join(root, 'catalog/catalog.js'), 'utf8');
  js.replace(/I18n\.t\(([^)]*)\)/g, (m, expr) => { (expr.match(/'([\w.]+)'/g) || []).forEach((q) => keys.add(q.slice(1, -1))); return m; });
  const dict = load(['locales/ru.js'], {}).LOCALES.ru;
  assert.ok(keys.size > 0);
  keys.forEach((k) => assert.ok(k in dict, 'нет в словаре: ' + k));
});
