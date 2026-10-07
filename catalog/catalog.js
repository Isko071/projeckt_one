// Каталог (этап 1): подставляет тексты, подключает кнопку темы.
// Список игр, главный постер и профиль появятся на следующих этапах.
(function () {
  var button = document.getElementById('theme-btn');

  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>';

  // Иконка и подпись кнопки зависят от текущей темы: показываем действие, которое произойдёт
  function renderThemeButton() {
    var dark = window.PlatformTheme.isDark();
    button.innerHTML = dark ? SUN : MOON;
    button.setAttribute('aria-label', window.I18n.t(dark ? 'theme.toLight' : 'theme.toDark'));
  }

  window.I18n.apply();
  renderThemeButton();

  button.addEventListener('click', function () { window.PlatformTheme.toggle(); });
  window.PlatformTheme.onChange(renderThemeButton);
})();
