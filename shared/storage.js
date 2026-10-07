// Безопасная обёртка над localStorage.
// Любое чтение и запись обёрнуты в try/catch: если хранилище недоступно
// (приватный режим, запрет в браузере), всё продолжает работать, просто ничего не запоминается.
// Подключается обычным <script>; в браузере создаёт глобальный PlatformStorage.
(function (root) {
  function createStorage(getBackend) {
    function backend() {
      try { return getBackend() || null; } catch (e) { return null; }
    }

    return {
      // Доступно ли хранилище вообще
      available: function () {
        var b = backend();
        if (!b) return false;
        try {
          b.setItem('__platform_probe__', '1');
          b.removeItem('__platform_probe__');
          return true;
        } catch (e) { return false; }
      },
      // Значение по ключу (JSON); при любой ошибке или отсутствии — fallback
      get: function (key, fallback) {
        var b = backend();
        if (!b) return fallback;
        try {
          var raw = b.getItem(key);
          return raw === null ? fallback : JSON.parse(raw);
        } catch (e) { return fallback; }
      },
      // Записывает значение; возвращает true, если получилось
      set: function (key, value) {
        var b = backend();
        if (!b) return false;
        try { b.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
      },
      remove: function (key) {
        var b = backend();
        if (!b) return false;
        try { b.removeItem(key); return true; } catch (e) { return false; }
      }
    };
  }

  root.PlatformStorageFactory = createStorage;
  root.PlatformStorage = createStorage(function () { return root.localStorage; });
})(typeof window !== 'undefined' ? window : globalThis);
