// Локальный профиль игрока: имя и аватар. Хранится только в этом браузере (platform:profile), пароля нет.
// Все остальные части сайта и игры обращаются к профилю только через этот модуль:
//   PlatformProfile.getProfile()  → { name, avatar, icon?, google? }
//   PlatformProfile.saveProfile({ name, avatar, icon, google })
//   avatar — номер цвета кружка; icon — эмодзи из EMOJIS (если выбран); google — true, если показывать фото Google-аккаунта
//   Что показывать в кружке: фото Google (если вошли и google = true), иначе эмодзи, иначе первая буква имени.
// Когда появятся настоящие аккаунты, изменится только внутренность этого файла.
(function (root) {
  var KEY = 'platform:profile';
  var MAX_NAME = 20;
  var AVATAR_HUES = [175, 25, 85, 250, 320, 140, 200, 50];
  var FALLBACK_NAME = 'Игрок';
  // Эмодзи для аватара (только из этого списка, чтобы в профиль не попал произвольный текст)
  var EMOJIS = ['😀', '😎', '🤓', '🥳', '😺', '🐶', '🦊', '🐼', '🐸', '🦁', '🐯', '🐵', '🐧', '🦄', '🐙', '🐢', '🚀', '⭐', '🔥', '🎲', '🃏', '🎮', '👑', '🍀'];

  var listeners = [];
  // Запасной вариант на случай недоступного хранилища: действует до перезагрузки страницы
  var memory = null;

  // Имя по умолчанию берётся из словаря, если он подключён
  function defaultName() {
    return root.I18n ? root.I18n.t('profile.defaultName') : FALLBACK_NAME;
  }

  // Приводит произвольные данные к корректному профилю. fallback — что оставить, если поле неверно
  function sanitize(raw, fallback) {
    var base = fallback || { name: defaultName(), avatar: 0 };
    var name = raw && typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim() : '';
    var avatar = raw ? raw.avatar : undefined;
    var okAvatar = typeof avatar === 'number' && isFinite(avatar) && avatar % 1 === 0 && avatar >= 0 && avatar < AVATAR_HUES.length;
    var out = { name: name || base.name, avatar: okAvatar ? avatar : base.avatar };
    var icon = raw && raw.icon !== undefined ? raw.icon : base.icon;
    if (EMOJIS.indexOf(icon) >= 0) out.icon = icon;
    var google = raw && raw.google !== undefined ? raw.google : base.google;
    if (google === true) out.google = true;
    return out;
  }

  // Первая буква имени для кружка аватара
  function initial(name) {
    var first = String(name || '').trim().charAt(0);
    return first ? first.toUpperCase() : '?';
  }

  function avatarColor(index) {
    var i = index >= 0 && index < AVATAR_HUES.length ? index : 0;
    return 'oklch(0.82 0.09 ' + AVATAR_HUES[i] + ')';
  }

  function getProfile() {
    var stored = root.PlatformStorage ? root.PlatformStorage.get(KEY, null) : null;
    return sanitize(stored || memory);
  }

  function saveProfile(next) {
    var saved = sanitize(next, getProfile());
    memory = saved;
    if (root.PlatformStorage) root.PlatformStorage.set(KEY, saved);
    listeners.forEach(function (fn) { try { fn(saved); } catch (e) { /* подписчик не должен ломать остальных */ } });
    return saved;
  }

  function onChange(fn) { listeners.push(fn); }
  function forget() { memory = null; }

  root.PlatformProfile = {
    KEY: KEY, MAX_NAME: MAX_NAME, AVATAR_COUNT: AVATAR_HUES.length, EMOJIS: EMOJIS.slice(),
    sanitize: sanitize, initial: initial, avatarColor: avatarColor,
    getProfile: getProfile, saveProfile: saveProfile, onChange: onChange, forget: forget
  };
})(typeof window !== 'undefined' ? window : globalThis);
