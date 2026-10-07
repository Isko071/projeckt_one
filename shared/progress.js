// Прогресс игрока как данные: профиль, аконы, серия, рекорды игр. Из него делается снимок для облака и обратно.
//   PlatformProgress.snapshot()        → { v: 1, data: { ключ: значение } }
//   PlatformProgress.applySnapshot(s)  → заменяет локальный прогресс снимком (тема и служебные ключи не трогаются)
//   PlatformProgress.clear()           → стирает локальный прогресс (выход из аккаунта)
//   PlatformProgress.fingerprint(s)    → короткий отпечаток: меняется, когда прогресс изменился
//   PlatformProgress.isPristine(s)     → true, если игрок ещё ничего не наиграл (чистый гость)
(function (root) {
  var FIXED_KEYS = ['platform:profile', 'platform:wallet'];
  var GAME_PREFIX = 'game:';

  function storage() { return root.PlatformStorage; }
  function fail(code) { var e = new Error(code); e.code = code; return e; }
  function isSyncKey(k) { return FIXED_KEYS.indexOf(k) >= 0 || (typeof k === 'string' && k.indexOf(GAME_PREFIX) === 0 && k.length <= 80); }
  function allKeys() { return FIXED_KEYS.concat(storage().keys(GAME_PREFIX)); }

  // Модули кошелька и профиля держат запасную копию в памяти на случай недоступного хранилища; после замены её надо забыть
  function forgetMemory() {
    if (root.PlatformWallet && root.PlatformWallet.forget) root.PlatformWallet.forget();
    if (root.PlatformProfile && root.PlatformProfile.forget) root.PlatformProfile.forget();
  }

  function snapshot() {
    var data = {};
    allKeys().forEach(function (k) {
      var v = storage().get(k, null);
      if (v !== null && v !== undefined) data[k] = v;
    });
    return { v: 1, data: data };
  }

  function valid(snap) { return !!snap && snap.v === 1 && !!snap.data && typeof snap.data === 'object' && !Array.isArray(snap.data); }

  function applySnapshot(snap) {
    if (!valid(snap)) throw fail('bad-snapshot');
    if (!storage().available()) throw fail('no-storage'); // без хранилища замена стёрла бы прогресс безвозвратно
    allKeys().forEach(function (k) { storage().remove(k); });
    Object.keys(snap.data).forEach(function (k) { if (isSyncKey(k)) storage().set(k, snap.data[k]); });
    forgetMemory();
  }

  function clear() { allKeys().forEach(function (k) { storage().remove(k); }); forgetMemory(); }

  function fingerprint(snap) {
    var s = snap || snapshot(), data = s.data, keys = Object.keys(data).sort(), h = 5381;
    var text = keys.map(function (k) { return k + '=' + JSON.stringify(data[k]); }).join('|');
    for (var i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  // Профиль (имя, аватар) прогрессом не считается: чистый гость может иметь своё имя
  function isPristine(snap) {
    var s = snap || snapshot();
    var keys = Object.keys(s.data);
    if (keys.some(function (k) { return k.indexOf(GAME_PREFIX) === 0; })) return false;
    var w = s.data['platform:wallet'];
    if (!w) return true;
    var start = root.PlatformWallet ? root.PlatformWallet.CONFIG.start : 5000;
    return w.balance === start && !w.streak && !(w.log && w.log.length) && !(w.wins && Object.keys(w.wins).length);
  }

  root.PlatformProgress = { snapshot: snapshot, applySnapshot: applySnapshot, clear: clear, fingerprint: fingerprint, isPristine: isPristine, isValid: valid };
})(typeof window !== 'undefined' ? window : globalThis);
