// Защищённые профили без сервера: прогресс (профиль, аконы, рекорды игр) шифруется паролем и хранится
// в этом браузере и/или в файле, который можно перенести на другое устройство.
//   Шифрование: ключ из пароля (PBKDF2-SHA-256, случайная соль) + AES-GCM. Пароль нигде не хранится.
//   Неверный пароль или испорченный файл расшифровать нельзя, и это проверяется автоматически.
//   Забытый пароль восстановить невозможно (сервера нет).
// API (всё асинхронное, кроме списков):
//   PlatformVault.saveCurrent(password)        → { id, file }   создать или обновить защищённый профиль
//   PlatformVault.login(id, password)          → вход по профилю, сохранённому в этом браузере
//   PlatformVault.importFile(text, password)   → вход по файлу или коду с другого устройства
//   PlatformVault.listProfiles(), getSession(), exportFile(id), checkPassword(pw), fingerprint()
// Настоящие аккаунты с входом с любого устройства потребуют сервера; тогда изменится только этот файл.
(function (root) {
  var VAULT_KEY = 'platform:vault';
  var SESSION_KEY = 'platform:session';
  var FIXED_KEYS = ['platform:profile', 'platform:wallet'];
  var GAME_PREFIX = 'game:';
  var ITERATIONS = 600000;
  var MIN_PASSWORD = 8;
  var MAX_PROFILES = 20;

  function storage() { return root.PlatformStorage; }
  function subtle() {
    var c = root.crypto;
    if (!c || !c.subtle) throw new Error('no-crypto');
    return c.subtle;
  }
  function fail(code) { var e = new Error(code); e.code = code; return e; }

  // ---------- base64 ----------
  function toB64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return root.btoa(s);
  }
  function fromB64(str) {
    var bin = root.atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function randomBytes(n) { return root.crypto.getRandomValues(new Uint8Array(n)); }
  function randomId() {
    var b = randomBytes(6), s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }

  // ---------- Снимок данных ----------
  function isSyncKey(k) { return FIXED_KEYS.indexOf(k) >= 0 || (typeof k === 'string' && k.indexOf(GAME_PREFIX) === 0 && k.length <= 80); }

  function snapshot() {
    var data = {};
    FIXED_KEYS.concat(storage().keys(GAME_PREFIX)).forEach(function (k) {
      var v = storage().get(k, null);
      if (v !== null && v !== undefined) data[k] = v;
    });
    return { v: 1, data: data };
  }

  // Заменяет локальный прогресс данными из снимка (тема и сам сейф не трогаются)
  function applySnapshot(snap) {
    if (!snap || snap.v !== 1 || !snap.data || typeof snap.data !== 'object') throw fail('bad-file');
    FIXED_KEYS.concat(storage().keys(GAME_PREFIX)).forEach(function (k) { storage().remove(k); });
    Object.keys(snap.data).forEach(function (k) { if (isSyncKey(k)) storage().set(k, snap.data[k]); });
  }

  // Короткий отпечаток: меняется, когда прогресс изменился после сохранения
  function fingerprint(snap) {
    var s = snap || snapshot(), data = s.data, keys = Object.keys(data).sort(), h = 5381;
    var text = keys.map(function (k) { return k + '=' + JSON.stringify(data[k]); }).join('|');
    for (var i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  // ---------- Шифрование ----------
  function deriveKey(password, salt, iterations) {
    var enc = new root.TextEncoder();
    return subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return subtle().deriveKey({ name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' }, base,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }

  function checkPassword(pw) {
    return typeof pw === 'string' && pw.length >= MIN_PASSWORD && pw.length <= 200;
  }

  function encrypt(snap, password, opts) {
    var iterations = (opts && opts.iterations) || ITERATIONS;
    var salt = randomBytes(16), iv = randomBytes(12);
    return deriveKey(password, salt, iterations).then(function (key) {
      var plain = new root.TextEncoder().encode(JSON.stringify(snap));
      return subtle().encrypt({ name: 'AES-GCM', iv: iv }, key, plain);
    }).then(function (ct) {
      return { v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
    });
  }

  function validBlob(b) {
    return b && b.v === 1 && b.kdf === 'PBKDF2-SHA256' && typeof b.salt === 'string' && typeof b.iv === 'string' && typeof b.ct === 'string' &&
      typeof b.iter === 'number' && b.iter >= 1000 && b.iter <= 5000000;
  }

  function decrypt(blob, password) {
    if (!validBlob(blob)) return Promise.reject(fail('bad-file'));
    var salt, iv, ct;
    try { salt = fromB64(blob.salt); iv = fromB64(blob.iv); ct = fromB64(blob.ct); } catch (e) { return Promise.reject(fail('bad-file')); }
    return deriveKey(password, salt, blob.iter).then(function (key) {
      return subtle().decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    }).then(function (plain) {
      var snap;
      try { snap = JSON.parse(new root.TextDecoder().decode(plain)); } catch (e) { throw fail('bad-file'); }
      return snap;
    }, function () { throw fail('wrong-password'); });
  }

  // ---------- Сейф в браузере ----------
  function readVault() {
    var v = storage().get(VAULT_KEY, null);
    var list = v && Array.isArray(v.profiles) ? v.profiles : [];
    return list.filter(function (p) { return p && typeof p.id === 'string' && validBlob(p.blob); }).slice(0, MAX_PROFILES).map(function (p) {
      return { id: p.id.slice(0, 40), name: typeof p.name === 'string' ? p.name.slice(0, 20) : '', avatar: typeof p.avatar === 'number' ? p.avatar : 0, savedAt: typeof p.savedAt === 'number' ? p.savedAt : 0, blob: p.blob };
    });
  }
  function writeVault(list) { return storage().set(VAULT_KEY, { profiles: list.slice(0, MAX_PROFILES) }); }

  function listProfiles() {
    return readVault().map(function (p) { return { id: p.id, name: p.name, avatar: p.avatar, savedAt: p.savedAt }; });
  }

  function getSession() {
    var s = storage().get(SESSION_KEY, null);
    if (!s || typeof s.id !== 'string') return null;
    var entry = readVault().filter(function (p) { return p.id === s.id; })[0];
    if (!entry) return null;
    return { id: entry.id, name: entry.name, avatar: entry.avatar, savedAt: entry.savedAt, dirty: s.fp !== fingerprint() };
  }

  function putEntry(entry) {
    var list = readVault().filter(function (p) { return p.id !== entry.id; });
    list.unshift(entry);
    writeVault(list);
  }

  function entryFor(id, snap, blob) {
    var prof = snap.data['platform:profile'] || {};
    return { id: id, name: typeof prof.name === 'string' && prof.name ? prof.name.slice(0, 20) : '', avatar: typeof prof.avatar === 'number' ? prof.avatar : 0, savedAt: Date.now(), blob: blob };
  }

  // Сохраняет текущий прогресс под паролем. Для уже защищённого профиля пароль должен совпасть с прежним.
  function saveCurrent(password, opts) {
    if (!checkPassword(password)) return Promise.reject(fail('weak-password'));
    var sess = storage().get(SESSION_KEY, null), existing = sess ? readVault().filter(function (p) { return p.id === sess.id; })[0] : null;
    var check = existing ? decrypt(existing.blob, password) : Promise.resolve(null);
    return check.then(function () {
      var id = existing ? existing.id : randomId(), snap = snapshot();
      return encrypt(snap, password, opts).then(function (blob) {
        putEntry(entryFor(id, snap, blob));
        storage().set(SESSION_KEY, { id: id, fp: fingerprint(snap) });
        return { id: id, file: exportFile(id) };
      });
    });
  }

  function exportFile(id) {
    var entry = readVault().filter(function (p) { return p.id === id; })[0];
    if (!entry) return null;
    return JSON.stringify({ app: 'igroteka', id: entry.id, name: entry.name, avatar: entry.avatar, savedAt: entry.savedAt, blob: entry.blob });
  }

  function enter(entry, snap) {
    applySnapshot(snap);
    putEntry(entry);
    storage().set(SESSION_KEY, { id: entry.id, fp: fingerprint() });
    return { id: entry.id, name: entry.name };
  }

  function login(id, password) {
    var entry = readVault().filter(function (p) { return p.id === id; })[0];
    if (!entry) return Promise.reject(fail('not-found'));
    return decrypt(entry.blob, password).then(function (snap) { return enter(entry, snap); });
  }

  // Файл или код с другого устройства: JSON из exportFile
  function importFile(text, password) {
    var file;
    try { file = JSON.parse(String(text).trim()); } catch (e) { return Promise.reject(fail('bad-file')); }
    if (!file || file.app !== 'igroteka' || typeof file.id !== 'string' || !/^[0-9a-f]{12}$/.test(file.id) || !validBlob(file.blob)) return Promise.reject(fail('bad-file'));
    return decrypt(file.blob, password).then(function (snap) {
      var entry = { id: file.id, name: typeof file.name === 'string' ? file.name.slice(0, 20) : '', avatar: typeof file.avatar === 'number' ? file.avatar : 0, savedAt: typeof file.savedAt === 'number' ? file.savedAt : Date.now(), blob: file.blob };
      return enter(entry, snap);
    });
  }

  root.PlatformVault = {
    MIN_PASSWORD: MIN_PASSWORD, checkPassword: checkPassword, fingerprint: fingerprint,
    encrypt: encrypt, decrypt: decrypt, snapshot: snapshot, applySnapshot: applySnapshot,
    listProfiles: listProfiles, getSession: getSession, exportFile: exportFile,
    saveCurrent: saveCurrent, login: login, importFile: importFile
  };
})(typeof window !== 'undefined' ? window : globalThis);
