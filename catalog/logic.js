// Чистая логика каталога (без DOM): поиск игры, адрес, проверка реестра. Тестируется через node.
(function (root) {
  var REQUIRED = ['id', 'status', 'path', 'cover', 'titleKey', 'descriptionKey'];
  var STATUSES = ['available', 'soon'];

  function findGame(games, id) {
    for (var i = 0; i < games.length; i++) if (games[i].id === id) return games[i];
    return null;
  }

  // Идентификатор игры из адресного хеша (#yahtzee). Неизвестное или пустое — null
  function idFromHash(hash, games) {
    var id = String(hash || '').replace(/^#/, '');
    try { id = decodeURIComponent(id); } catch (e) { return null; }
    return findGame(games, id) ? id : null;
  }

  function hashForId(id) {
    return id ? '#' + encodeURIComponent(id) : '';
  }

  function isPlayable(game) {
    return !!game && game.status === 'available';
  }

  // Адрес страницы игры: папка + index.html (работает и при открытии файла с диска)
  function playHref(game) {
    return game.path.replace(/\/?$/, '/') + 'index.html';
  }

  // Список проблем реестра (пустой — всё в порядке)
  function validateRegistry(games) {
    var problems = [], seen = {};
    if (!Array.isArray(games) || games.length === 0) return ['реестр пуст или не массив'];
    games.forEach(function (g, i) {
      var where = 'игра №' + (i + 1) + (g && g.id ? ' (' + g.id + ')' : '');
      REQUIRED.forEach(function (field) {
        if (!g || typeof g[field] !== 'string' || g[field] === '') problems.push(where + ': нет поля ' + field);
      });
      if (g && g.id) {
        if (!/^[a-z0-9-]+$/.test(g.id)) problems.push(where + ': id должен быть латиницей, цифрами и дефисом');
        if (seen[g.id]) problems.push(where + ': повторяется id');
        seen[g.id] = true;
      }
      if (g && STATUSES.indexOf(g.status) < 0) problems.push(where + ': неизвестный status ' + g.status);
    });
    return problems;
  }

  root.CatalogLogic = {
    findGame: findGame, idFromHash: idFromHash, hashForId: hashForId,
    isPlayable: isPlayable, playHref: playHref, validateRegistry: validateRegistry
  };
})(typeof window !== 'undefined' ? window : globalThis);
