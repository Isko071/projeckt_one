// Защищённые профили в каталоге: «Защитить паролем / Сохранить прогресс» и «Войти в профиль» (shared/vault.js).
(function () {
  var V = window.PlatformVault, P = window.PlatformProfile, I = window.I18n, t = I.t;
  var $ = function (id) { return document.getElementById(id); };

  var dialog = $('account-dialog'), saveForm = $('save-form'), savedView = $('saved-view'), loginForm = $('login-form');
  var saveItem = $('open-save'), loginItem = $('open-login'), menu = $('profile-menu'), avatarBtn = $('avatar-btn');
  var lastFile = null, loginTab = 'local', chosen = null, fileText = '';

  function show(which) {
    saveForm.hidden = which !== 'save';
    savedView.hidden = which !== 'saved';
    loginForm.hidden = which !== 'login';
  }
  function showError(box, key, params) {
    box.hidden = !key;
    box.textContent = key ? t(key, params) : '';
  }
  function errorKey(e) {
    var code = e && (e.code || e.message);
    if (code === 'wrong-password') return 'account.error.wrong';
    if (code === 'bad-file') return 'account.error.file';
    if (code === 'weak-password') return 'account.error.weak';
    if (code === 'no-crypto' || (e && e.name === 'TypeError' && !window.crypto)) return 'account.error.nocrypto';
    return 'account.error.other';
  }
  function closeMenu() { menu.hidden = true; avatarBtn.setAttribute('aria-expanded', 'false'); }
  function closeDialog() { if (dialog.open) dialog.close(); }

  // ---------- Меню ----------
  function refreshMenu() {
    var s = V.getSession();
    saveItem.textContent = t(s ? 'account.save.menu.update' : 'account.save.menu.new');
    avatarBtn.classList.toggle('dirty', !!(s && s.dirty));
    saveItem.classList.toggle('dirty', !!(s && s.dirty));
    saveItem.title = s && s.dirty ? t('account.dirty') : '';
  }

  // ---------- Сохранение ----------
  function openSave() {
    closeMenu();
    var s = V.getSession(), name = P.getProfile().name;
    $('account-title').textContent = t(s ? 'account.save.title.update' : 'account.save.title.new');
    $('save-intro').textContent = t(s ? 'account.save.intro.update' : 'account.save.intro.new', { name: s ? s.name : name });
    $('save-pass').value = ''; $('save-pass2').value = '';
    $('save-pass2-wrap').hidden = !!s;
    showError($('save-error'), null);
    $('save-submit').disabled = false; $('save-submit').textContent = t('account.save');
    show('save');
    dialog.showModal();
    $('save-pass').focus();
  }

  saveForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('save-pass').value, existing = !!V.getSession(), err = $('save-error');
    if (!V.checkPassword(pw)) return showError(err, 'account.error.weak', { n: V.MIN_PASSWORD });
    if (!existing && pw !== $('save-pass2').value) return showError(err, 'account.error.mismatch');
    showError(err, null);
    var btn = $('save-submit');
    btn.disabled = true; btn.textContent = t('account.saving');
    V.saveCurrent(pw).then(function (r) {
      lastFile = r;
      $('saved-note').textContent = '';
      show('saved');
      refreshMenu();
      $('saved-download').focus();
    }).catch(function (e2) {
      showError(err, errorKey(e2), { n: V.MIN_PASSWORD });
    }).then(function () { btn.disabled = false; btn.textContent = t('account.save'); });
  });

  $('saved-download').addEventListener('click', function () {
    if (!lastFile) return;
    var blob = new Blob([lastFile.file], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'igroteka-' + lastFile.id + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    $('saved-note').textContent = t('account.saved.downloaded');
  });
  $('saved-copy').addEventListener('click', function () {
    if (!lastFile) return;
    var done = function (ok) { $('saved-note').textContent = t(ok ? 'account.saved.copied' : 'account.saved.nocopy'); };
    try { navigator.clipboard.writeText(lastFile.file).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
  });
  $('saved-done').addEventListener('click', closeDialog);

  // ---------- Вход ----------
  function setTab(name) {
    loginTab = name;
    $('tab-local').setAttribute('aria-selected', String(name === 'local'));
    $('tab-file').setAttribute('aria-selected', String(name === 'file'));
    $('login-local').hidden = name !== 'local';
    $('login-file').hidden = name !== 'file';
  }
  function buildList() {
    var list = $('login-list'), profiles = V.listProfiles();
    list.textContent = '';
    $('login-empty').hidden = profiles.length > 0;
    if (!profiles.some(function (p) { return p.id === chosen; })) chosen = profiles.length ? profiles[0].id : null;
    profiles.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'profile-option'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(p.id === chosen));
      var dot = document.createElement('span'); dot.className = 'avatar-dot'; dot.style.background = P.avatarColor(p.avatar); dot.textContent = P.initial(p.name);
      var name = document.createElement('span'); name.className = 'po-name'; name.textContent = p.name || t('profile.defaultName');
      var when = document.createElement('small');
      try { when.textContent = t('account.login.savedAt', { date: new Date(p.savedAt).toLocaleDateString(I.locale(), { day: 'numeric', month: 'short' }) }); } catch (e) { when.textContent = ''; }
      b.appendChild(dot); b.appendChild(name); b.appendChild(when);
      b.addEventListener('click', function () { chosen = p.id; buildList(); });
      list.appendChild(b);
    });
  }
  function openLogin() {
    closeMenu();
    $('account-title').textContent = t('account.login.title');
    $('login-pass').value = ''; $('login-code').value = ''; $('login-file-input').value = ''; fileText = '';
    showError($('login-error'), null);
    $('login-submit').disabled = false; $('login-submit').textContent = t('account.login.submit');
    buildList();
    setTab(V.listProfiles().length ? 'local' : 'file');
    show('login');
    dialog.showModal();
    $('login-pass').focus();
  }

  $('tab-local').addEventListener('click', function () { setTab('local'); });
  $('tab-file').addEventListener('click', function () { setTab('file'); });
  $('login-file-input').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    fileText = '';
    if (!f) return;
    if (f.size > 200000) return showError($('login-error'), 'account.error.file');
    var reader = new FileReader();
    reader.onload = function () { fileText = String(reader.result); showError($('login-error'), null); };
    reader.onerror = function () { showError($('login-error'), 'account.error.file'); };
    reader.readAsText(f);
  });

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('login-pass').value, err = $('login-error'), btn = $('login-submit'), job;
    if (loginTab === 'local') {
      if (!chosen) return showError(err, 'account.error.empty');
      job = function () { return V.login(chosen, pw); };
    } else {
      var text = fileText || $('login-code').value;
      if (!text.trim()) return showError(err, 'account.error.file');
      job = function () { return V.importFile(text, pw); };
    }
    showError(err, null);
    btn.disabled = true; btn.textContent = t('account.login.entering');
    job().then(function () {
      window.location.reload(); // каталог и кошелёк перечитают новые данные
    }).catch(function (e2) {
      showError(err, errorKey(e2));
      btn.disabled = false; btn.textContent = t('account.login.submit');
    });
  });

  saveItem.addEventListener('click', openSave);
  loginItem.addEventListener('click', openLogin);
  $('account-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', function (e) { if (e.target === dialog) closeDialog(); });
  dialog.addEventListener('close', function () { refreshMenu(); avatarBtn.focus(); });

  window.PlatformWallet.onChange(refreshMenu);
  P.onChange(refreshMenu);
  window.addEventListener('pageshow', refreshMenu);
  window.addEventListener('focus', refreshMenu);
  I.apply();
  refreshMenu();
})();
