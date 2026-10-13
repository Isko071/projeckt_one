// Окно «Рейтинг игроков»: топ по балансу, победы онлайн по играм и быстрые победы в «Сапёре» (Firestore, shared/rating.js; всё это пишет сервер). Читать рейтинг могут только вошедшие игроки.
(function () {
  var I = window.I18n, t = I.t, Cloud = window.PlatformCloud, P = window.PlatformProfile;
  var $ = function (id) { return document.getElementById(id); };
  var dialog = $('rating-dialog'), body = $('rating-body');
  var TOP = 30, SECTION = 5, token = 0, tab = 'balance';
  var WIN_GAMES = ['yahtzee', 'blackjack', 'poker-simple', 'battleship'], LEVELS = ['novice', 'amateur', 'expert'];
  var tabsEl = $('rating-tabs');

  function fmt(n) { return Number(n).toLocaleString('ru-RU'); }
  function note(text, retry) {
    body.textContent = '';
    var p = document.createElement('p'); p.className = 'rating-note'; p.textContent = text; body.appendChild(p);
    if (retry) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn-secondary'; b.textContent = t('rating.retry'); b.addEventListener('click', load); body.appendChild(b); }
  }
  function mmss(sec) { var m = Math.floor(sec / 60), s = sec % 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
  function rowEl(r, i, me, value) {
    var li = document.createElement('li'), place = document.createElement('span'), av = document.createElement('span'), nm = document.createElement('span'), bal = document.createElement('b');
    li.className = 'rating-row' + (r.uid === me ? ' me' : '') + (i < 3 ? ' top' : '');
    place.className = 'rk'; place.textContent = String(i + 1);
    av.className = 'av'; av.style.background = P.avatarColor(r.avatar); av.textContent = r.icon || P.initial(r.name);
    nm.className = 'nm'; nm.textContent = r.name || t('profile.defaultName');
    bal.className = 'bal'; bal.textContent = value !== undefined ? value : fmt(r.balance) + ' ' + I.plural(r.balance, 'wallet.unit');
    [place, av, nm, bal].forEach(function (x) { li.appendChild(x); });
    return li;
  }
  function tabsRender() {
    tabsEl.textContent = '';
    ['balance', 'wins', 'fast'].forEach(function (k) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'rating-tab'; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(k === tab)); b.textContent = t('rating.tab.' + k);
      b.addEventListener('click', function () { if (tab !== k) { tab = k; tabsRender(); load(); } });
      tabsEl.appendChild(b);
    });
  }
  // Раздел с заголовком и пятёркой лучших; rows — [{...}], value(r) → текст справа
  function sectionEl(title, rows, me, value) {
    var sec = document.createElement('section'); sec.className = 'rating-sec';
    var h = document.createElement('h3'); h.className = 'rating-sec-title'; h.textContent = title; sec.appendChild(h);
    if (!rows.length) { var e = document.createElement('p'); e.className = 'rating-note'; e.textContent = t('rating.section.empty'); sec.appendChild(e); return sec; }
    var ol = document.createElement('ol'); ol.className = 'rating-list short';
    rows.forEach(function (r, i) { ol.appendChild(rowEl(r, i, me, value(r))); });
    sec.appendChild(ol);
    return sec;
  }
  function load() {
    var st = Cloud.getState(), my = ++token, mine = tab;
    if (!st.user) { note(t('rating.signin')); return; }
    if (!window.PlatformRating) { note(t('rating.error'), true); return; }
    note(t('rating.loading'));
    var api, uid = st.user.uid;
    Cloud.getToken().then(function (tk) {
      api = window.PlatformRating.create({ fetch: function (u, i) { return window.fetch(u, i); }, projectId: window.FIREBASE_CONFIG.projectId, db: window.FIREBASE_DATABASE });
      if (mine === 'wins') return Promise.all(WIN_GAMES.map(function (g) { return api.topWins(tk, g, SECTION); }));
      if (mine === 'fast') return Promise.all(LEVELS.map(function (l) { return api.topFast(tk, l, SECTION); }));
      return api.top(tk, TOP);
    }).then(function (data) {
      if (my !== token) return;
      body.textContent = '';
      if (mine === 'balance') {
        if (!data.length) { note(t('rating.empty')); return; }
        var ol = document.createElement('ol'); ol.className = 'rating-list';
        data.forEach(function (r, i) { ol.appendChild(rowEl(r, i, uid)); });
        body.appendChild(ol);
        return;
      }
      var sub = document.createElement('p'); sub.className = 'rating-sub'; sub.textContent = t(mine === 'wins' ? 'rating.wins.sub' : 'rating.fast.sub'); body.appendChild(sub);
      if (mine === 'wins') data.forEach(function (rows, i) { body.appendChild(sectionEl(t('games.' + WIN_GAMES[i] + '.title'), rows, uid, function (r) { return String(r.wins); })); });
      else data.forEach(function (rows, i) { body.appendChild(sectionEl(t('rating.fast.' + LEVELS[i]), rows, uid, function (r) { return mmss(r.time); })); });
    }, function (e) { if (my === token) note(t(e && e.code === 'denied' ? 'rating.denied' : 'rating.error'), true); });
  }
  function openDialog() { dialog.showModal(); tabsRender(); load(); }
  function closeDialog() { token++; if (dialog.open) dialog.close(); }

  $('rating-open').addEventListener('click', openDialog);
  $('rating-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', function (e) { if (e.target === dialog) closeDialog(); });
  Cloud.onChange(function () { if (dialog.open) load(); });
  I.apply();
})();
