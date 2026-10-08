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

  var draftAvatar = 0, draftIcon = null, draftGoogle = false;
  var emojisBox = document.getElementById('emojis');
  var photoField = document.getElementById('photo-field');
  var photoToggle = document.getElementById('photo-toggle');
  var photoPreview = document.getElementById('photo-preview');
  var emojiOptions = [];

  // Фото Google-аккаунта, если игрок вошёл
  function googlePhoto() {
    var s = window.PlatformCloud && window.PlatformCloud.getState();
    return s && s.status === 'signedIn' && s.user && s.user.photo ? s.user.photo : '';
  }

  // ---------- Аватар в шапке ----------
  function renderAvatar() {
    var p = P.getProfile();
    btn.style.background = P.avatarColor(p.avatar);
    btn.title = p.name;
    btn.textContent = '';
    var photo = p.google ? googlePhoto() : '';
    if (photo) {
      var img = document.createElement('img');
      img.className = 'avatar-img';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.src = photo;
      img.addEventListener('error', function () { btn.textContent = p.icon || P.initial(p.name); }); // фото не загрузилось — запасной вариант
      btn.appendChild(img);
    } else btn.textContent = p.icon || P.initial(p.name);
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

  function buildEmojiOptions() {
    emojisBox.textContent = '';
    emojiOptions = [];
    P.EMOJIS.forEach(function (e) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'emoji-option';
      b.textContent = e;
      b.setAttribute('aria-label', t('profile.emojiN', { e: e }));
      b.addEventListener('click', function () {
        draftIcon = draftIcon === e ? null : e; // повторный выбор снимает эмодзи
        if (draftIcon) draftGoogle = false;
        refreshOptions();
      });
      emojisBox.appendChild(b);
      emojiOptions.push(b);
    });
  }

  function refreshOptions() {
    var letter = draftIcon || P.initial(nameInput.value);
    options.forEach(function (b, index) {
      b.textContent = letter;
      b.setAttribute('aria-pressed', String(index === draftAvatar));
    });
    emojiOptions.forEach(function (b) { b.setAttribute('aria-pressed', String(b.textContent === draftIcon)); });
    var photo = googlePhoto();
    photoField.hidden = !photo;
    if (photo) {
      photoPreview.src = photo;
      photoToggle.setAttribute('aria-pressed', String(draftGoogle));
    }
  }

  function openDialog() {
    closeMenu(false);
    var p = P.getProfile();
    nameInput.value = p.name;
    draftAvatar = p.avatar;
    draftIcon = p.icon || null;
    draftGoogle = !!p.google;
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
    P.saveProfile({ name: nameInput.value, avatar: draftAvatar, icon: draftIcon, google: draftGoogle && !!googlePhoto() });
    closeDialog();
  });

  // Клик по затемнению закрывает окно без сохранения
  dialog.addEventListener('click', function (e) { if (e.target === dialog) closeDialog(); });
  // Любое закрытие окна (кнопки, Escape, затемнение, сохранение) возвращает фокус на аватар
  dialog.addEventListener('close', function () { btn.focus(); });

  photoToggle.addEventListener('click', function () {
    draftGoogle = !draftGoogle;
    refreshOptions();
  });

  buildAvatarOptions();
  buildEmojiOptions();
  P.onChange(renderAvatar);
  if (window.PlatformCloud) window.PlatformCloud.onChange(function () { renderAvatar(); if (dialog.open) refreshOptions(); });
  window.I18n.apply(); // тексты окна и меню
  renderAvatar();
})();
