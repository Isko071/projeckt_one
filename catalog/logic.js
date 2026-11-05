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

  // Статистика по играм для окна «Статистика»: партии и победы из кошелька складываются по игре
  // (источники вида «checkers-easy» и «checkers» — одна игра), лучший результат — из рекордов игр.
  // games — реестр, rec — PlatformWallet.records(), bests — { 2048: число, blocks: число, minesweeper: { novice, amateur, expert } }
  // Ответ: строки только по играм, в которые играли: { id, plays, wins, rate (0–100 или null), best (число) | bestTime ({ уровень: секунды }) }
  var LEVELS = ['easy', 'medium', 'hard', 'expert'];
  function gameOf(source, ids) {
    if (ids.indexOf(source) >= 0) return source;
    var cut = source.lastIndexOf('-');
    return cut > 0 && LEVELS.indexOf(source.slice(cut + 1)) >= 0 && ids.indexOf(source.slice(0, cut)) >= 0 ? source.slice(0, cut) : null;
  }
  // В этих играх «победой» кошелёк считает награду за рубеж (плитка 512, 1000 очков), а не выигранную партию: процент там не показываем
  var NO_WINS = ['2048', 'blocks', 'mines'];
  function gameStats(games, rec, bests) {
    var ids = games.filter(function (g) { return g.status === 'available'; }).map(function (g) { return g.id; }), by = {};
    ids.forEach(function (id) { by[id] = { id: id, plays: 0, wins: 0 }; });
    Object.keys((rec && rec.plays) || {}).forEach(function (k) { var g = gameOf(k, ids); if (g) by[g].plays += rec.plays[k]; });
    Object.keys((rec && rec.wins) || {}).forEach(function (k) { var g = gameOf(k, ids); if (g) by[g].wins += rec.wins[k]; });
    bests = bests || {};
    return ids.map(function (id) {
      var r = by[id];
      r.wins = NO_WINS.indexOf(id) >= 0 && id !== 'mines' ? null : Math.min(r.wins, r.plays || r.wins);
      r.rate = r.plays && r.wins !== null ? Math.round(r.wins / r.plays * 100) : null;
      if (typeof bests[id] === 'number' && bests[id] > 0) r.best = bests[id];
      if (id === 'minesweeper' && bests.minesweeper && typeof bests.minesweeper === 'object') {
        var t = {};
        Object.keys(bests.minesweeper).forEach(function (lv) { var v = bests.minesweeper[lv]; if (typeof v === 'number' && isFinite(v) && v >= 0) t[lv] = v; });
        if (Object.keys(t).length) r.bestTime = t;
      }
      return r;
    }).filter(function (r) { return r.plays > 0 || r.best || r.bestTime; });
  }

  root.CatalogLogic = {
    findGame: findGame, idFromHash: idFromHash, hashForId: hashForId,
    isPlayable: isPlayable, playHref: playHref, validateRegistry: validateRegistry, gameStats: gameStats
  };
})(typeof window !== 'undefined' ? window : globalThis);
