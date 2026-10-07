// Запуск: node --test tests/profile.test.js
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
function fakeBackend() {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}
const plain = (x) => JSON.parse(JSON.stringify(x));
const FILES = ['locales/ru.js', 'shared/storage.js', 'shared/i18n.js', 'shared/profile.js'];

test('профиль: без сохранённых данных — имя по умолчанию из словаря и первый аватар', () => {
  const P = load(FILES, { localStorage: fakeBackend() }).PlatformProfile;
  assert.deepEqual(plain(P.getProfile()), { name: 'Игрок', avatar: 0 });
});

test('профиль: сохраняется и читается, записывается в platform:profile', () => {
  const backend = fakeBackend();
  const P = load(FILES, { localStorage: backend }).PlatformProfile;
  assert.deepEqual(plain(P.saveProfile({ name: 'Аня', avatar: 3 })), { name: 'Аня', avatar: 3 });
  assert.deepEqual(plain(P.getProfile()), { name: 'Аня', avatar: 3 });
  assert.deepEqual(JSON.parse(backend.data['platform:profile']), { name: 'Аня', avatar: 3 });
});

test('профиль: имя обрезается до 20 символов, пробелы схлопываются', () => {
  const P = load(FILES, { localStorage: fakeBackend() }).PlatformProfile;
  assert.equal(P.sanitize({ name: '  Аня   Иванова  ', avatar: 1 }).name, 'Аня Иванова');
  const long = P.sanitize({ name: 'А'.repeat(50), avatar: 1 }).name;
  assert.equal(long.length, 20);
  assert.equal(P.sanitize({ name: 'Имя   с   пробелами  и   ещё  много   слов', avatar: 1 }).name.length <= 20, true);
});

test('профиль: пустое имя не стирает прежнее', () => {
  const P = load(FILES, { localStorage: fakeBackend() }).PlatformProfile;
  P.saveProfile({ name: 'Аня', avatar: 2 });
  assert.deepEqual(plain(P.saveProfile({ name: '   ', avatar: 4 })), { name: 'Аня', avatar: 4 });
});

test('профиль: неверный аватар заменяется (дробное, отрицательное, большое, не число)', () => {
  const P = load(FILES, { localStorage: fakeBackend() }).PlatformProfile;
  P.saveProfile({ name: 'Аня', avatar: 5 });
  [1.5, -1, 8, 99, '3', null, NaN, Infinity].forEach((bad) => {
    assert.equal(P.saveProfile({ name: 'Аня', avatar: bad }).avatar, 5, 'аватар ' + String(bad) + ' должен остаться прежним');
  });
  assert.equal(P.saveProfile({ name: 'Аня', avatar: 0 }).avatar, 0);
  assert.equal(P.saveProfile({ name: 'Аня', avatar: 7 }).avatar, 7);
});

test('профиль: испорченные сохранённые данные не ломают чтение', () => {
  const backend = fakeBackend();
  const P = load(FILES, { localStorage: backend }).PlatformProfile;
  backend.data['platform:profile'] = '{не json';
  assert.deepEqual(plain(P.getProfile()), { name: 'Игрок', avatar: 0 });
  backend.data['platform:profile'] = JSON.stringify({ name: 123, avatar: 'x' });
  assert.deepEqual(plain(P.getProfile()), { name: 'Игрок', avatar: 0 });
  backend.data['platform:profile'] = 'null';
  assert.deepEqual(plain(P.getProfile()), { name: 'Игрок', avatar: 0 });
});

test('профиль: без хранилища изменения действуют до перезагрузки', () => {
  const ctx = vm.createContext({});
  Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('доступ запрещён'); } });
  FILES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx));
  const P = ctx.PlatformProfile;
  assert.equal(P.saveProfile({ name: 'Боря', avatar: 2 }).name, 'Боря');
  assert.deepEqual(plain(P.getProfile()), { name: 'Боря', avatar: 2 });
});

test('профиль: подписчики получают сохранённый профиль', () => {
  const P = load(FILES, { localStorage: fakeBackend() }).PlatformProfile;
  const seen = [];
  P.onChange((p) => seen.push(plain(p)));
  P.onChange(() => { throw new Error('сломанный подписчик'); });
  P.saveProfile({ name: 'Аня', avatar: 1 });
  assert.deepEqual(seen, [{ name: 'Аня', avatar: 1 }]);
});

test('профиль: буква и цвет аватара', () => {
  const P = load(FILES, { localStorage: fakeBackend() }).PlatformProfile;
  assert.equal(P.initial('аня'), 'А');
  assert.equal(P.initial('  боря'), 'Б');
  assert.equal(P.initial(''), '?');
  assert.equal(P.initial(undefined), '?');
  assert.equal(P.AVATAR_COUNT, 8);
  const colors = new Set();
  for (let i = 0; i < P.AVATAR_COUNT; i++) colors.add(P.avatarColor(i));
  assert.equal(colors.size, 8, 'все цвета разные');
  assert.equal(P.avatarColor(99), P.avatarColor(0), 'неверный номер — первый цвет');
});

test('профиль работает и без словаря (запасное имя)', () => {
  const P = load(['shared/storage.js', 'shared/profile.js'], { localStorage: fakeBackend() }).PlatformProfile;
  assert.equal(P.getProfile().name, 'Игрок');
});
