// Рейтинг игроков: у каждого вошедшего игрока в Firestore есть публичная строка ratings/<uid> (имя, аватар, баланс),
// которую обновляет сам игрок, а читают все вошедшие. Правила базы: docs/rating.md.
//   var rating = PlatformRating.create({ fetch, projectId, db })
//   rating.rowFields(profile, balance) → { name, avatar, icon, balance } (очищенная строка)
//   rating.fingerprint(profile, balance) → строка: менялась ли строка с прошлой отправки
//   rating.publish(token, uid, profile, balance) → Promise;  rating.top(token, limit) → Promise<[{ uid, name, avatar, icon, balance }]>
// Ошибки: { code: 'denied' | 'http-<код>' }; без сети fetch сам отклонит запрос.
// Баланс считается в браузере игрока, поэтому рейтинг по балансу честен лишь настолько, насколько честны игроки (docs/wallet.md).
(function (root) {
  var MAX_NAME = 20, MAX_BALANCE = 1000000000;

  function fail(code) { var e = new Error(code); e.code = code; return e; }

  function cleanName(v) { return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim(); }
  function cleanInt(v, max) { var n = Math.floor(Number(v)); return isFinite(n) && n >= 0 ? Math.min(n, max) : 0; }

  function rowFields(profile, balance) {
    var p = profile || {};
    return { name: cleanName(p.name), avatar: cleanInt(p.avatar, 99), icon: typeof p.icon === 'string' ? p.icon.slice(0, 8) : '', balance: cleanInt(balance, MAX_BALANCE) };
  }
  function fingerprint(profile, balance) { var r = rowFields(profile, balance); return [r.name, r.avatar, r.icon, r.balance].join('|'); }

  function create(env) {
    var base = 'https://firestore.googleapis.com/v1/projects/' + env.projectId + '/databases/' + env.db + '/documents';
    function req(method, url, token, body) {
      return env.fetch(url, { method: method, headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    }
    function check(res) {
      if (res.status === 401 || res.status === 403) throw fail('denied');
      if (!res.ok) throw fail('http-' + res.status);
      return res;
    }
    function publish(token, uid, profile, balance) {
      var r = rowFields(profile, balance);
      var body = { fields: { name: { stringValue: r.name }, avatar: { integerValue: String(r.avatar) }, icon: { stringValue: r.icon }, balance: { integerValue: String(r.balance) }, updatedAt: { integerValue: String(Date.now()) } } };
      return req('PATCH', base + '/ratings/' + encodeURIComponent(uid), token, body).then(check).then(function () { return true; });
    }
    function field(f, key) { var v = f && f[key]; return v ? (v.stringValue !== undefined ? v.stringValue : v.integerValue) : undefined; }
    function top(token, limit) {
      var body = { structuredQuery: { from: [{ collectionId: 'ratings' }], orderBy: [{ field: { fieldPath: 'balance' }, direction: 'DESCENDING' }], limit: Math.max(1, Math.min(100, limit || 20)) } };
      return req('POST', base + ':runQuery', token, body).then(check).then(function (res) { return res.json(); }).then(function (rows) {
        var out = [];
        (Array.isArray(rows) ? rows : []).forEach(function (r) {
          if (!r || !r.document) return;
          var f = r.document.fields || {}, uid = String(r.document.name || '').split('/').pop();
          var row = rowFields({ name: field(f, 'name'), avatar: field(f, 'avatar'), icon: field(f, 'icon') }, field(f, 'balance'));
          out.push({ uid: uid, name: row.name, avatar: row.avatar, icon: row.icon, balance: row.balance });
        });
        return out;
      });
    }
    // ----- Победы онлайн: ratings_wins/<игра>/rows/<uid>, победа прибавляется на единицу (правила базы не дают прибавить больше) -----
    function recordWin(token, uid, profile, game) {
      var r = rowFields(profile, 0), name = 'projects/' + env.projectId + '/databases/' + env.db + '/documents/ratings_wins/' + game + '/rows/' + encodeURIComponent(uid);
      var body = { writes: [
        { update: { name: name, fields: { name: { stringValue: r.name }, avatar: { integerValue: String(r.avatar) }, icon: { stringValue: r.icon } } }, updateMask: { fieldPaths: ['name', 'avatar', 'icon'] } },
        { transform: { document: name, fieldTransforms: [{ fieldPath: 'wins', increment: { integerValue: '1' } }] } }
      ] };
      return req('POST', base + ':commit', token, body).then(check).then(function () { return true; });
    }
    function topWins(token, game, limit) {
      var body = { structuredQuery: { from: [{ collectionId: 'rows' }], orderBy: [{ field: { fieldPath: 'wins' }, direction: 'DESCENDING' }], limit: Math.max(1, Math.min(100, limit || 5)) } };
      return req('POST', base + '/ratings_wins/' + encodeURIComponent(game) + ':runQuery', token, body).then(check).then(function (res) { return res.json(); }).then(function (rows) {
        var out = [];
        (Array.isArray(rows) ? rows : []).forEach(function (r) {
          if (!r || !r.document) return;
          var f = r.document.fields || {}, uid = String(r.document.name || '').split('/').pop();
          var row = rowFields({ name: field(f, 'name'), avatar: field(f, 'avatar'), icon: field(f, 'icon') }, 0);
          out.push({ uid: uid, name: row.name, avatar: row.avatar, icon: row.icon, wins: cleanInt(field(f, 'wins'), MAX_BALANCE) });
        });
        return out;
      });
    }
    return { rowFields: rowFields, fingerprint: fingerprint, publish: publish, top: top, recordWin: recordWin, topWins: topWins };
  }

  // Игры, где считаются победы онлайн
  var WIN_GAMES = ['yahtzee', 'blackjack', 'poker-simple', 'battleship'];

  // Для браузера: засчитать победу онлайн этому игроку (один вызов на выигранную партию); без входа и без правил базы ничего не делает
  function reportWin(game) {
    var C = root.PlatformCloud, P = root.PlatformProfile;
    if (WIN_GAMES.indexOf(game) < 0 || !C || !P || !C.getState().user || !root.FIREBASE_CONFIG || typeof root.fetch !== 'function') return Promise.resolve(false);
    return C.getToken().then(function (tk) {
      var api = create({ fetch: function (u, i) { return root.fetch(u, i); }, projectId: root.FIREBASE_CONFIG.projectId, db: root.FIREBASE_DATABASE });
      return api.recordWin(tk, C.getState().user.uid, P.getProfile(), game);
    }).then(function () { return true; }, function () { return false; });
  }

  root.PlatformRating = { create: create, rowFields: rowFields, fingerprint: fingerprint, reportWin: reportWin, WIN_GAMES: WIN_GAMES, MAX_NAME: MAX_NAME };
})(typeof window !== 'undefined' ? window : globalThis);
