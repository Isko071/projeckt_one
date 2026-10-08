// Личный кабинет владельца: список игроков из Firestore. Доступ проверяют правила базы (читать чужие записи users может только админ),
// страница лишь показывает результат: чужой аккаунт получит отказ от самой базы.
(function () {
  var Cloud = window.PlatformCloud, L = window.AdminLogic, tr = function (k, p) { return window.I18n.t(k, p); };
  var app = document.getElementById('app');
  var st = { rows: null, error: null, loading: false, query: '', sort: 'lastSeen', dir: 'desc', loadedAt: 0 };

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
    }).then(function (rows) { st.rows = L.parseQuery(rows); st.loadedAt = Date.now(); st.loading = false; render(); },
      function (e) { st.loading = false; st.error = e && e.message === 'denied' ? 'denied' : 'network'; render(); });
  }

  function head(key, label, cls) {
    var on = st.sort === key;
    return '<th class="' + (cls || '') + '" aria-sort="' + (on ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-sort="' + key + '">' + esc(label) + (on ? (st.dir === 'asc' ? ' ▲' : ' ▼') : '') + '</button></th>';
  }

  function tableHtml() {
    var rows = L.sortRows(L.filterRows(st.rows, st.query), st.sort, st.dir), s = L.summary(st.rows, Date.now());
    var cards = [['players', s.players], ['activeToday', s.activeToday], ['active7', s.active7], ['newToday', s.newToday], ['new7', s.new7], ['plays', s.total]].map(function (c) {
      return '<div class="card"><b>' + fmt(c[1]) + '</b><span>' + esc(tr('admin.sum.' + c[0])) + '</span></div>';
    }).join('');
    var body = rows.map(function (r) {
      return '<tr><td class="nm">' + esc(r.name || tr('admin.noName')) + '<small>' + esc(r.uid.slice(0, 8)) + '</small></td><td>' + esc(fmtDate(r.createdAt)) + '</td><td>' + esc(fmtDate(r.lastSeen)) + '<small>' + esc(ago(r.lastSeen)) + '</small></td>' +
        '<td class="n">' + fmt(r.balance) + '</td><td class="n">' + r.plays.yahtzee + '</td><td class="n">' + r.plays.minesweeper + '</td><td class="n">' + r.plays.blackjack + '</td><td class="n">' + r.total + '</td></tr>';
    }).join('');
    return '<div class="cards">' + cards + '</div>' +
      '<div class="tools"><input id="q" type="search" value="' + esc(st.query) + '" placeholder="' + esc(tr('admin.search')) + '" aria-label="' + esc(tr('admin.search')) + '"><button type="button" class="btn" data-act="reload">' + esc(tr('admin.reload')) + '</button></div>' +
      '<p class="note">' + esc(tr('admin.note', { time: fmtDate(st.loadedAt), shown: rows.length })) + '</p>' +
      '<div class="tbl"><table><thead><tr>' + head('name', tr('admin.col.name')) + head('createdAt', tr('admin.col.created')) + head('lastSeen', tr('admin.col.seen')) + head('balance', tr('admin.col.balance'), 'n') +
      head('yahtzee', tr('admin.col.yahtzee'), 'n') + head('minesweeper', tr('admin.col.minesweeper'), 'n') + head('blackjack', tr('admin.col.blackjack'), 'n') + head('total', tr('admin.col.total'), 'n') + '</tr></thead><tbody>' +
      (body || '<tr><td colspan="8" class="empty">' + esc(tr('admin.empty')) + '</td></tr>') + '</tbody></table></div>';
  }

  function render() {
    var c = Cloud.getState(), inner;
    if (c.status === 'unsupported') inner = '<p class="msg">' + esc(tr('admin.unsupported')) + '</p>';
    else if (c.status !== 'signedIn') inner = '<p class="msg">' + esc(tr('admin.signin.text')) + '</p><button type="button" class="btn primary" data-act="signin">' + esc(tr('admin.signin')) + '</button>';
    else if (st.error === 'denied') inner = '<p class="msg bad" role="alert">' + esc(tr('admin.denied')) + '</p><button type="button" class="btn" data-act="signout">' + esc(tr('admin.signout')) + '</button>';
    else if (st.error) inner = '<p class="msg bad" role="alert">' + esc(tr('admin.error')) + '</p><button type="button" class="btn" data-act="reload">' + esc(tr('admin.reload')) + '</button>';
    else if (!st.rows) inner = '<p class="msg" role="status">' + esc(tr('admin.loading')) + '</p>';
    else inner = tableHtml();
    var keep = document.activeElement && document.activeElement.id === 'q' ? document.activeElement.selectionStart : -1;
    app.innerHTML = '<header class="top"><h1>' + esc(tr('admin.title')) + '</h1><a href="../index.html">' + esc(tr('admin.toSite')) + '</a></header>' + inner;
    if (keep >= 0) { var q = document.getElementById('q'); if (q) { q.focus(); q.setSelectionRange(keep, keep); } }
  }

  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act], [data-sort]');
    if (!b) return;
    if (b.dataset.sort) { var k = b.dataset.sort; st.dir = st.sort === k ? (st.dir === 'asc' ? 'desc' : 'asc') : (k === 'name' ? 'asc' : 'desc'); st.sort = k; render(); return; }
    if (b.dataset.act === 'signin') Cloud.signIn().then(null, function () { render(); });
    else if (b.dataset.act === 'signout') { Cloud.signOut(true).then(function () { st.error = null; st.rows = null; render(); }); }
    else if (b.dataset.act === 'reload') { st.rows = st.rows; load(); }
  });
  app.addEventListener('input', function (e) { if (e.target.id === 'q') { st.query = e.target.value; render(); } });

  var loadedFor = null;
  Cloud.onChange(function (c) {
    if (c.status === 'signedIn' && loadedFor !== c.user.uid) { loadedFor = c.user.uid; load(); }
    else if (c.status !== 'signedIn') { loadedFor = null; st.rows = null; st.error = null; render(); }
    else render();
  });
  render();
})();
