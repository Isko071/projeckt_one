// Окно «Рейтинг игроков»: топ по балансу из Firestore (shared/rating.js). Читать рейтинг могут только вошедшие игроки.
(function () {
  var I = window.I18n, t = I.t, Cloud = window.PlatformCloud, P = window.PlatformProfile;
  var $ = function (id) { return document.getElementById(id); };
  var dialog = $('rating-dialog'), body = $('rating-body');
  var TOP = 30, token = 0;

  function fmt(n) { return Number(n).toLocaleString('ru-RU'); }
  function note(text, retry) {
    body.textContent = '';
    var p = document.createElement('p'); p.className = 'rating-note'; p.textContent = text; body.appendChild(p);
    if (retry) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn-secondary'; b.textContent = t('rating.retry'); b.addEventListener('click', load); body.appendChild(b); }
  }
  function rowEl(r, i, me) {
    var li = document.createElement('li'), place = document.createElement('span'), av = document.createElement('span'), nm = document.createElement('span'), bal = document.createElement('b');
    li.className = 'rating-row' + (r.uid === me ? ' me' : '') + (i < 3 ? ' top' : '');
    place.className = 'rk'; place.textContent = String(i + 1);
    av.className = 'av'; av.style.background = P.avatarColor(r.avatar); av.textContent = r.icon || P.initial(r.name);
    nm.className = 'nm'; nm.textContent = r.name || t('profile.defaultName');
    bal.className = 'bal'; bal.textContent = fmt(r.balance) + ' ' + I.plural(r.balance, 'wallet.unit');
    [place, av, nm, bal].forEach(function (x) { li.appendChild(x); });
    return li;
  }
  function load() {
    var st = Cloud.getState(), my = ++token;
    if (!st.user) { note(t('rating.signin')); return; }
    if (!window.PlatformRating) { note(t('rating.error'), true); return; }
    note(t('rating.loading'));
    Cloud.getToken().then(function (tk) {
      var api = window.PlatformRating.create({ fetch: function (u, i) { return window.fetch(u, i); }, projectId: window.FIREBASE_CONFIG.projectId, db: window.FIREBASE_DATABASE });
      return api.top(tk, TOP);
    }).then(function (rows) {
      if (my !== token) return;
      if (!rows.length) { note(t('rating.empty')); return; }
      body.textContent = '';
      var ol = document.createElement('ol'); ol.className = 'rating-list';
      rows.forEach(function (r, i) { ol.appendChild(rowEl(r, i, st.user.uid)); });
      body.appendChild(ol);
    }, function (e) { if (my === token) note(t(e && e.code === 'denied' ? 'rating.denied' : 'rating.error'), true); });
  }
  function openDialog() { dialog.showModal(); load(); }
  function closeDialog() { token++; if (dialog.open) dialog.close(); }

  $('rating-open').addEventListener('click', openDialog);
  $('rating-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', function (e) { if (e.target === dialog) closeDialog(); });
  Cloud.onChange(function () { if (dialog.open) load(); });
  I.apply();
})();
