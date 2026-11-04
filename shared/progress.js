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
  // Недоигранная партия (game:2048:save, game:blocks:save) меняется на каждом ходу: в облако она не уходит, иначе каждые полминуты была бы запись в базу.
  // Она остаётся на этом устройстве и стирается при выходе из аккаунта вместе с остальным
  function isLocalOnly(k) { return /:save$/.test(k); }
  function syncKeys() { return allKeys().filter(function (k) { return !isLocalOnly(k); }); }

  // Модули кошелька и профиля держат запасную копию в памяти на случай недоступного хранилища; после замены её надо забыть
  function forgetMemory() {
    if (root.PlatformWallet && root.PlatformWallet.forget) root.PlatformWallet.forget();
    if (root.PlatformProfile && root.PlatformProfile.forget) root.PlatformProfile.forget();
  }

  // При серверном балансе кошелёк в браузере это копия: в сравнении «что изменилось» и при замене снимком он не участвует (иначе на втором устройстве возникал бы ложный конфликт)
  // Это и пока сервер ещё не ответил (статус «подключаемся»): сервер забирает прогресс с устройства один раз при первой синхронизации, а дальше хранит его сам
  function walletIsServer() {
    var S = root.PlatformWalletSync;
    if (S && S.status && S.status() !== 'local') return true;
    return !!(root.PlatformWallet && root.PlatformWallet.serverOn && root.PlatformWallet.serverOn());
  }
  function snapshot() {
    var data = {};
    syncKeys().forEach(function (k) {
      var v = storage().get(k, null);
      if (v !== null && v !== undefined) data[k] = v;
    });
    return { v: 1, data: data };
  }

  function valid(snap) { return !!snap && snap.v === 1 && !!snap.data && typeof snap.data === 'object' && !Array.isArray(snap.data); }

  function applySnapshot(snap) {
    if (!valid(snap)) throw fail('bad-snapshot');
    if (!storage().available()) throw fail('no-storage'); // без хранилища замена стёрла бы прогресс безвозвратно
    var keep = walletIsServer() ? 'platform:wallet' : null;
    syncKeys().forEach(function (k) { if (k !== keep) storage().remove(k); });
    Object.keys(snap.data).forEach(function (k) { if (isSyncKey(k) && !isLocalOnly(k) && k !== keep) storage().set(k, snap.data[k]); });
    forgetMemory();
  }

  function clear() { allKeys().forEach(function (k) { storage().remove(k); }); forgetMemory(); }

  function fingerprint(snap) {
    var s = snap || snapshot(), data = s.data, keys = Object.keys(data).sort(), h = 5381;
    if (walletIsServer()) keys = keys.filter(function (k) { return k !== 'platform:wallet'; });
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

  // Объединение прогресса двух устройств: главнее то, что на этом устройстве, но рекорды не теряются —
  // лучший счёт 2048 и «Блоков» берётся наибольший, лучшее время «Сапёра» по каждому уровню — наименьшее
  function isCount(v) { return typeof v === 'number' && isFinite(v) && v >= 0; }
  function mergeValue(k, cloudV, localV) {
    if (localV === undefined) return cloudV;
    if (cloudV === undefined) return localV;
    if (/^game:[a-z0-9-]+:best$/.test(k) && isCount(cloudV) && isCount(localV)) return Math.max(cloudV, localV);
    if (k === 'game:minesweeper:best' && cloudV && localV && typeof cloudV === 'object' && typeof localV === 'object') {
      var out = {};
      Object.keys(cloudV).concat(Object.keys(localV)).forEach(function (lv) {
        var a = isCount(cloudV[lv]) ? cloudV[lv] : null, b = isCount(localV[lv]) ? localV[lv] : null;
        out[lv] = a === null ? b : b === null ? a : Math.min(a, b);
      });
      return out;
    }
    return localV;
  }
  function merge(cloudSnap, localSnap) {
    var c = (cloudSnap && cloudSnap.data) || {}, l = (localSnap && localSnap.data) || {}, data = {};
    Object.keys(c).concat(Object.keys(l)).forEach(function (k) { if (!(k in data)) data[k] = mergeValue(k, c[k], l[k]); });
    return { v: 1, data: data };
  }

  root.PlatformProgress = { snapshot: snapshot, applySnapshot: applySnapshot, clear: clear, fingerprint: fingerprint, isPristine: isPristine, isValid: valid, merge: merge };
})(typeof window !== 'undefined' ? window : globalThis);
