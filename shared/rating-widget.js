// Рейтинг побед онлайн в меню игры: постоянная плашка (внизу на телефоне, в углу на компьютере) с топ-5 игры.
//   PlatformRatingWidget.mount({ game, visible })   game — id игры; visible() → true, пока на экране меню игры
// Показывается только вошедшим игрокам и только если рейтинг доступен (правила базы: docs/rating.md); обновляется раз в минуту.
(function (root) {
  var TOP = 5, REFRESH_MS = 60000;

  function mount(opts) {
    var I = root.I18n, t = I.t, P = root.PlatformProfile, C = root.PlatformCloud, doc = root.document;
    var el = doc.createElement('aside'), shown = false, loadedAt = 0, loading = false, rows = null;
    el.className = 'rw'; el.hidden = true; el.setAttribute('aria-label', t('rating.wins'));
    doc.body.appendChild(el);

    function render() {
      el.textContent = '';
      var title = doc.createElement('div'); title.className = 'rw-title'; title.textContent = t('rating.wins'); el.appendChild(title);
      var me = C.getState().user ? C.getState().user.uid : '';
      if (!rows.length) { var n = doc.createElement('div'); n.className = 'rw-empty'; n.textContent = t('rating.wins.empty'); el.appendChild(n); return; }
      var ol = doc.createElement('ol'); ol.className = 'rw-list';
      rows.forEach(function (r, i) {
        var li = doc.createElement('li'), rk = doc.createElement('span'), av = doc.createElement('span'), nm = doc.createElement('span'), w = doc.createElement('b');
        li.className = 'rw-row' + (r.uid === me ? ' me' : '');
        rk.className = 'rk'; rk.textContent = String(i + 1);
        av.className = 'av'; av.style.background = P.avatarColor(r.avatar); av.textContent = r.icon || P.initial(r.name);
        nm.className = 'nm'; nm.textContent = r.name || t('profile.defaultName');
        w.textContent = String(r.wins);
        [rk, av, nm, w].forEach(function (x) { li.appendChild(x); });
        ol.appendChild(li);
      });
      el.appendChild(ol);
    }
    function hide() { el.hidden = true; doc.body.classList.remove('rw-on'); shown = false; }
    function show() { el.hidden = false; doc.body.classList.add('rw-on'); shown = true; }

    function load() {
      if (loading || !C.getState().user || !root.PlatformRating) return;
      loading = true;
      C.getToken().then(function (tk) {
        var api = root.PlatformRating.create({ fetch: function (u, i) { return root.fetch(u, i); }, projectId: root.FIREBASE_CONFIG.projectId, db: root.FIREBASE_DATABASE });
        return api.topWins(tk, opts.game, TOP);
      }).then(function (list) { rows = list; loadedAt = Date.now(); loading = false; render(); if (opts.visible()) show(); }, function () { rows = null; loading = false; loadedAt = Date.now(); hide(); });
    }

    function tick() {
      var want = !!opts.visible() && !!C.getState().user;
      if (!want) { if (shown) hide(); return; }
      if (Date.now() - loadedAt > REFRESH_MS) load();
      else if (rows && !shown) show();
    }
    root.setInterval(tick, 1000);
    C.onChange(function () { loadedAt = 0; tick(); });
    tick();
  }

  root.PlatformRatingWidget = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
