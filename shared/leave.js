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
      else if (e.target.classList.contains('leave-ok')) { close(); root.location.href = url; }
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
  root.PlatformLeave = { ask: ask };
})(window);
