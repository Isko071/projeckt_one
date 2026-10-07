// Каталог (этап 2): сетка карточек, главный постер, адрес #id, кнопка темы.
// Профиль появится на этапе 3.
(function () {
  var L = window.CatalogLogic, games = window.GAMES || [], t = window.I18n.t;

  var el = {
    themeBtn: document.getElementById('theme-btn'),
    grid: document.getElementById('grid'),
    empty: document.getElementById('catalog-empty'),
    wrap: document.getElementById('poster-wrap'),
    poster: document.getElementById('poster'),
    cover: document.getElementById('poster-cover'),
    title: document.getElementById('poster-title'),
    desc: document.getElementById('poster-desc'),
    actions: document.getElementById('poster-actions'),
    close: document.getElementById('poster-close')
  };

  var selectedId = null;   // выбранная игра (null — виден только список)
  var shownId = null;      // чья информация сейчас в постере (остаётся при сворачивании)
  var lastCard = null;     // карточка, к которой вернуть фокус после закрытия постера

  // ---------- Кнопка темы ----------
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>';

  // Показываем действие, которое произойдёт по нажатию
  function renderThemeButton() {
    var dark = window.PlatformTheme.isDark();
    el.themeBtn.innerHTML = dark ? SUN : MOON;
    el.themeBtn.setAttribute('aria-label', t(dark ? 'theme.toLight' : 'theme.toDark'));
  }

  // ---------- Сетка ----------
  function renderGrid() {
    el.grid.textContent = '';
    games.forEach(function (game) {
      var soon = !L.isPlayable(game);
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'card' + (soon ? ' is-soon' : '');
      card.setAttribute('role', 'listitem');
      card.setAttribute('data-id', game.id);
      card.setAttribute('aria-pressed', 'false');

      var frame = document.createElement('span');
      frame.className = 'card-cover';
      var img = document.createElement('img');
      img.src = game.cover;
      img.alt = '';
      img.width = 200; img.height = 250;
      img.loading = 'lazy';
      frame.appendChild(img);
      if (soon) {
        var badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = t('catalog.soon');
        frame.appendChild(badge);
      }

      var name = document.createElement('span');
      name.className = 'card-title';
      name.textContent = t(game.titleKey);

      card.appendChild(frame);
      card.appendChild(name);
      card.addEventListener('click', function () { lastCard = card; go(game.id); });
      el.grid.appendChild(card);
    });
    el.empty.hidden = games.length > 0;
  }

  // ---------- Главный постер ----------
  function fillPoster(game) {
    el.cover.src = game.cover;
    el.title.textContent = t(game.titleKey);
    el.desc.textContent = t(game.descriptionKey);
    el.actions.textContent = '';
    if (L.isPlayable(game)) {
      var link = document.createElement('a');
      link.className = 'btn-play';
      link.href = L.playHref(game);
      link.textContent = t('catalog.play');
      el.actions.appendChild(link);
    } else {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-play';
      btn.disabled = true;
      btn.textContent = t('catalog.play');
      var note = document.createElement('span');
      note.className = 'soon-note';
      note.textContent = t('catalog.soon');
      el.actions.appendChild(btn);
      el.actions.appendChild(note);
    }
  }

  function render() {
    var game = selectedId ? L.findGame(games, selectedId) : null;
    if (game && shownId !== game.id) { fillPoster(game); shownId = game.id; }

    var open = !!game;
    el.wrap.classList.toggle('is-open', open);
    // Свёрнутый постер недоступен ни мышью, ни клавиатурой, ни читалке экрана
    if (open) { el.poster.removeAttribute('inert'); el.poster.removeAttribute('aria-hidden'); }
    else { el.poster.setAttribute('inert', ''); el.poster.setAttribute('aria-hidden', 'true'); }

    Array.prototype.forEach.call(el.grid.children, function (card) {
      card.setAttribute('aria-pressed', String(card.getAttribute('data-id') === selectedId));
    });
  }

  // ---------- Навигация: состояние хранится в адресе (#id) ----------
  function go(id) {
    var hash = L.hashForId(id);
    if (location.hash === hash || (!hash && !location.hash)) { syncFromHash(); return; }
    location.hash = hash; // сработает hashchange → syncFromHash
  }

  function syncFromHash() {
    var wasOpen = selectedId !== null;
    selectedId = L.idFromHash(location.hash, games);
    render();
    // После закрытия возвращаем фокус на карточку, чтобы не потерять место при работе с клавиатуры
    if (wasOpen && selectedId === null && lastCard) lastCard.focus();
  }

  window.addEventListener('hashchange', syncFromHash);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && selectedId !== null) go(null);
  });
  el.close.addEventListener('click', function () { go(null); });

  // ---------- Запуск ----------
  window.I18n.apply();
  renderThemeButton();
  el.themeBtn.addEventListener('click', function () { window.PlatformTheme.toggle(); });
  window.PlatformTheme.onChange(renderThemeButton);

  renderGrid();
  selectedId = L.idFromHash(location.hash, games);
  render();
})();
