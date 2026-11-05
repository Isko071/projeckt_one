// Окно «Статистика» в меню профиля: рекорды, партии и победы по каждой игре, последние операции с аконами.
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

    // По играм: партии, победы (и процент), лучший результат
    var stats = window.CatalogLogic.gameStats(window.GAMES || [], rec, {
      '2048': window.PlatformStorage.get('game:2048:best', 0), blocks: window.PlatformStorage.get('game:blocks:best', 0),
      minesweeper: window.PlatformStorage.get('game:minesweeper:best', null)
    });
    var gbox = $('wd-games');
    gbox.textContent = '';
    if (!stats.length) {
      var none = document.createElement('p');
      none.className = 'log-empty'; none.textContent = t('stats.games.empty');
      gbox.appendChild(none);
    } else {
      var table = document.createElement('table'), head = document.createElement('tr');
      ['game', 'plays', 'wins', 'best'].forEach(function (k) { var th = document.createElement('th'); th.textContent = t('stats.games.' + k); if (k !== 'game') th.className = 'n'; head.appendChild(th); });
      var thead = document.createElement('thead'); thead.appendChild(head); table.appendChild(thead);
      var tbody = document.createElement('tbody');
      stats.forEach(function (r) {
        var tr = document.createElement('tr');
        var best = r.best ? fmt(r.best) : (r.bestTime ? ['novice', 'amateur', 'expert'].filter(function (lv) { return r.bestTime[lv] !== undefined; })
          .map(function (lv) { var sec = r.bestTime[lv]; return t('wallet.records.level.' + lv) + ' ' + Math.floor(sec / 60) + ':' + pad2(sec % 60); }).join(', ') : '—');
        var cells = [t('games.' + r.id + '.title'), fmt(r.plays), r.wins === null ? '—' : fmt(r.wins) + (r.rate !== null ? ' · ' + r.rate + '%' : ''), best];
        cells.forEach(function (c, i) { var td = document.createElement('td'); td.textContent = c; if (i) td.className = 'n'; tr.appendChild(td); });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      gbox.appendChild(table);
    }

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
