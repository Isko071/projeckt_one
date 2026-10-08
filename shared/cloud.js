// Вход через Google и облачное сохранение прогресса (Firebase Auth + Firestore по REST).
// Сервера у сайта нет: браузер обращается к Firebase сам, а правила базы пускают игрока только к его записи users/<uid>.
//   PlatformCloud.start({ allowDownload })  → запускает вход и синхронизацию (подключается на каждой странице)
//   PlatformCloud.signIn(), signOut(force), syncNow(), resolveConflict('cloud' | 'local')
//   PlatformCloud.getState() → { status, user, sync, conflict, error }, onChange(fn)
//   status: 'unsupported' | 'signedOut' | 'signedIn';  sync: 'idle' | 'syncing' | 'error' | 'conflict' | 'paused'
// Когда игрок вошёл, прогресс на этом устройстве и в облаке сверяется (shared/sync-logic.js).
// Если новее облако — оно заменяет локальный прогресс; если новее устройство — загружается в облако;
// если изменились обе стороны — игрока спрашивают, что оставить.
(function (root) {
  var SYNC_KEY = 'platform:sync';
  var CHECK_MS = 15000;
  var cfg = root.FIREBASE_CONFIG, dbName = root.FIREBASE_DATABASE;
  var PP = root.PlatformProgress, Logic = root.PlatformSyncLogic;

  var state = { status: 'unsupported', user: null, sync: 'idle', conflict: null, error: null };
  var listeners = [], auth = null, running = false, started = false, allowDownload = true, timerId = null;

  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) { /* подписчик не должен ломать остальных */ } }); }
  function setSync(s, err) { state.sync = s; state.error = err || null; emit(); }
  function fail(code) { var e = new Error(code); e.code = code; return e; }

  function supported() {
    return !!(root.firebase && root.firebase.auth && cfg && cfg.projectId && root.location && /^https?:$/.test(root.location.protocol));
  }

  // ---------- Отпечаток последней синхронизации ----------
  function readBase(uid) {
    var b = root.PlatformStorage.get(SYNC_KEY, null);
    return b && b.uid === uid && typeof b.fp === 'string' ? b.fp : null;
  }
  function writeBase(uid, fp) { root.PlatformStorage.set(SYNC_KEY, { uid: uid, fp: fp }); }

  // ---------- Firestore по REST ----------
  function docUrl(uid) {
    return 'https://firestore.googleapis.com/v1/projects/' + cfg.projectId + '/databases/' + dbName + '/documents/users/' + encodeURIComponent(uid);
  }
  function request(method, uid, token, body) {
    return root.fetch(docUrl(uid), {
      method: method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  function fetchCloud(uid, token) {
    return request('GET', uid, token).then(function (res) {
      if (res.status === 404) return null;
      if (res.status === 401 || res.status === 403) throw fail('denied');
      if (!res.ok) throw fail('http-' + res.status);
      return res.json().then(function (doc) {
        var f = doc && doc.fields, text = f && f.data && f.data.stringValue, snap;
        try { snap = JSON.parse(text); } catch (e) { throw fail('bad-cloud-data'); }
        if (!PP.isValid(snap)) throw fail('bad-cloud-data');
        var at = f.updatedAt && f.updatedAt.integerValue ? Number(f.updatedAt.integerValue) : 0;
        return { snap: snap, updatedAt: at };
      });
    });
  }
  // Время регистрации берётся из данных аккаунта Firebase; вместе с временем последнего визита оно нужно личному кабинету владельца
  function createdAtOf() {
    var u = auth && auth.currentUser, t = u && u.metadata && u.metadata.creationTime ? Date.parse(u.metadata.creationTime) : 0;
    return t > 0 ? t : Date.now();
  }
  function upload(uid, token, snap) {
    var body = { fields: { data: { stringValue: JSON.stringify(snap) }, updatedAt: { integerValue: String(Date.now()) }, v: { integerValue: '1' }, createdAt: { integerValue: String(createdAtOf()) }, lastSeen: { integerValue: String(Date.now()) } } };
    return request('PATCH', uid, token, body).then(function (res) {
      if (res.status === 401 || res.status === 403) throw fail('denied');
      if (!res.ok) throw fail('http-' + res.status);
    });
  }

  // Отметка визита без изменения прогресса: обновляются только createdAt и lastSeen (раз за загрузку страницы)
  var seenSent = false;
  function touchSeen(uid, tk) {
    if (seenSent) return Promise.resolve();
    seenSent = true;
    var body = { fields: { createdAt: { integerValue: String(createdAtOf()) }, lastSeen: { integerValue: String(Date.now()) } } };
    return root.fetch(docUrl(uid) + '?updateMask.fieldPaths=createdAt&updateMask.fieldPaths=lastSeen', { method: 'PATCH', headers: { 'Authorization': 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function () { /* отметка не критична */ }, function () { seenSent = false; });
  }

  function token() { return auth.currentUser.getIdToken(); }

  function meta(snap, updatedAt) {
    var w = snap.data['platform:wallet'] || {};
    return { balance: typeof w.balance === 'number' ? w.balance : null, streak: typeof w.streak === 'number' ? w.streak : 0, updatedAt: updatedAt || 0 };
  }

  function reload() { try { root.location.reload(); } catch (e) { /* без перезагрузки */ } }

  // Имя и фото из Google подставляются, пока профиль не настроен (имя по умолчанию)
  function adoptName() {
    var u = state.user;
    if (!u || !root.PlatformProfile) return;
    var def = root.I18n ? root.I18n.t('profile.defaultName') : 'Игрок';
    var prof = root.PlatformProfile.getProfile();
    if (prof.name !== def) return;
    var change = {};
    if (u.name) change.name = u.name;
    if (u.photo && !prof.icon) change.google = true; // выбранный эмодзи фото не вытесняет
    if (change.name || change.google) root.PlatformProfile.saveProfile(change);
  }

  // ---------- Синхронизация ----------
  function syncNow() {
    if (running || !state.user || state.conflict) return Promise.resolve();
    running = true;
    var uid = state.user.uid;
    setSync('syncing');
    return token().then(function (tk) {
      return fetchCloud(uid, tk).then(function (cloud) {
        var local = PP.snapshot(), localFp = PP.fingerprint(local);
        var cloudFp = cloud ? PP.fingerprint(cloud.snap) : null;
        var d = Logic.decide({ localFp: localFp, baseFp: readBase(uid), cloudFp: cloudFp, localPristine: PP.isPristine(local) });
        if (d === 'none') { writeBase(uid, localFp); adoptName(); return touchSeen(uid, tk).then(function () { return 'idle'; }); }
        if (d === 'upload') { adoptName(); var s2 = PP.snapshot(); return upload(uid, tk, s2).then(function () { seenSent = true; writeBase(uid, PP.fingerprint(s2)); return 'idle'; }); }
        if (d === 'download') {
          if (!allowDownload) return 'paused';       // на странице игры не перезагружаемся: это сделает каталог
          PP.applySnapshot(cloud.snap);
          writeBase(uid, PP.fingerprint());
          reload();
          return 'idle';
        }
        state.conflict = { cloud: meta(cloud.snap, cloud.updatedAt), local: meta(local, 0), cloudSnap: cloud.snap };
        return 'conflict';
      });
    }).then(function (result) { running = false; setSync(result); }, function (err) {
      running = false;
      setSync('error', err && err.code ? err.code : 'network');
    });
  }

  function resolveConflict(choice) {
    var c = state.conflict;
    if (!c || !state.user) return Promise.resolve();
    var uid = state.user.uid;
    if (choice === 'cloud') {
      PP.applySnapshot(c.cloudSnap);
      writeBase(uid, PP.fingerprint());
      state.conflict = null;
      reload();
      return Promise.resolve();
    }
    state.conflict = null;
    running = true;
    setSync('syncing');
    var snap = PP.snapshot();
    return token().then(function (tk) { return upload(uid, tk, snap); }).then(function () {
      writeBase(uid, PP.fingerprint(snap)); running = false; setSync('idle');
    }, function (err) { running = false; setSync('error', err && err.code ? err.code : 'network'); });
  }

  // Периодическая проверка: если прогресс на устройстве изменился, отправляем его
  function checkDirty() {
    if (!state.user || running || state.conflict) return;
    if (PP.fingerprint() !== readBase(state.user.uid)) syncNow();
  }

  // ---------- Вход и выход ----------
  function signIn() {
    if (!auth) return Promise.reject(fail('unsupported'));
    var provider = new root.firebase.auth.GoogleAuthProvider();
    return auth.signInWithPopup(provider).then(function () { return { ok: true }; }, function (e) {
      var code = e && e.code ? String(e.code) : 'unknown';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return { ok: false, cancelled: true };
      throw fail(code);
    });
  }

  // Выход: сначала отправляем несохранённое. Без force выход отменяется, если отправить не удалось.
  function signOut(force) {
    if (!auth || !state.user) return Promise.resolve({ ok: true });
    var uid = state.user.uid;
    var pre = PP.fingerprint() !== readBase(uid) ? syncNow() : Promise.resolve();
    return pre.then(function () {
      var unsaved = PP.fingerprint() !== readBase(uid);
      if (unsaved && !force) return { ok: false, unsaved: true };
      return auth.signOut().then(function () {
        PP.clear();
        root.PlatformStorage.remove(SYNC_KEY);
        return { ok: true };
      });
    });
  }

  function start(opts) {
    if (started) return;
    started = true;
    allowDownload = !opts || opts.allowDownload !== false;
    if (!supported()) { state.status = 'unsupported'; emit(); return; }
    try {
      if (!root.firebase.apps.length) root.firebase.initializeApp(cfg);
      auth = root.firebase.auth();
    } catch (e) { state.status = 'unsupported'; emit(); return; }
    state.status = 'signedOut';
    auth.onAuthStateChanged(function (u) {
      if (u) {
        state.user = { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' };
        state.status = 'signedIn';
        emit();
        syncNow();
      } else {
        state.user = null; state.status = 'signedOut'; state.conflict = null; state.sync = 'idle'; emit();
      }
    });
    timerId = root.setInterval(checkDirty, CHECK_MS);
    if (root.document) root.document.addEventListener('visibilitychange', function () { if (root.document.visibilityState === 'hidden') checkDirty(); });
    if (root.addEventListener) root.addEventListener('pagehide', checkDirty);
  }

  root.PlatformCloud = {
    start: start, signIn: signIn, signOut: signOut, syncNow: syncNow, resolveConflict: resolveConflict,
    getToken: function () { return auth && auth.currentUser ? auth.currentUser.getIdToken() : Promise.reject(fail('signed-out')); },
    getState: function () { return state; }, onChange: function (fn) { listeners.push(fn); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
