// Запуск: node --test tests/vault.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');

const root = path.join(__dirname, '..');
function backend() {
  const data = {};
  return {
    data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; },
    key: (i) => Object.keys(data)[i] || null, get length() { return Object.keys(data).length; }
  };
}
function load(b) {
  const ctx = vm.createContext({ localStorage: b || backend(), crypto: nodeCrypto.webcrypto, TextEncoder, TextDecoder, btoa, atob, Uint8Array, Date, JSON, Promise });
  ['shared/storage.js', 'shared/wallet.js', 'shared/vault.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}
const plain = (x) => JSON.parse(JSON.stringify(x));
const FAST = { iterations: 1000 }; // в тестах ключ считается быстро; в браузере 600 000
const PW = 'correct horse';

// saveCurrent использует настоящее число итераций, поэтому в тестах подменяем его через маленькую обёртку
function fastVault(ctx) {
  const V = ctx.PlatformVault, orig = V.encrypt;
  V.encrypt = (snap, pw, opts) => orig(snap, pw, Object.assign({}, FAST, opts));
  return V;
}

test('хранилище: keys(prefix) отдаёт нужные ключи и не падает без хранилища', () => {
  const b = backend(); b.setItem('game:a:x', '1'); b.setItem('game:b', '2'); b.setItem('platform:theme', '"dark"');
  const ctx = load(b);
  assert.deepEqual(plain(ctx.PlatformStorage.keys('game:')).sort(), ['game:a:x', 'game:b']);
  const broken = vm.createContext({ get localStorage() { throw new Error('x'); } });
  vm.runInContext(fs.readFileSync(path.join(root, 'shared/storage.js'), 'utf8'), broken);
  assert.deepEqual(plain(broken.PlatformStorage.keys('game:')), []);
});

test('шифрование: верный пароль возвращает данные, неверный и испорченное отклоняются', async () => {
  const V = load().PlatformVault;
  const snap = { v: 1, data: { 'platform:wallet': { balance: 777 } } };
  const blob = await V.encrypt(snap, PW, FAST);
  assert.equal(blob.iter, 1000);
  assert.ok(!JSON.stringify(blob).includes('777'), 'в шифртексте нет открытых данных');
  assert.deepEqual(plain(await V.decrypt(blob, PW)), snap);
  await assert.rejects(V.decrypt(blob, 'wrong password'), { code: 'wrong-password' });
  const tampered = Object.assign({}, blob, { ct: blob.ct.slice(0, -4) + (blob.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA') });
  await assert.rejects(V.decrypt(tampered, PW), { code: 'wrong-password' });
  await assert.rejects(V.decrypt({ v: 2 }, PW), { code: 'bad-file' });
  await assert.rejects(V.decrypt(Object.assign({}, blob, { iter: 1 }), PW), { code: 'bad-file' });
});

test('шифрование: два сохранения одних данных дают разный шифртекст (случайные соль и iv)', async () => {
  const V = load().PlatformVault;
  const snap = { v: 1, data: {} };
  const a = await V.encrypt(snap, PW, FAST), b = await V.encrypt(snap, PW, FAST);
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.ct, b.ct);
});

test('пароль: короче 8 символов отклоняется до шифрования', async () => {
  const ctx = load(); const V = fastVault(ctx);
  await assert.rejects(V.saveCurrent('short'), { code: 'weak-password' });
  await assert.rejects(V.saveCurrent(12345678), { code: 'weak-password' });
  assert.equal(V.listProfiles().length, 0);
});

test('сохранение: профиль появляется в списке, сессия открыта, без изменений «dirty» = false', async () => {
  const ctx = load(); const V = fastVault(ctx);
  ctx.PlatformStorage.set('platform:profile', { name: 'Аня', avatar: 3 });
  ctx.PlatformWallet.add(500, 'win');
  const r = await V.saveCurrent(PW);
  assert.match(r.id, /^[0-9a-f]{12}$/);
  assert.deepEqual(plain(V.listProfiles().map((p) => [p.name, p.avatar])), [['Аня', 3]]);
  const s = V.getSession();
  assert.equal(s.name, 'Аня'); assert.equal(s.dirty, false);
  ctx.PlatformWallet.add(1, 'win');
  assert.equal(V.getSession().dirty, true, 'после изменений нужно сохранить снова');
});

test('повторное сохранение: нужен тот же пароль, профиль обновляется, а не дублируется', async () => {
  const ctx = load(); const V = fastVault(ctx);
  const first = await V.saveCurrent(PW);
  ctx.PlatformWallet.add(100, 'win');
  await assert.rejects(V.saveCurrent('another password'), { code: 'wrong-password' });
  const second = await V.saveCurrent(PW);
  assert.equal(second.id, first.id);
  assert.equal(V.listProfiles().length, 1);
  assert.equal(V.getSession().dirty, false);
});

test('вход: данные заменяются прогрессом профиля, тема не трогается, неверный пароль ничего не меняет', async () => {
  const ctx = load(); const V = fastVault(ctx);
  ctx.PlatformStorage.set('platform:theme', 'dark');
  ctx.PlatformStorage.set('platform:profile', { name: 'Аня', avatar: 1 });
  ctx.PlatformStorage.set('game:minesweeper:best', { novice: 42 });
  ctx.PlatformWallet.add(2000, 'win'); // 7000
  const { id } = await V.saveCurrent(PW);
  // «другой человек» играет в этом же браузере
  ctx.PlatformStorage.set('platform:profile', { name: 'Гость', avatar: 0 });
  ctx.PlatformStorage.set('game:minesweeper:best', { novice: 5 });
  ctx.PlatformStorage.set('game:poker:chips', 9);
  ctx.PlatformWallet.spend(4000, 'bet');
  await assert.rejects(V.login(id, 'wrong password'), { code: 'wrong-password' });
  assert.equal(ctx.PlatformStorage.get('platform:profile', null).name, 'Гость', 'при неверном пароле ничего не изменилось');
  await V.login(id, PW);
  assert.equal(ctx.PlatformStorage.get('platform:profile', null).name, 'Аня');
  assert.deepEqual(plain(ctx.PlatformStorage.get('game:minesweeper:best', null)), { novice: 42 });
  assert.equal(ctx.PlatformStorage.get('game:poker:chips', null), null, 'чужой прогресс игры удалён');
  assert.equal(ctx.PlatformWallet.getBalance(), 7000);
  assert.equal(ctx.PlatformStorage.get('platform:theme', null), 'dark');
  assert.equal(V.getSession().dirty, false);
});

test('перенос на другое устройство: файл из одного браузера открывается в другом', async () => {
  const a = load(), A = fastVault(a);
  a.PlatformStorage.set('platform:profile', { name: 'Боря', avatar: 2 });
  a.PlatformWallet.add(1234, 'win');
  const { file } = await A.saveCurrent(PW);
  assert.ok(file.includes('Боря'), 'имя лежит открыто: оно нужно для списка профилей');
  assert.ok(!file.includes('6234'), 'баланс в файле зашифрован');
  const b = load(), B = fastVault(b);
  await assert.rejects(B.importFile(file, 'wrong password'), { code: 'wrong-password' });
  await assert.rejects(B.importFile('не json', PW), { code: 'bad-file' });
  await assert.rejects(B.importFile(JSON.stringify({ app: 'other' }), PW), { code: 'bad-file' });
  await B.importFile(file, PW);
  assert.equal(b.PlatformWallet.getBalance(), 6234);
  assert.equal(b.PlatformStorage.get('platform:profile', null).name, 'Боря');
  assert.equal(B.listProfiles().length, 1);
  assert.equal(B.getSession().dirty, false);
});

test('снимок: в него попадают только профиль, кошелёк и ключи игр; чужие ключи из файла игнорируются', async () => {
  const ctx = load(); const V = fastVault(ctx);
  ctx.PlatformStorage.set('platform:theme', 'dark');
  ctx.PlatformStorage.set('other:key', 1);
  ctx.PlatformStorage.set('game:yahtzee:x', 1);
  assert.deepEqual(Object.keys(V.snapshot().data), ['game:yahtzee:x']);
  V.applySnapshot({ v: 1, data: { 'platform:theme': 'light', 'other:key': 2, 'game:poker:chips': 5 } });
  assert.equal(ctx.PlatformStorage.get('platform:theme', null), 'dark');
  assert.equal(ctx.PlatformStorage.get('other:key', null), 1);
  assert.equal(ctx.PlatformStorage.get('game:poker:chips', null), 5);
  assert.throws(() => V.applySnapshot({ v: 9 }), { code: 'bad-file' });
});

test('повреждённый сейф в хранилище не ломает список профилей', () => {
  const b = backend();
  b.setItem('platform:vault', JSON.stringify({ profiles: [null, 5, { id: 'x' }, { id: 'y', blob: {} }] }));
  b.setItem('platform:session', '"мусор"');
  const V = load(b).PlatformVault;
  assert.deepEqual(plain(V.listProfiles()), []);
  assert.equal(V.getSession(), null);
});
