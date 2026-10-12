// Хранилище балансов и залогов для сервера: единственное место, где аконы существуют «по-настоящему».
//   get(coll, id)        → объект или null
//   commit(writes)       → записать сразу несколько документов одной операцией: [{ op:'set', coll, id, data } | { op:'delete', coll, id }]
//   list(coll)           → [{ id, data }]
//   seed(uid)            → с чего начать кошелёк новому игроку: объект кошелька из облачного снимка, число (баланс из рейтинга) или null
// Коллекции: wallets (состояние кошелька игрока), holds (залоги ставок за столами: uid_код → { uid, code, amount }).
// Две реализации: память (для проверок и локального запуска) и Firestore по ключу сервисного аккаунта (на Render).
const { SignJWT, importPKCS8 } = require('jose');

class MemLedger {
  constructor(o) {
    this.data = new Map();                 // 'coll/id' → объект
    this.seeds = (o && o.seeds) || {};     // uid → стартовый баланс (для проверок)
    this.failNext = 0;                     // для проверок: сколько ближайших записей завершить ошибкой
    this.failAfterApply = 0;               // для проверок: сколько ближайших записей применить, но сообщить об ошибке
    this.sinces = (o && o.sinces) || {};   // для проверок: uid → когда создан аккаунт (мс); по умолчанию «давно»
  }
  async get(coll, id) { const v = this.data.get(coll + '/' + id); return v ? JSON.parse(JSON.stringify(v)) : null; }
  async commit(writes) {
    if (this.failNext > 0) { this.failNext--; throw new Error('ledger-failed'); }
    writes.forEach((w) => {
      const key = w.coll + '/' + w.id;
      if (w.op === 'delete') this.data.delete(key); else this.data.set(key, JSON.parse(JSON.stringify(w.data)));
    });
    if (this.failAfterApply > 0) { this.failAfterApply--; throw new Error('ledger-lost-response'); }     // для проверок: запись прошла, а ответ потерялся
  }
  async list(coll) {
    const out = [];
    this.data.forEach((v, k) => { if (k.startsWith(coll + '/')) out.push({ id: k.slice(coll.length + 1), data: JSON.parse(JSON.stringify(v)) }); });
    return out;
  }
  async seed(uid) { return Number.isFinite(this.seeds[uid]) ? this.seeds[uid] : null; }
  async accountSince(uid) { return Number.isFinite(this.sinces[uid]) ? this.sinces[uid] : 0; }
}

// Firestore через REST: токен получаем из ключа сервисного аккаунта (JSON из консоли Firebase), без сторонних библиотек
class FirestoreLedger {
  constructor(o) {
    this.projectId = o.projectId;
    this.account = o.serviceAccount;                  // { client_email, private_key }
    this.fetch = o.fetch || globalThis.fetch;
    this.now = o.now || Date.now;
    this.base = 'https://firestore.googleapis.com/v1/projects/' + this.projectId + '/databases/(default)/documents';
    this.token = null; this.tokenUntil = 0; this.tokenPending = null;
    this.timeoutMs = o.timeoutMs || 15000; this.retryMs = o.retryMs !== undefined ? o.retryMs : 400;
  }
  // Токен берётся один раз для всех одновременных запросов
  accessToken() {
    if (this.token && this.now() < this.tokenUntil - 60000) return Promise.resolve(this.token);
    if (!this.tokenPending) this.tokenPending = this.fetchToken().finally(() => { this.tokenPending = null; });
    return this.tokenPending;
  }
  async fetchToken() {
    const key = await importPKCS8(String(this.account.private_key).replace(/\\n/g, '\n'), 'RS256');
    const iat = Math.floor(this.now() / 1000);
    const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(this.account.client_email).setSubject(this.account.client_email)
      .setAudience('https://oauth2.googleapis.com/token').setIssuedAt(iat).setExpirationTime(iat + 3600).sign(key);
    const res = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt)
    });
    if (!res.ok) throw new Error('ledger-auth-' + res.status);
    const body = await res.json();
    this.token = body.access_token; this.tokenUntil = this.now() + (Number(body.expires_in) || 3600) * 1000;
    return this.token;
  }
  // Запрос с таймаутом и повторами: сеть и 429/5xx повторяются до трёх раз с паузой, 401 один раз с новым токеном (записи в commit абсолютные, повтор безопасен)
  async call(method, url, body) {
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null, timer = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : null;
        let res;
        try { res = await this.fetch(url, { method, headers: { Authorization: 'Bearer ' + await this.accessToken(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined }); }
        finally { if (timer) clearTimeout(timer); }
        if (res.status === 404 && method === 'GET') return null;
        if (res.status === 401) { this.token = null; last = new Error('ledger-http-401'); continue; }
        if (res.status === 429 || res.status >= 500) { last = new Error('ledger-http-' + res.status); await new Promise((r) => setTimeout(r, this.retryMs * (attempt + 1))); continue; }
        if (!res.ok) throw new Error('ledger-http-' + res.status);
        return await res.json();
      } catch (e) {
        if (/^ledger-http-4/.test(String(e && e.message)) && !/401/.test(e.message)) throw e;
        last = e;
        if (attempt < 2) await new Promise((r) => setTimeout(r, this.retryMs * (attempt + 1)));
      }
    }
    throw last || new Error('ledger-failed');
  }
  // Документ хранится как одна строка json (всё состояние) и число balance для просмотра в консоли
  encode(coll, id, data) {
    const fields = { json: { stringValue: JSON.stringify(data) } };
    if (Number.isSafeInteger(data.balance)) fields.balance = { integerValue: String(data.balance) };
    return { name: 'projects/' + this.projectId + '/databases/(default)/documents/' + coll + '/' + id, fields };
  }
  decode(doc) { try { return JSON.parse(doc.fields.json.stringValue); } catch (e) { return null; } }
  async get(coll, id) {
    const doc = await this.call('GET', this.base + '/' + coll + '/' + encodeURIComponent(id));
    return doc ? this.decode(doc) : null;
  }
  async commit(writes) {
    await this.call('POST', this.base + ':commit', { writes: writes.map((w) => w.op === 'delete'
      ? { delete: 'projects/' + this.projectId + '/databases/(default)/documents/' + w.coll + '/' + w.id }
      : { update: this.encode(w.coll, w.id, w.data) }) });
  }
  async list(coll) {
    const out = []; let page = '';
    do {
      const body = await this.call('GET', this.base + '/' + coll + '?pageSize=300' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
      ((body && body.documents) || []).forEach((d) => { const data = this.decode(d); if (data) out.push({ id: d.name.split('/').pop(), data }); });
      page = (body && body.nextPageToken) || '';
    } while (page);
    return out;
  }
  // Новому игроку: его кошелёк из облачного снимка прогресса (users/{uid}: серия, рекорды, дни, баланс), а если снимка нет, баланс из рейтинга
  // (оба пишет сам клиент, поэтому в wallet-service.js баланс ограничен сверху)
  // Когда аккаунт появился в базе: время создания его документов users/{uid} и ratings/{uid} (его ставит сам Firestore, подделать нельзя); null — документов нет
  async accountSince(uid) {
    const times = [];
    for (const coll of ['users', 'ratings']) {
      const doc = await this.call('GET', this.base + '/' + coll + '/' + encodeURIComponent(uid));
      const t = doc && doc.createTime ? Date.parse(doc.createTime) : NaN;
      if (Number.isFinite(t)) times.push(t);
    }
    return times.length ? Math.min.apply(null, times) : null;
  }
  async seed(uid) {
    const snap = await this.call('GET', this.base + '/users/' + encodeURIComponent(uid));
    try {
      const w = JSON.parse(snap.fields.data.stringValue).data['platform:wallet'];
      if (w && typeof w === 'object') return w;
    } catch (e) { /* снимка нет или он повреждён: пробуем рейтинг */ }
    const doc = await this.call('GET', this.base + '/ratings/' + encodeURIComponent(uid));
    const v = doc && doc.fields && doc.fields.balance;
    const n = v && v.integerValue !== undefined ? Number(v.integerValue) : (v && v.doubleValue !== undefined ? Math.floor(v.doubleValue) : NaN);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
}

// Какое хранилище включить: ключ сервисного аккаунта в FIREBASE_SERVICE_ACCOUNT (JSON) — Firestore; LEDGER=memory — память (только для проверок).
// Без того и другого вернёт null: серверный баланс выключен, ставки за столами недоступны.
function makeLedger(env) {
  env = env || process.env;
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    let account;
    try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); } catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT: не JSON'); }
    if (!account.client_email || !account.private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT: нет client_email или private_key');
    return new FirestoreLedger({ projectId: env.FIREBASE_PROJECT_ID, serviceAccount: account });
  }
  if (env.LEDGER === 'memory') return new MemLedger();
  return null;
}

module.exports = { MemLedger, FirestoreLedger, makeLedger };
