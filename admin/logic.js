// Личный кабинет владельца: чистая логика (разбор записей игроков, итоги, поиск, сортировка). Без обращений к window и document.
(function (root) {
  var GAMES = ['yahtzee', 'minesweeper', 'blackjack'];
  var DAY = 24 * 3600 * 1000;

  function num(v) { var n = Number(v); return isFinite(n) && n >= 0 ? n : 0; }
  function field(f, k) {
    var v = f && f[k];
    if (!v) return undefined;
    return v.stringValue !== undefined ? v.stringValue : (v.integerValue !== undefined ? Number(v.integerValue) : v.booleanValue);
  }

  // Запись users/<uid> из Firestore → строка таблицы. Ник, баланс и партии берутся из снимка прогресса (data)
  function parseDoc(doc) {
    var f = (doc && doc.fields) || {}, uid = String(doc && doc.name || '').split('/').pop();
    var snap = {};
    try { snap = JSON.parse(field(f, 'data') || '{}'); } catch (e) { snap = {}; }
    var data = (snap && snap.data) || {}, prof = data['platform:profile'] || {}, wallet = data['platform:wallet'] || {};
    var plays = {}, total = 0;
    GAMES.forEach(function (g) { var n = num(wallet.plays && wallet.plays[g]); plays[g] = n; total += n; });
    var updatedAt = num(field(f, 'updatedAt')), lastSeen = num(field(f, 'lastSeen')) || updatedAt;
    return {
      uid: uid, name: String(prof.name || '').slice(0, 40), balance: num(wallet.balance), streak: num(wallet.streak),
      createdAt: num(field(f, 'createdAt')), lastSeen: lastSeen, plays: plays, total: total
    };
  }

  function parseQuery(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (r) { return r && r.document; }).map(function (r) { return parseDoc(r.document); });
  }

  function summary(rows, now) {
    var s = { players: rows.length, activeToday: 0, active7: 0, newToday: 0, new7: 0, plays: { yahtzee: 0, minesweeper: 0, blackjack: 0 }, total: 0 };
    rows.forEach(function (r) {
      if (r.lastSeen && now - r.lastSeen < DAY) s.activeToday++;
      if (r.lastSeen && now - r.lastSeen < 7 * DAY) s.active7++;
      if (r.createdAt && now - r.createdAt < DAY) s.newToday++;
      if (r.createdAt && now - r.createdAt < 7 * DAY) s.new7++;
      GAMES.forEach(function (g) { s.plays[g] += r.plays[g]; });
      s.total += r.total;
    });
    return s;
  }

  function filterRows(rows, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return rows.slice();
    return rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0 || r.uid.toLowerCase().indexOf(q) >= 0; });
  }

  // key: name | createdAt | lastSeen | balance | total | yahtzee | minesweeper | blackjack; dir: 'asc' | 'desc'
  function sortRows(rows, key, dir) {
    var k = key || 'lastSeen', sign = dir === 'asc' ? 1 : -1;
    function val(r) { return GAMES.indexOf(k) >= 0 ? r.plays[k] : (k === 'name' ? r.name.toLowerCase() : r[k]); }
    return rows.slice().sort(function (a, b) {
      var x = val(a), y = val(b);
      if (x < y) return -sign;
      if (x > y) return sign;
      return a.uid < b.uid ? -1 : 1;
    });
  }

  // Временная правка баланса: в JSON снимка прогресса (поле data записи users/<uid>) меняется только wallet.balance
  // → { ok, json } или { ok: false }. Целое число от 0 до 10 000 000
  function withBalance(dataJson, value) {
    var n = Number(value);
    if (!isFinite(n) || n < 0 || n > 10000000 || Math.floor(n) !== n) return { ok: false };
    var snap;
    try { snap = JSON.parse(dataJson || '{}'); } catch (e) { return { ok: false }; }
    if (!snap || typeof snap !== 'object' || !snap.data || typeof snap.data !== 'object') return { ok: false };
    var w = snap.data['platform:wallet'];
    if (!w || typeof w !== 'object') w = snap.data['platform:wallet'] = {};
    w.balance = n;
    return { ok: true, json: JSON.stringify(snap) };
  }

  root.AdminLogic = { GAMES: GAMES, withBalance: withBalance, parseDoc: parseDoc, parseQuery: parseQuery, summary: summary, filterRows: filterRows, sortRows: sortRows };
})(typeof window !== 'undefined' ? window : globalThis);
