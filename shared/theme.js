// Тема: светлая / тёмная. Без явного выбора следует системной (prefers-color-scheme).
// Выбор хранится в platform:theme и общий для каталога и всех игр.
// Подключается в <head>, чтобы тема применялась до первой отрисовки (без мигания).
(function (root) {
  var KEY = 'platform:theme';

  // Чистые функции (тестируются отдельно)
  function normalize(value) {
    return value === 'light' || value === 'dark' ? value : null;
  }

  // Тёмная ли тема: явный выбор главнее системной настройки
  function resolveDark(choice, systemDark) {
    var c = normalize(choice);
    return c === null ? !!systemDark : c === 'dark';
  }

  // Какой выбор записать при нажатии на кнопку: противоположный текущему виду
  function nextChoice(choice, systemDark) {
    return resolveDark(choice, systemDark) ? 'light' : 'dark';
  }

  function systemDark() {
    try { return !!root.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  }

  var listeners = [];
  // Запасной выбор на случай недоступного хранилища: действует до перезагрузки страницы
  var memory = null;

  function getChoice() {
    var storage = root.PlatformStorage;
    return normalize(storage ? storage.get(KEY, null) : null) || memory;
  }

  function isDark() {
    return resolveDark(getChoice(), systemDark());
  }

  function apply() {
    if (typeof document === 'undefined') return;
    var html = document.documentElement, choice = getChoice();
    if (choice === null) html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', choice);
  }

  function notify() {
    var dark = isDark();
    listeners.forEach(function (fn) { try { fn(dark); } catch (e) { /* подписчик не должен ломать остальных */ } });
  }

  function toggle() {
    var choice = nextChoice(getChoice(), systemDark());
    memory = choice;
    if (root.PlatformStorage) root.PlatformStorage.set(KEY, choice);
    apply();
    notify();
    return choice;
  }

  function onChange(fn) { listeners.push(fn); }

  // Следим за системной темой, пока явный выбор не сделан
  try {
    root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (getChoice() === null) notify();
    });
  } catch (e) { /* matchMedia недоступен */ }

  apply();

  root.PlatformTheme = {
    KEY: KEY, normalize: normalize, resolveDark: resolveDark, nextChoice: nextChoice,
    getChoice: function () { return getChoice(); }, isDark: isDark, toggle: toggle, onChange: onChange, apply: apply
  };
})(typeof window !== 'undefined' ? window : globalThis);
