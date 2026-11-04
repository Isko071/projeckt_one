// Подтверждение перехода из игры в каталог (главное меню).
//   <a href="../../index.html" data-leave>…</a>   — ссылка в каталог сначала спрашивает подтверждение
//   PlatformLeave.ask(url)                         — то же из кода (кнопки, которые уходят в каталог сами)
// Тексты: locales/ru.js, ключи leave.*. Стили: shared/theme.css (.leave-scrim, .leave-modal).
(function (root) {
  var open = null;
  function t(key) { return root.I18n ? root.I18n.t(key) : key; }
  function close() {
    if (!open) return;
    var prev = open.prev;
    open.el.remove(); document.removeEventListener('keydown', open.onKey, true); open = null;
    if (prev && prev.focus) { try { prev.focus(); } catch (e) { /* элемент мог исчезнуть */ } }
  }
  function ask(url) {
    if (open) return;
    var scrim = document.createElement('div');
    scrim.className = 'leave-scrim';
    scrim.innerHTML = '<div class="leave-modal" role="alertdialog" aria-modal="true" aria-labelledby="leave-title"><h2 id="leave-title"></h2><p></p>' +
      '<div class="leave-row"><button type="button" class="leave-stay"></button><button type="button" class="leave-ok"></button></div></div>';
    scrim.querySelector('h2').textContent = t('leave.title');
    scrim.querySelector('p').textContent = t('leave.text');
    scrim.querySelector('.leave-stay').textContent = t('leave.stay');
    scrim.querySelector('.leave-ok').textContent = t('leave.ok');
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    open = { el: scrim, prev: document.activeElement, onKey: onKey };
    document.addEventListener('keydown', onKey, true);
    scrim.addEventListener('click', function (e) {
      if (e.target === scrim || e.target.classList.contains('leave-stay')) close();
      else if (e.target.classList.contains('leave-ok')) { close(); if (root.PlatformLoader) root.PlatformLoader.go(url); else { try { root.dispatchEvent(new Event('platform-leave')); } catch (er) { /* старый браузер */ } root.location.href = url; } }
    });
    document.body.appendChild(scrim);
    scrim.querySelector('.leave-stay').focus();
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-leave]');
    if (!a || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    ask(a.href);
  });
  // Кнопка «Назад» браузера и жест «назад» на телефоне внутри игры: ведут себя как кнопка выхода игры.
  // Идёт партия — игра сама спросит, выходить ли (или вернётся в своё меню); на стартовом экране игры — обычный переход назад.
  // Для этого в истории браузера лежит одна лишняя запись с тем же адресом: «назад» сначала приходит на неё, и мы решаем, что делать.
  // Игра может задать свой обработчик: PlatformLeave.onBack = function () { return true, если «назад» обработан }
  var guarded = false, lastHref = root.location.href;
  // Адрес меняется через replaceState (код стола #K7M4Q в онлайне): запоминаем его, чтобы после «назад» запись-защита получила тот же адрес
  if (root.history && root.history.replaceState) {
    var origReplace = root.history.replaceState;
    root.history.replaceState = function () { var r = origReplace.apply(root.history, arguments); lastHref = root.location.href; return r; };
  }
  function visibleExit() {
    var list = document.querySelectorAll('[data-act="exit"], [data-act="menu"][data-key="exit"], .top-actions [data-act="menu"]');      // выход игры; в 2048 и «Блоках» — «←» в меню игры (партия сохраняется)
    for (var i = 0; i < list.length; i++) if (list[i].offsetParent !== null && !list[i].disabled) return list[i];
    return null;
  }
  function arm() {
    if (guarded || !root.history || !root.history.pushState) return;
    try { root.history.pushState({ guard: true }, '', lastHref); guarded = true; lastHref = root.location.href; } catch (e) { /* без защиты */ }
  }
  if (/\/games\//.test(root.location.pathname)) {
    root.addEventListener('popstate', function () {
      if (!guarded) { lastHref = root.location.href; return; }
      guarded = false;
      if (open) { close(); arm(); return; }                                   // открыто окно «Выйти в каталог?» — «назад» его закрывает
      var hook = root.PlatformLeave.onBack, handled = false;
      try { handled = hook ? !!hook() : false; } catch (e) { handled = false; }
      if (!handled) { var btn = visibleExit(); if (btn) { btn.click(); handled = true; } }
      if (handled) arm();                                                      // остались на странице: снова ставим запись-защиту
      else root.history.back();                                                // стартовый экран игры: настоящий переход назад
    });
    // Запись-защита ставится после первого касания страницы: иначе браузер может пропустить её при «назад» (защита от навязчивых сайтов)
    ['pointerdown', 'keydown'].forEach(function (t) { document.addEventListener(t, arm, true); });
    root.addEventListener('pageshow', function (e) { if (e.persisted) guarded = !!(root.history.state && root.history.state.guard); });
  }

  root.PlatformLeave = { ask: ask, onBack: null };
})(window);
