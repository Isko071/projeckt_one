// Аккаунт в меню аватара: «Войти через Google» / «Выйти», состояние облака, выбор прогресса при конфликте.
(function () {
  var C = window.PlatformCloud, I = window.I18n, t = I.t, P = window.PlatformProfile;
  var $ = function (id) { return document.getElementById(id); };
  var dialog = $('account-dialog'), body = $('account-body'), menu = $('profile-menu'), avatarBtn = $('avatar-btn');
  var actionBtn = $('cloud-action'), statusEl = $('cloud-status');
  var conflictShown = false;

  function unit(n) { return I.plural(n, 'wallet.unit'); }
  function days(n) { return I.plural(n, 'wallet.days'); }
  function fmt(n) { return Number(n).toLocaleString('ru-RU'); }
  function closeMenu() { menu.hidden = true; avatarBtn.setAttribute('aria-expanded', 'false'); }

  // ---------- Окно ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function button(cls, text, onClick, autofocus) {
    var b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    if (autofocus) b.setAttribute('data-autofocus', '');
    return b;
  }
  function openDialog(title, build, dismissable) {
    $('account-title').textContent = title;
    body.textContent = '';
    build(body);
    dialog.dataset.dismissable = dismissable === false ? 'no' : 'yes';
    $('account-close').hidden = dismissable === false;
    if (!dialog.open) dialog.showModal();
    var auto = body.querySelector('[data-autofocus]');
    if (auto) auto.focus();
  }
  function closeDialog() { if (dialog.open) dialog.close(); }

  function showError(key) {
    openDialog(t('account.error.title'), function (b) {
      b.appendChild(el('p', 'dialog-note', t(key)));
      var row = el('div', 'dialog-actions');
      row.appendChild(button('btn-primary', t('account.close'), closeDialog, true));
      b.appendChild(row);
    });
  }

  function signInError(e) {
    var code = e && e.code;
    if (code === 'auth/unauthorized-domain') return 'account.error.domain';
    if (code === 'auth/popup-blocked') return 'account.error.popup';
    if (code === 'unsupported') return 'account.error.unsupported';
    if (code === 'auth/operation-not-allowed') return 'account.error.disabled';
    if (code === 'auth/network-request-failed') return 'account.error.network';
    return 'account.error.other';
  }

  function doSignIn() {
    closeMenu();
    C.signIn().then(function (r) { if (r && r.cancelled) return; }, function (e) { showError(signInError(e)); });
  }

  function confirmSignOut() {
    closeMenu();
    openDialog(t('account.signout.title'), function (b) {
      b.appendChild(el('p', 'dialog-note', t('account.signout.text')));
      var row = el('div', 'dialog-actions');
      row.appendChild(button('btn-secondary', t('account.cancel'), closeDialog, true));
      row.appendChild(button('btn-primary', t('account.signout.ok'), function () { runSignOut(false); }));
      b.appendChild(row);
    });
  }

  function runSignOut(force) {
    C.signOut(force).then(function (r) {
      if (r.ok) { window.location.reload(); return; }
      openDialog(t('account.unsaved.title'), function (b) {
        b.appendChild(el('p', 'dialog-note', t('account.unsaved.text')));
        var row = el('div', 'dialog-actions');
        row.appendChild(button('btn-secondary', t('account.unsaved.stay'), closeDialog, true));
        row.appendChild(button('btn-primary', t('account.unsaved.force'), function () { runSignOut(true); }));
        b.appendChild(row);
      });
    });
  }

  function showConflict() {
    var c = C.getState().conflict;
    if (!c) return;
    conflictShown = true;
    var when = '';
    try { when = c.cloud.updatedAt ? t('account.conflict.updated', { date: new Date(c.cloud.updatedAt).toLocaleDateString(I.locale(), { day: 'numeric', month: 'short' }) }) : ''; } catch (e) { when = ''; }
    openDialog(t('account.conflict.title'), function (b) {
      b.appendChild(el('p', 'dialog-note', t('account.conflict.text')));
      var list = el('div', 'conflict-list');
      list.appendChild(el('div', 'conflict-row', t('account.conflict.cloud', { balance: fmt(c.cloud.balance === null ? 0 : c.cloud.balance), unit: unit(c.cloud.balance || 0), streak: c.cloud.streak, days: days(c.cloud.streak), date: when })));
      list.appendChild(el('div', 'conflict-row', t('account.conflict.local', { balance: fmt(c.local.balance === null ? 0 : c.local.balance), unit: unit(c.local.balance || 0), streak: c.local.streak, days: days(c.local.streak) })));
      b.appendChild(list);
      b.appendChild(el('p', 'dialog-note', t('account.conflict.note')));
      b.appendChild(button('btn-primary', t('account.conflict.useCloud'), function () { C.resolveConflict('cloud').then(closeDialog); }, true));
      b.appendChild(button('btn-secondary', t('account.conflict.useLocal'), function () { C.resolveConflict('local').then(closeDialog); }));
    }, false);
  }

  // ---------- Меню ----------
  function statusText(s) {
    if (s.status === 'unsupported') return t('account.status.unsupported');
    if (s.status === 'signedOut') return t('account.guest');
    var key = { idle: 'idle', syncing: 'syncing', conflict: 'conflict', paused: 'paused' }[s.sync];
    if (s.sync === 'error') key = s.error === 'denied' ? 'denied' : (s.error === 'no-storage' ? 'nostorage' : 'error');
    return (s.user.name || s.user.email) + ': ' + t('account.status.' + (key || 'idle'));
  }

  function refresh() {
    var s = C.getState();
    if (s.status === 'signedIn') { actionBtn.textContent = t('account.google.signout'); actionBtn.hidden = false; }
    else if (s.status === 'signedOut') { actionBtn.textContent = t('account.google.signin'); actionBtn.hidden = false; }
    else actionBtn.hidden = true;
    statusEl.textContent = statusText(s);
    avatarBtn.classList.toggle('offline', s.status === 'signedIn' && s.sync === 'error');
    if (s.sync === 'conflict' && !conflictShown) showConflict();
    if (s.sync !== 'conflict') conflictShown = false;
  }

  actionBtn.addEventListener('click', function () { if (C.getState().status === 'signedIn') confirmSignOut(); else doSignIn(); });
  $('account-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', function (e) { if (e.target === dialog && dialog.dataset.dismissable !== 'no') closeDialog(); });
  dialog.addEventListener('cancel', function (e) { if (dialog.dataset.dismissable === 'no') e.preventDefault(); });
  dialog.addEventListener('close', function () { avatarBtn.focus(); });

  C.onChange(refresh);
  P.onChange(refresh);
  C.start({ allowDownload: true });
  I.apply();
  refresh();
})();
