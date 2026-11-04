// Личный кабинет владельца: список игроков из Firestore. Доступ проверяют правила базы (читать чужие записи users может только админ),
// страница лишь показывает результат: чужой аккаунт получит отказ от самой базы.
(function () {
  var Cloud = window.PlatformCloud, L = window.AdminLogic, tr = function (k, p) { return window.I18n.t(k, p); };
  var app = document.getElementById('app');
  var st = { tab: 'players', srv: null, srvError: null, srvLoading: false, rows: null, error: null, loading: false, query: '', sort: 'lastSeen', dir: 'desc', loadedAt: 0 };

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(ms) {
    if (!ms) return '—';
    var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function ago(ms) {
    if (!ms) return '';
    var m = Math.max(0, Math.floor((Date.now() - ms) / 60000));
    if (m < 1) return tr('admin.ago.now');
    if (m < 60) return tr('admin.ago.min', { n: m });
    if (m < 1440) return tr('admin.ago.hour', { n: Math.floor(m / 60) });
    return tr('admin.ago.day', { n: Math.floor(m / 1440) });
  }
  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  function load() {
    if (st.loading) return;
    st.loading = true; st.error = null; render();
    Cloud.getToken().then(function (tk) {
      var cfg = window.FIREBASE_CONFIG, url = 'https://firestore.googleapis.com/v1/projects/' + cfg.projectId + '/databases/' + window.FIREBASE_DATABASE + '/documents:runQuery';
      return window.fetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'users' }], limit: 1000 } }) });
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) throw new Error('denied');
      if (!res.ok) throw new Error('http');
      return res.json();
    }).then(function (rows) {
      var list = L.parseQuery(rows);
      // баланс и партии с сервера (при серверном балансе облачная копия отстаёт); сервер недоступен — показываем облачную копию
      return loadWallets().then(function (w) { return L.withServer(list, w); }, function () { return list; });
    }).then(function (rows) { st.rows = rows; st.loadedAt = Date.now(); st.loading = false; render(); },
      function (e) { st.loading = false; st.error = e && e.message === 'denied' ? 'denied' : 'network'; render(); });
  }

  function loadWallets() {
    var base = serverUrl();
    if (!base) return Promise.reject(new Error('nourl'));
    return Cloud.getToken().then(function (tk) { return window.fetch(base + '/admin/wallets', { headers: { 'Authorization': 'Bearer ' + tk }, cache: 'no-store' }); })
      .then(function (res) { if (!res.ok) throw new Error('http'); return res.json(); })
      .then(function (d) { return d && d.wallets; });
  }

  // ---------- Вкладка «Сервер»: данные отдаёт сервер столов (только владельцу) ----------
  function serverUrl() { return String(window.GAME_SERVER_URL || '').replace(/^ws/, 'http').replace(/\/+$/, ''); }
  function loadServer(silent) {
    if (st.srvLoading) return;
    var base = serverUrl();
    if (!base) { st.srvError = 'nourl'; render(); return; }
    st.srvLoading = true; if (!silent) { st.srvError = null; render(); }
    Cloud.getToken().then(function (tk) { return window.fetch(base + '/admin/stats', { headers: { 'Authorization': 'Bearer ' + tk }, cache: 'no-store' }); })
      .then(function (res) { if (res.status === 401 || res.status === 403) throw new Error('denied'); if (!res.ok) throw new Error('http'); return res.json(); })
      .then(function (d) { st.srv = d; st.srvError = null; st.srvLoading = false; if (st.tab !== 'players' || errorsFresh()) render(); },
        function (e) { st.srvLoading = false; st.srvError = e && e.message === 'denied' ? 'denied' : 'network'; if (st.tab !== 'players') render(); });
  }
  function dur(ms) {
    var m = Math.floor(ms / 60000);
    if (m < 60) return tr('admin.dur.min', { n: m });
    if (m < 1440) return tr('admin.dur.hour', { h: Math.floor(m / 60), m: m % 60 });
    return tr('admin.dur.day', { d: Math.floor(m / 1440), h: Math.floor((m % 1440) / 60) });
  }
  function gameName(g) { return tr('admin.col.' + g); }
  function serverHtml() {
    if (st.srvError === 'nourl') return '<p class="msg bad" role="alert">' + esc(tr('admin.srv.nourl')) + '</p>';
    if (st.srvError === 'denied') return '<p class="msg bad" role="alert">' + esc(tr('admin.srv.denied')) + '</p>';
    if (!st.srv) return st.srvError ? '<p class="msg bad" role="alert">' + esc(tr('admin.srv.error')) + '</p><button type="button" class="btn" data-act="reloadSrv">' + esc(tr('admin.reload')) + '</button>' : '<p class="msg" role="status">' + esc(tr('admin.srv.loading')) + '</p>';
    var d = st.srv, c = d.counters, created = Object.keys(c.created).reduce(function (a, k) { return a + c.created[k]; }, 0);
    var cards = [[d.conns, 'conns'], [d.rooms, 'rooms'], [created, 'created'], [c.joins, 'joins'], [c.starts, 'starts'], [c.errors + c.denied, 'errors']].map(function (x) {
      return '<div class="card"><b>' + fmt(x[0]) + '</b><span>' + esc(tr('admin.srv.' + x[1])) + '</span></div>';
    }).join('');
    var tables = d.tables.map(function (t) {
      return '<tr><td class="nm">' + esc(t.code) + (t.private ? ' 🔒' : '') + '</td><td>' + esc(gameName(t.game)) + '</td><td>' + esc(tr('admin.status.' + (t.status || 'lobby'))) + '</td><td class="n">' + t.players.length + '/' + t.size + '</td><td class="wrap">' + esc(t.players.join(', ')) + '</td><td class="n">' + t.online + '</td></tr>';
    }).join('');
    var events = d.events.slice(0, 100).map(function (e) {
      return '<tr><td>' + esc(fmtDate(e.t)) + '</td><td>' + esc(tr('admin.ev.' + e.type)) + (e.info ? ' <small>' + esc(tr('admin.info.' + e.info) === 'admin.info.' + e.info ? e.info : tr('admin.info.' + e.info)) + '</small>' : '') + '</td><td>' + esc(e.game ? gameName(e.game) : '') + '</td><td>' + esc(e.code) + '</td><td class="wrap">' + esc(e.name || '') + (e.uid ? ' <small>' + esc(e.uid) + '</small>' : '') + '</td></tr>';
    }).join('');
    return '<div class="cards">' + cards + '</div><p class="note">' + esc(tr('admin.srv.note', { up: dur(d.uptimeMs), peak: c.peakConns, rooms: c.peakRooms, time: fmtDate(d.now) })) + '</p>' +
      '<h2 class="h2">' + esc(tr('admin.srv.tables')) + '</h2><div class="tbl"><table><thead><tr><th>' + esc(tr('admin.srv.code')) + '</th><th>' + esc(tr('admin.srv.game')) + '</th><th>' + esc(tr('admin.srv.status')) + '</th><th class="n">' + esc(tr('admin.srv.players')) + '</th><th>' + esc(tr('admin.srv.names')) + '</th><th class="n">' + esc(tr('admin.srv.onlineNow')) + '</th></tr></thead><tbody>' +
      (tables || '<tr><td colspan="6" class="empty">' + esc(tr('admin.srv.noTables')) + '</td></tr>') + '</tbody></table></div>' +
      '<h2 class="h2">' + esc(tr('admin.srv.events')) + '</h2><div class="tbl"><table><thead><tr><th>' + esc(tr('admin.srv.time')) + '</th><th>' + esc(tr('admin.srv.event')) + '</th><th>' + esc(tr('admin.srv.game')) + '</th><th>' + esc(tr('admin.srv.code')) + '</th><th>' + esc(tr('admin.srv.player')) + '</th></tr></thead><tbody>' +
      (events || '<tr><td colspan="5" class="empty">' + esc(tr('admin.srv.noEvents')) + '</td></tr>') + '</tbody></table></div>';
  }
  // ---------- Вкладка «Ошибки»: что ломается у игроков (из браузеров) и на сервере ----------
  var DAY_MS = 24 * 3600 * 1000;
  function errorsFresh() {                       // сколько разных ошибок было за сутки (значок на вкладке)
    var d = st.srv;
    if (!d || !d.clientErrors) return 0;
    return d.clientErrors.filter(function (e) { return d.now - e.last < DAY_MS; }).length;
  }
  function errorsHtml() {
    if (st.srvError === 'nourl') return '<p class="msg bad" role="alert">' + esc(tr('admin.srv.nourl')) + '</p>';
    if (st.srvError === 'denied') return '<p class="msg bad" role="alert">' + esc(tr('admin.srv.denied')) + '</p>';
    if (!st.srv) return st.srvError ? '<p class="msg bad" role="alert">' + esc(tr('admin.srv.error')) + '</p><button type="button" class="btn" data-act="reloadSrv">' + esc(tr('admin.reload')) + '</button>' : '<p class="msg" role="status">' + esc(tr('admin.srv.loading')) + '</p>';
    var d = st.srv, list = d.clientErrors || [], total = list.reduce(function (a, e) { return a + e.count; }, 0);
    var srvErr = d.events.filter(function (e) { return e.type === 'error'; });
    var cards = [[errorsFresh(), 'err.day'], [list.length, 'err.kinds'], [total, 'err.total'], [d.counters.errors, 'err.server']].map(function (x) {
      return '<div class="card' + (x[1] === 'err.day' && x[0] ? ' warn' : '') + '"><b>' + fmt(x[0]) + '</b><span>' + esc(tr('admin.' + x[1])) + '</span></div>';
    }).join('');
    var rows = list.map(function (e) {
      return '<tr><td>' + esc(fmtDate(e.last)) + '<small>' + esc(ago(e.last)) + '</small></td>' +
        '<td class="wrap"><details><summary><b>' + esc(e.msg) + '</b>' + (e.where ? '<small>' + esc(e.where) + '</small>' : '') + '</summary>' + (e.stack ? '<pre>' + esc(e.stack) + '</pre>' : '') + '<small>' + esc(tr('admin.err.first', { time: fmtDate(e.first) })) + '</small></details></td>' +
        '<td class="wrap">' + esc(e.pages.join(', ')) + '</td><td class="wrap">' + esc(e.browsers.join(', ')) + '</td><td class="n">' + fmt(e.count) + '</td></tr>';
    }).join('');
    var srows = srvErr.slice(0, 50).map(function (e) {
      return '<tr><td>' + esc(fmtDate(e.t)) + '</td><td>' + esc(e.info ? (tr('admin.info.' + e.info) === 'admin.info.' + e.info ? e.info : tr('admin.info.' + e.info)) : '') + '</td><td>' + esc(e.game ? tr('admin.col.' + e.game) : '') + '</td><td class="wrap">' + esc(e.name || '') + (e.uid ? ' <small>' + esc(e.uid) + '</small>' : '') + '</td></tr>';
    }).join('');
    return '<div class="cards">' + cards + '</div><p class="note">' + esc(tr('admin.err.note', { up: dur(d.uptimeMs), time: fmtDate(d.now) })) + '</p>' +
      '<h2 class="h2">' + esc(tr('admin.err.client')) + '</h2><div class="tbl"><table><thead><tr><th>' + esc(tr('admin.err.last')) + '</th><th>' + esc(tr('admin.err.msg')) + '</th><th>' + esc(tr('admin.err.pages')) + '</th><th>' + esc(tr('admin.err.browsers')) + '</th><th class="n">' + esc(tr('admin.err.count')) + '</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="empty">' + esc(tr('admin.err.none')) + '</td></tr>') + '</tbody></table></div>' +
      '<h2 class="h2">' + esc(tr('admin.err.serverTitle')) + '</h2><div class="tbl"><table><thead><tr><th>' + esc(tr('admin.srv.time')) + '</th><th>' + esc(tr('admin.err.what')) + '</th><th>' + esc(tr('admin.srv.game')) + '</th><th>' + esc(tr('admin.srv.player')) + '</th></tr></thead><tbody>' +
      (srows || '<tr><td colspan="4" class="empty">' + esc(tr('admin.err.serverNone')) + '</td></tr>') + '</tbody></table></div>';
  }
  function tabsHtml() {
    var stats = '<a class="tab ext" href="https://dash.cloudflare.com/?to=/:account/web-analytics" target="_blank" rel="noopener">' + esc(tr('admin.tab.visits')) + ' ↗</a>';
    var fresh = errorsFresh();
    return '<div class="tabs" role="tablist">' + ['players', 'server', 'errors'].map(function (k) {
      return '<button type="button" role="tab" class="tab" aria-selected="' + (st.tab === k) + '" data-tab="' + k + '">' + esc(tr('admin.tab.' + k)) + (k === 'errors' && fresh ? ' <span class="badge">' + fresh + '</span>' : '') + '</button>';
    }).join('') + stats + '</div>';
  }

  function head(key, label, cls, title) {
    var on = st.sort === key;
    return '<th class="' + (cls || '') + '" aria-sort="' + (on ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-sort="' + key + '"' + (title ? ' title="' + esc(title) + '" aria-label="' + esc(title) + '"' : '') + '>' + esc(label) + (on ? (st.dir === 'asc' ? ' ▲' : ' ▼') : '') + '</button></th>';
  }

  function tableHtml() {
    var rows = L.sortRows(L.filterRows(st.rows, st.query), st.sort, st.dir), s = L.summary(st.rows, Date.now());
    var cards = [['players', s.players], ['activeToday', s.activeToday], ['active7', s.active7], ['newToday', s.newToday], ['new7', s.new7], ['plays', s.total]].map(function (c) {
      return '<div class="card"><b>' + fmt(c[1]) + '</b><span>' + esc(tr('admin.sum.' + c[0])) + '</span></div>';
    }).join('');
    var body = rows.map(function (r) {
      return '<tr><td class="nm">' + esc(r.name || tr('admin.noName')) + '<small>' + esc(r.uid.slice(0, 8)) + '</small></td><td>' + esc(fmtDate(r.createdAt)) + '</td><td>' + esc(fmtDate(r.lastSeen)) + '<small>' + esc(ago(r.lastSeen)) + '</small></td>' +
        '<td class="n">' + fmt(r.balance) + '</td>' + L.GAMES.map(function (g) { return '<td class="n">' + r.plays[g] + '</td>'; }).join('') + '<td class="n">' + r.total + '</td></tr>';
    }).join('');
    return '<div class="cards">' + cards + '</div>' +
      '<div class="tools"><input id="q" type="search" value="' + esc(st.query) + '" placeholder="' + esc(tr('admin.search')) + '" aria-label="' + esc(tr('admin.search')) + '"><button type="button" class="btn" data-act="reload">' + esc(tr('admin.reload')) + '</button></div>' +
      '<p class="note">' + esc(tr('admin.note', { time: fmtDate(st.loadedAt), shown: rows.length })) + '</p>' +
      '<div class="tbl"><table><thead><tr>' + head('name', tr('admin.col.name')) + head('createdAt', tr('admin.col.created')) + head('lastSeen', tr('admin.col.seen')) + head('balance', tr('admin.col.balance'), 'n') +
      L.GAMES.map(function (g, i) { return head(g, String(i + 1), 'n', tr('admin.col.' + g)); }).join('') + head('total', tr('admin.col.total'), 'n') + '</tr></thead><tbody>' +
      (body || '<tr><td colspan="' + (L.GAMES.length + 5) + '" class="empty">' + esc(tr('admin.empty')) + '</td></tr>') + '</tbody></table></div>';
  }

  function render() {
    var c = Cloud.getState(), inner;
    if (c.status === 'unsupported') inner = '<p class="msg">' + esc(tr('admin.unsupported')) + '</p>';
    else if (c.status !== 'signedIn') inner = '<p class="msg">' + esc(tr('admin.signin.text')) + '</p><button type="button" class="btn primary" data-act="signin">' + esc(tr('admin.signin')) + '</button>';
    else if (st.tab === 'server') inner = tabsHtml() + serverHtml();
    else if (st.tab === 'errors') inner = tabsHtml() + errorsHtml();
    else if (st.error === 'denied') inner = '<p class="msg bad" role="alert">' + esc(tr('admin.denied')) + '</p><button type="button" class="btn" data-act="signout">' + esc(tr('admin.signout')) + '</button>';
    else if (st.error) inner = tabsHtml() + '<p class="msg bad" role="alert">' + esc(tr('admin.error')) + '</p><button type="button" class="btn" data-act="reload">' + esc(tr('admin.reload')) + '</button>';     // вкладки «Сервер» и «Ошибки» нужны и тогда, когда список игроков не загрузился
    else if (!st.rows) inner = tabsHtml() + '<p class="msg" role="status">' + esc(tr('admin.loading')) + '</p>';
    else inner = tabsHtml() + tableHtml();
    var keep = document.activeElement && document.activeElement.id === 'q' ? document.activeElement.selectionStart : -1;
    app.innerHTML = '<header class="top"><h1>' + esc(tr('admin.title')) + '</h1><a href="../index.html">' + esc(tr('admin.toSite')) + '</a></header>' + inner;
    if (keep >= 0) { var q = document.getElementById('q'); if (q) { q.focus(); q.setSelectionRange(keep, keep); } }
  }

  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act], [data-sort], [data-tab]');
    if (!b) return;
    if (b.dataset.tab) { st.tab = b.dataset.tab; if (st.tab === 'server' || st.tab === 'errors') loadServer(false); render(); return; }
    if (b.dataset.act === 'reloadSrv') { loadServer(false); return; }
    if (b.dataset.sort) { var k = b.dataset.sort; st.dir = st.sort === k ? (st.dir === 'asc' ? 'desc' : 'asc') : (k === 'name' ? 'asc' : 'desc'); st.sort = k; render(); return; }
    if (b.dataset.act === 'signin') Cloud.signIn().then(null, function () { render(); });
    else if (b.dataset.act === 'signout') { Cloud.signOut(true).then(function () { st.error = null; st.rows = null; render(); }); }
    else if (b.dataset.act === 'reload') { if (st.tab === 'server' || st.tab === 'errors') loadServer(false); else load(); }
  });
  app.addEventListener('input', function (e) { if (e.target.id === 'q') { st.query = e.target.value; render(); } });

  setInterval(function () { if ((st.tab === 'server' || st.tab === 'errors') && !document.hidden && Cloud.getState().status === 'signedIn') loadServer(true); }, 10000);

  var loadedFor = null;
  Cloud.onChange(function (c) {
    if (c.status === 'signedIn' && loadedFor !== c.user.uid) { loadedFor = c.user.uid; load(); }
    else if (c.status !== 'signedIn') { loadedFor = null; st.rows = null; st.error = null; st.srv = null; render(); }
    else render();
  });
  render();
})();
