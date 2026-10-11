// Firestore-хранилище с поддельным fetch: проверяем запросы (токен из ключа, запись, чтение, список), сам Firestore не нужен
const test = require('node:test');
const assert = require('node:assert');
const { generateKeyPair, exportPKCS8, jwtVerify } = require('jose');
const { FirestoreLedger, makeLedger, MemLedger } = require('../ledger');

async function account() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  return { client_email: 'svc@p.iam.gserviceaccount.com', private_key: await exportPKCS8(privateKey), publicKey };
}

test('Firestore-хранилище: токен подписан ключом аккаунта, запись и чтение идут с этим токеном', async () => {
  const acc = await account(), calls = [], store = new Map();
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') return { ok: true, status: 200, json: async () => ({ access_token: 'tok1', expires_in: 3600 }) };
    const method = init.method;
    if (url.endsWith(':commit')) {
      JSON.parse(init.body).writes.forEach((w) => { if (w.update) store.set(w.update.name, w.update); else store.delete(w.delete); });
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (method === 'GET' && url.includes('/ratings/')) return { ok: true, status: 200, json: async () => ({ fields: { balance: { integerValue: '7777' } } }) };
    if (method === 'GET' && url.includes('/holds?')) return { ok: true, status: 200, json: async () => ({ documents: Array.from(store.values()).filter((d) => d.name.includes('/holds/')) }) };
    if (method === 'GET') { const key = 'projects/p/databases/(default)/documents/' + url.split('/documents/')[1]; return store.has(key) ? { ok: true, status: 200, json: async () => store.get(key) } : { ok: false, status: 404, json: async () => ({}) }; }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const L = new FirestoreLedger({ projectId: 'p', serviceAccount: { client_email: acc.client_email, private_key: acc.private_key }, fetch });
  assert.strictEqual(await L.get('wallets', 'u1'), null);
  await L.commit([{ op: 'set', coll: 'wallets', id: 'u1', data: { balance: 4800 } }, { op: 'set', coll: 'holds', id: 'u1_ABC', data: { uid: 'u1', code: 'ABC', amount: 200 } }]);
  assert.deepStrictEqual(await L.get('wallets', 'u1'), { balance: 4800 });
  assert.strictEqual(store.get('projects/p/databases/(default)/documents/wallets/u1').fields.balance.integerValue, '4800', 'баланс виден в консоли отдельным числом');
  assert.deepStrictEqual((await L.list('holds')).map((h) => h.id), ['u1_ABC']);
  await L.commit([{ op: 'delete', coll: 'holds', id: 'u1_ABC' }]);
  assert.strictEqual((await L.list('holds')).length, 0);
  assert.strictEqual(await L.seed('u1'), 7777);
  const tokenCalls = calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token');
  assert.strictEqual(tokenCalls.length, 1, 'токен берётся один раз и переиспользуется');
  const jwt = decodeURIComponent(tokenCalls[0].init.body.split('assertion=')[1]);
  const { payload } = await jwtVerify(jwt, acc.publicKey, { audience: 'https://oauth2.googleapis.com/token' });
  assert.strictEqual(payload.iss, acc.client_email);
  assert.strictEqual(payload.scope, 'https://www.googleapis.com/auth/datastore');
  assert.ok(calls.filter((c) => c.url !== 'https://oauth2.googleapis.com/token').every((c) => c.init.headers.Authorization === 'Bearer tok1'));
});

test('Firestore-хранилище: новому игроку берётся кошелёк из облачного снимка, иначе баланс из рейтинга', async () => {
  const acc = await account();
  const snapshot = { v: 1, data: { 'platform:wallet': { balance: 6500, streak: 7, best: 7 } } };
  const fetch = async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    if (url.includes('/users/u1')) return { ok: true, status: 200, json: async () => ({ fields: { data: { stringValue: JSON.stringify(snapshot) } } }) };
    if (url.includes('/users/')) return { ok: false, status: 404, json: async () => ({}) };
    if (url.includes('/ratings/u2')) return { ok: true, status: 200, json: async () => ({ fields: { balance: { integerValue: '3200' } } }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const L = new FirestoreLedger({ projectId: 'p', serviceAccount: { client_email: acc.client_email, private_key: acc.private_key }, fetch });
  assert.deepStrictEqual(await L.seed('u1'), { balance: 6500, streak: 7, best: 7 }, 'серия и рекорд сохраняются');
  assert.strictEqual(await L.seed('u2'), 3200, 'нет снимка: баланс из рейтинга');
  assert.strictEqual(await L.seed('u3'), null);
});

test('выбор хранилища по переменным окружения', async () => {
  assert.strictEqual(makeLedger({}), null, 'без ключа серверный баланс выключен');
  assert.ok(makeLedger({ LEDGER: 'memory' }) instanceof MemLedger);
  assert.throws(() => makeLedger({ FIREBASE_SERVICE_ACCOUNT: 'не json' }), /не JSON/);
  assert.throws(() => makeLedger({ FIREBASE_SERVICE_ACCOUNT: '{}' }), /client_email/);
  const acc = await account();
  assert.ok(makeLedger({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: acc.client_email, private_key: acc.private_key }), FIREBASE_PROJECT_ID: 'p' }) instanceof FirestoreLedger);
});
