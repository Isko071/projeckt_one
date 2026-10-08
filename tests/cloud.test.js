// Запуск: node --test tests/cloud.test.js
// Облачное сохранение проверяется с поддельными Firebase и сетью: настоящий вход через Google проверяется вручную.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const FILES = ['locales/ru.js', 'shared/storage.js', 'shared/i18n.js', 'shared/profile.js', 'shared/wallet.js', 'shared/progress.js', 'shared/sync-logic.js', 'shared/firebase-config.js', 'shared/cloud.js'];
const plain = (x) => JSON.parse(JSON.stringify(x));
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

function backend() {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; },
    key: (i) => Object.keys(data)[i] || null, get length() { return Object.keys(data).length; } };
}

// Общая «облачная» база на несколько устройств
function makeCloud() { return { docs: {}, offline: false, deny: false, calls: [] }; }

function device(cloud, opts) {
  opts = opts || {};
  const b = backend();
  const reloads = { n: 0 };
  let authCb = null, current = null;
  const fakeAuth = {
    get currentUser() { return current; },
    onAuthStateChanged: (cb) => { authCb = cb; cb(null); },
    signInWithPopup: async () => {
      if (opts.popupError) { const e = new Error('x'); e.code = opts.popupError; throw e; }
      current = { uid: 'u1', displayName: 'Аня Иванова', email: 'a@x', photoURL: opts.noPhoto ? null : 'https://lh3.googleusercontent.com/a/photo', getIdToken: async () => 'tok-u1' };
      authCb(current);
    },
    signOut: async () => { current = null; authCb(null); }
  };
  const firebase = { apps: [], initializeApp() { this.apps.push(1); }, auth: Object.assign(() => fakeAuth, { GoogleAuthProvider: function () {} }) };
  const fetch = async (url, init) => {
    cloud.calls.push(init.method);
    if (cloud.offline) throw new TypeError('network');
    if (cloud.deny) return { ok: false, status: 403 };
    assert.ok(url.includes('/databases/igroteka-db/documents/users/u1'));
    assert.equal(init.headers.Authorization, 'Bearer tok-u1');
    if (init.method === 'GET') return cloud.docs.u1 ? { ok: true, status: 200, json: async () => cloud.docs.u1 } : { ok: false, status: 404 };
    cloud.docs.u1 = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const ctx = vm.createContext({
    localStorage: b, firebase, fetch, JSON, Promise, Date, Object, Array, Number, String, Error, TypeError,
    location: { protocol: opts.protocol || 'https:', reload: () => { reloads.n++; } },
    setInterval: () => 1, addEventListener: () => {}, document: { addEventListener: () => {}, visibilityState: 'visible' }
  });
  FILES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
  return { ctx, b, reloads, C: ctx.PlatformCloud, W: ctx.PlatformWallet, PP: ctx.PlatformProgress, P: ctx.PlatformProfile, S: ctx.PlatformStorage };
}
const cloudSnapshot = (cloud) => JSON.parse(cloud.docs.u1.fields.data.stringValue);

test('решение: все сочетания отпечатков', () => {
  const d = device(makeCloud()).ctx.PlatformSyncLogic.decide;
  assert.equal(d({ localFp: 'a', baseFp: null, cloudFp: null, localPristine: false }), 'upload', 'в облаке пусто');
  assert.equal(d({ localFp: 'a', baseFp: null, cloudFp: 'a', localPristine: false }), 'none');
  assert.equal(d({ localFp: 'a', baseFp: null, cloudFp: 'b', localPristine: true }), 'download', 'чистый гость берёт облако');
  assert.equal(d({ localFp: 'c', baseFp: 'a', cloudFp: 'a', localPristine: true }), 'upload', 'правка одного профиля без игр не теряется');
  assert.equal(d({ localFp: 'c', baseFp: 'a', cloudFp: 'b', localPristine: true }), 'download', 'изменилось обе стороны, но игр здесь нет');
  assert.equal(d({ localFp: 'a', baseFp: 'a', cloudFp: 'b', localPristine: false }), 'download', 'здесь не менялось');
  assert.equal(d({ localFp: 'c', baseFp: 'a', cloudFp: 'a', localPristine: false }), 'upload', 'облако не менялось');
  assert.equal(d({ localFp: 'c', baseFp: 'a', cloudFp: 'b', localPristine: false }), 'conflict', 'изменились обе стороны');
  assert.equal(d({ localFp: 'c', baseFp: null, cloudFp: 'b', localPristine: false }), 'conflict', 'раньше не синхронизировались');
});

test('без https или без Firebase вход недоступен и ничего не ломает', async () => {
  const cloud = makeCloud();
  const d = device(cloud, { protocol: 'file:' });
  d.C.start();
  assert.equal(d.C.getState().status, 'unsupported');
  await assert.rejects(d.C.signIn(), { code: 'unsupported' });
  assert.deepEqual(cloud.calls, []);
});

test('первый вход чистого гостя: запись создаётся в облаке, имя берётся из Google', async () => {
  const cloud = makeCloud(), d = device(cloud);
  d.C.start();
  assert.equal(d.C.getState().status, 'signedOut');
  assert.deepEqual(plain(await d.C.signIn()), { ok: true });
  await tick();
  assert.equal(d.C.getState().status, 'signedIn');
  assert.equal(d.C.getState().sync, 'idle');
  assert.ok(cloud.docs.u1, 'запись создана');
  assert.equal(d.P.getProfile().name, 'Аня Иванова');
  assert.equal(d.P.getProfile().google, true, 'фото Google включается само');
  assert.equal(d.C.getState().user.photo, 'https://lh3.googleusercontent.com/a/photo');
  assert.equal(cloudSnapshot(cloud).data['platform:profile'].name, 'Аня Иванова');
  assert.equal(cloudSnapshot(cloud).data['platform:profile'].google, true);
  assert.equal(d.reloads.n, 0);
});

test('прогресс гостя при первом входе попадает в облако, а изменения потом отправляются', async () => {
  const cloud = makeCloud(), d = device(cloud);
  d.W.add(2500, 'win');
  d.C.start(); await d.C.signIn(); await tick();
  assert.equal(cloudSnapshot(cloud).data['platform:wallet'].balance, 7500);
  d.W.add(500, 'win');
  await d.C.syncNow();
  assert.equal(cloudSnapshot(cloud).data['platform:wallet'].balance, 8000);
});

test('второе устройство: чистый гость получает прогресс из облака и страница перезагружается', async () => {
  const cloud = makeCloud();
  const a = device(cloud); a.W.add(2500, 'win'); a.S.set('game:minesweeper:best', { novice: 42 });
  a.C.start(); await a.C.signIn(); await tick();
  const b = device(cloud); b.C.start(); await b.C.signIn(); await tick();
  assert.equal(b.W.getBalance(), 7500);
  assert.deepEqual(plain(b.S.get('game:minesweeper:best', null)), { novice: 42 });
  assert.equal(b.reloads.n, 1);
});

test('прогресс другого устройства подтягивается, если здесь ничего не менялось', async () => {
  const cloud = makeCloud();
  const a = device(cloud); a.C.start(); await a.C.signIn(); await tick();
  const b = device(cloud); b.C.start(); await b.C.signIn(); await tick();
  a.W.add(1000, 'win'); await a.C.syncNow();
  await b.C.syncNow();
  assert.equal(b.W.getBalance(), 6000);
  assert.equal(b.reloads.n >= 1, true);
});

test('конфликт: изменились обе стороны, игрок выбирает облако', async () => {
  const cloud = makeCloud();
  const a = device(cloud); a.C.start(); await a.C.signIn(); await tick();
  const b = device(cloud); b.C.start(); await b.C.signIn(); await tick();
  a.W.add(1000, 'win'); await a.C.syncNow();   // облако: 6000
  b.W.add(300, 'win');                          // устройство B: 5300, облако тоже ушло вперёд
  await b.C.syncNow();
  const st = b.C.getState();
  assert.equal(st.sync, 'conflict');
  assert.equal(st.conflict.cloud.balance, 6000);
  assert.equal(st.conflict.local.balance, 5300);
  await b.C.resolveConflict('cloud');
  assert.equal(b.W.getBalance(), 6000);
  assert.equal(b.C.getState().conflict, null);
});

test('конфликт: игрок оставляет прогресс этого устройства, облако обновляется', async () => {
  const cloud = makeCloud();
  const a = device(cloud); a.C.start(); await a.C.signIn(); await tick();
  const b = device(cloud); b.C.start(); await b.C.signIn(); await tick();
  a.W.add(1000, 'win'); await a.C.syncNow();
  b.W.add(300, 'win'); await b.C.syncNow();
  await b.C.resolveConflict('local');
  assert.equal(cloudSnapshot(cloud).data['platform:wallet'].balance, 5300);
  assert.equal(b.C.getState().sync, 'idle');
});

test('на странице игры (allowDownload: false) облако не затирает локальный прогресс', async () => {
  const cloud = makeCloud();
  const a = device(cloud); a.W.add(2500, 'win'); a.C.start(); await a.C.signIn(); await tick();
  const g = device(cloud); g.C.start({ allowDownload: false }); await g.C.signIn(); await tick();
  assert.equal(g.C.getState().sync, 'paused');
  assert.equal(g.W.getBalance(), 5000);
  assert.equal(g.reloads.n, 0);
});

test('нет связи и нет доступа: ошибка показывается, данные не теряются', async () => {
  const cloud = makeCloud(), d = device(cloud);
  d.W.add(100, 'win');
  d.C.start(); await d.C.signIn(); await tick();
  cloud.offline = true; d.W.add(5, 'win');
  await d.C.syncNow();
  assert.deepEqual([d.C.getState().sync, d.C.getState().error], ['error', 'network']);
  assert.equal(d.W.getBalance(), 5105);
  cloud.offline = false; cloud.deny = true;
  await d.C.syncNow();
  assert.equal(d.C.getState().error, 'denied');
  cloud.deny = false;
  await d.C.syncNow();
  assert.equal(d.C.getState().sync, 'idle');
});

test('выход: несохранённое отправляется, локальный прогресс стирается', async () => {
  const cloud = makeCloud(), d = device(cloud);
  d.C.start(); await d.C.signIn(); await tick();
  d.W.add(777, 'win');
  const r = await d.C.signOut();
  assert.deepEqual(plain(r), { ok: true });
  assert.equal(cloudSnapshot(cloud).data['platform:wallet'].balance, 5777, 'перед выходом всё отправлено');
  assert.equal(d.W.getBalance(), 5000, 'на устройстве прогресс стёрт');
  assert.equal(d.S.get('platform:sync', null), null);
  assert.equal(d.C.getState().status, 'signedOut');
});

test('выход без связи: прогресс не стирается, пока игрок явно не согласится', async () => {
  const cloud = makeCloud(), d = device(cloud);
  d.C.start(); await d.C.signIn(); await tick();
  d.W.add(777, 'win'); cloud.offline = true;
  assert.deepEqual(plain(await d.C.signOut()), { ok: false, unsaved: true });
  assert.equal(d.W.getBalance(), 5777);
  assert.equal(d.C.getState().status, 'signedIn');
  assert.deepEqual(plain(await d.C.signOut(true)), { ok: true });
  assert.equal(d.W.getBalance(), 5000);
});

test('закрытое окно входа не считается ошибкой; другие ошибки возвращают код', async () => {
  let d = device(makeCloud(), { popupError: 'auth/popup-closed-by-user' });
  d.C.start();
  assert.deepEqual(plain(await d.C.signIn()), { ok: false, cancelled: true });
  d = device(makeCloud(), { popupError: 'auth/unauthorized-domain' });
  d.C.start();
  await assert.rejects(d.C.signIn(), { code: 'auth/unauthorized-domain' });
});

test('смена аккаунта на устройстве не использует чужой отпечаток синхронизации', async () => {
  const cloud = makeCloud(), d = device(cloud);
  d.S.set('platform:sync', { uid: 'other', fp: 'zzz' });
  d.W.add(10, 'win');
  d.C.start(); await d.C.signIn(); await tick();
  assert.equal(cloudSnapshot(cloud).data['platform:wallet'].balance, 5010);
});

test('имя и фото Google не затирают уже настроенный профиль; без фото флажок не ставится', async () => {
  const d = device(makeCloud());
  d.P.saveProfile({ name: 'Боря', avatar: 3, icon: '🦊' });
  d.C.start(); await d.C.signIn(); await tick();
  assert.deepEqual(plain(d.P.getProfile()), { name: 'Боря', avatar: 3, icon: '🦊' });
  const f = device(makeCloud());
  f.P.saveProfile({ name: 'Игрок', avatar: 0, icon: '🐼' });
  f.C.start(); await f.C.signIn(); await tick();
  assert.deepEqual(plain(f.P.getProfile()), { name: 'Аня Иванова', avatar: 0, icon: '🐼' }, 'эмодзи не вытесняется фото');
  const e = device(makeCloud(), { noPhoto: true });
  e.C.start(); await e.C.signIn(); await tick();
  assert.deepEqual(plain(e.P.getProfile()), { name: 'Аня Иванова', avatar: 0 });
});
