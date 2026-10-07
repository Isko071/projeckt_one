// Тексты по ключам из словарей locales/<язык>.js (window.LOCALES).
// Сейчас только русский; новый язык = новый файл словаря с теми же ключами.
// В разметке: data-i18n="ключ" (текст), data-i18n-aria-label="ключ", data-i18n-title="ключ".
(function (root) {
  var DEFAULT_LOCALE = 'ru';
  var locale = DEFAULT_LOCALE;

  function dict(name) {
    var all = root.LOCALES || {};
    return all[name] || {};
  }

  // Текст по ключу; подставляет {имя} из params. Нет перевода — берём русский, иначе сам ключ
  function t(key, params) {
    var text = dict(locale)[key];
    if (text === undefined) text = dict(DEFAULT_LOCALE)[key];
    if (text === undefined) text = key;
    if (params) {
      text = text.replace(/\{(\w+)\}/g, function (m, name) {
        return params[name] === undefined ? m : String(params[name]);
      });
    }
    return text;
  }

  function setLocale(name) {
    if (root.LOCALES && root.LOCALES[name]) locale = name;
    return locale;
  }

  // Подставляет тексты во все помеченные элементы внутри root (по умолчанию весь документ)
  function apply(scope) {
    if (typeof document === 'undefined') return;
    var node = scope || document;
    Array.prototype.forEach.call(node.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    ['aria-label', 'title'].forEach(function (attr) {
      Array.prototype.forEach.call(node.querySelectorAll('[data-i18n-' + attr + ']'), function (el) {
        el.setAttribute(attr, t(el.getAttribute('data-i18n-' + attr)));
      });
    });
    if (document.documentElement) document.documentElement.setAttribute('lang', locale);
  }

  root.I18n = { t: t, setLocale: setLocale, apply: apply, locale: function () { return locale; } };
})(typeof window !== 'undefined' ? window : globalThis);
