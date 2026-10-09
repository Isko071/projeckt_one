// Окно «Статистика» в меню профиля: рекорды и последние операции с аконами.
(function () {
  var W = window.PlatformWallet, I = window.I18n, t = I.t;
  var $ = function (id) { return document.getElementById(id); };
  var dialog = $('stats-dialog'), menu = $('profile-menu'), avatarBtn = $('avatar-btn');

  function unit(n) { return I.plural(n, 'wallet.unit'); }
  function days(n) { return I.plural(n, 'wallet.days'); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(n) { return Number(n).toLocaleString('ru-RU'); }

  function render() {
    // Рекорды
    var rec = W.records(), box = $('wd-records');
    box.textContent = '';
    function row(label, value) {
      var dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value;
      box.appendChild(dt); box.appendChild(dd);
    }
    row(t('wallet.records.peak'), fmt(rec.peak) + ' ' + unit(rec.peak));
    row(t('wallet.records.streak'), rec.bestStreak + ' ' + days(rec.bestStreak));
    var wins = Object.keys(rec.wins);
    if (wins.length) row(t('wallet.records.wins'), wins.map(function (k) { return t('wallet.src.' + k) + ' ' + rec.wins[k]; }).join(', '));
    var bests = window.PlatformStorage.get('game:minesweeper:best', null) || {};
    ['novice', 'amateur', 'expert'].forEach(function (lv) {
      var sec = bests[lv];
      if (typeof sec === 'number' && isFinite(sec) && sec >= 0) {
        row(t('wallet.records.mines', { level: t('wallet.records.level.' + lv) }), pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60));
      }
    });

    // Журнал
    var list = $('wd-log'), log = W.getLog();
    list.textContent = '';
    if (!log.length) {
      var empty = document.createElement('li');
      empty.className = 'log-empty';
      empty.textContent = t('wallet.log.empty');
      list.appendChild(empty);
    }
    log.forEach(function (e) {
      var li = document.createElement('li');
      var key = 'wallet.src.' + e.source, name = t(key);
      if (name === key) name = t('wallet.src.other');
      var when = '';
      try { when = new Date(e.time).toLocaleString(I.locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (err) { when = ''; }
      li.innerHTML = '<span class="log-name"></span><span class="log-time"></span><b class="log-amount"></b>';
      li.children[0].textContent = name;
      li.children[1].textContent = when;
      li.children[2].textContent = (e.amount > 0 ? '+' : '−') + fmt(Math.abs(e.amount));
      li.children[2].className = 'log-amount ' + (e.amount > 0 ? 'plus' : 'minus');
      list.appendChild(li);
    });
  }

  function openDialog() {
    menu.hidden = true;
    avatarBtn.setAttribute('aria-expanded', 'false');
    render();
    dialog.showModal();
  }
  function closeDialog() { if (dialog.open) dialog.close(); }

  $('open-stats').addEventListener('click', openDialog);
  $('stats-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', function (e) { if (e.target === dialog) closeDialog(); });
  W.onChange(function () { if (dialog.open) render(); });
  I.apply();
})();
