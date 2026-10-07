// Профиль в шапке каталога: кнопка-аватар, меню и окно «Профиль» (имя и аватар).
(function () {
  var P = window.PlatformProfile, t = window.I18n.t;

  var btn = document.getElementById('avatar-btn');
  var menu = document.getElementById('profile-menu');
  var openItem = document.getElementById('open-profile');
  var dialog = document.getElementById('profile-dialog');
  var form = document.getElementById('profile-form');
  var nameInput = document.getElementById('profile-name');
  var avatarsBox = document.getElementById('avatars');
  var cancelBtn = document.getElementById('profile-cancel');

  var draftAvatar = 0;

  // ---------- Аватар в шапке ----------
  function renderAvatar() {
    var p = P.getProfile();
    btn.textContent = P.initial(p.name);
    btn.style.background = P.avatarColor(p.avatar);
    btn.title = p.name;
  }

  // ---------- Меню ----------
  function menuIsOpen() { return !menu.hidden; }

  function openMenu() {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    openItem.focus();
  }

  function closeMenu(returnFocus) {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (returnFocus) btn.focus();
  }

  btn.addEventListener('click', function () { if (menuIsOpen()) closeMenu(false); else openMenu(); });

  // Клик вне меню и Escape закрывают его
  document.addEventListener('click', function (e) {
    if (menuIsOpen() && !menu.contains(e.target) && !btn.contains(e.target)) closeMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menuIsOpen()) { e.preventDefault(); closeMenu(true); }
  });

  // ---------- Окно профиля ----------
  var options = [];

  // Кружки аватаров создаются один раз; при вводе обновляется только буква, при выборе — выделение
  function buildAvatarOptions() {
    avatarsBox.textContent = '';
    options = [];
    for (var i = 0; i < P.AVATAR_COUNT; i++) {
      (function (index) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'avatar-option';
        b.style.background = P.avatarColor(index);
        b.setAttribute('aria-label', t('profile.avatarN', { n: index + 1 }));
        b.addEventListener('click', function () { draftAvatar = index; refreshOptions(); });
        avatarsBox.appendChild(b);
        options.push(b);
      })(i);
    }
  }

  function refreshOptions() {
    var letter = P.initial(nameInput.value);
    options.forEach(function (b, index) {
      b.textContent = letter;
      b.setAttribute('aria-pressed', String(index === draftAvatar));
    });
  }

  function openDialog() {
    closeMenu(false);
    var p = P.getProfile();
    nameInput.value = p.name;
    draftAvatar = p.avatar;
    refreshOptions();
    dialog.showModal();
    nameInput.select();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
  }

  openItem.addEventListener('click', openDialog);
  cancelBtn.addEventListener('click', closeDialog);

  // Буква в кружках следует за вводимым именем
  nameInput.addEventListener('input', refreshOptions);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    P.saveProfile({ name: nameInput.value, avatar: draftAvatar });
    closeDialog();
  });

  // Клик по затемнению закрывает окно без сохранения
  dialog.addEventListener('click', function (e) { if (e.target === dialog) closeDialog(); });
  // Любое закрытие окна (кнопки, Escape, затемнение, сохранение) возвращает фокус на аватар
  dialog.addEventListener('close', function () { btn.focus(); });

  buildAvatarOptions();
  P.onChange(renderAvatar);
  window.I18n.apply(); // тексты окна и меню
  renderAvatar();
})();
