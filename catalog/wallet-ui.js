// Кошелёк в каталоге: баланс и серия над списком игр, окно «Кошелёк» (бонус дня, лесенка серии, журнал, сброс).
(function () {
  var W = window.PlatformWallet, I = window.I18n, t = I.t;
  var $ = function (id) { return document.getElementById(id); };

  var balanceEl = $('wallet-balance'), unitEl = $('wallet-unit'), streakEl = $('streak-count');
  var openBtn = $('wallet-open'), streakChip = $('streak-chip'), claimBtn = $('claim-btn');
  var dialog = $('wallet-dialog');
  var shownBalance = null;

  function unit(n) { return I.plural(n, 'wallet.unit'); }
  function days(n) { return I.plural(n, 'wallet.days'); }
  function fmt(n) { return Number(n).toLocaleString('ru-RU'); }
  function reduced() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  function pulse(el) {
    if (reduced()) return;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  // ---------- Полоса над списком ----------
  function renderBar() {
    var balance = W.getBalance(), st = W.dailyStatus();
    balanceEl.textContent = fmt(balance);
    unitEl.textContent = unit(balance);
    streakEl.textContent = st.streak;
    streakChip.classList.toggle('cold', st.streak === 0);
    streakChip.classList.toggle('risk', st.atRisk);
    var label = t('wallet.open', { balance: fmt(balance), unit: unit(balance), streak: st.streak, days: days(st.streak) });
    openBtn.setAttribute('aria-label', label);
    streakChip.setAttribute('aria-label', label);
    if (st.pending) {
      claimBtn.hidden = false;
      claimBtn.textContent = t('wallet.claim', { amount: fmt(st.pending.amount + st.pending.bonus) });
    } else claimBtn.hidden = true;
    if (shownBalance !== null && shownBalance !== balance) pulse(openBtn);
    shownBalance = balance;
  }

  // ---------- Окно ----------
  function renderDialog() {
    var balance = W.getBalance(), st = W.dailyStatus();
    $('wd-balance').textContent = fmt(balance);
    $('wd-unit').textContent = unit(balance);
    $('wd-streak').textContent = st.streak ? t('wallet.streak.count', { n: st.streak, days: days(st.streak) }) : t('wallet.streak.none');
    $('wd-best').textContent = st.best ? t('wallet.streak.best', { n: st.best, days: days(st.best) }) : '';
    $('wd-best').hidden = !st.best;
    document.querySelector('.streak-card').classList.toggle('cold', st.streak === 0);

    // Лесенка: бонус по дням серии (1–7), пройденные закрашены
    var ladder = $('wd-ladder');
    ladder.textContent = '';
    for (var d = 1; d <= 7; d++) {
      var amount = Math.min(W.CONFIG.dailyMax, W.CONFIG.dailyBase + W.CONFIG.dailyStep * (d - 1));
      var li = document.createElement('li');
      var done = st.streak >= d && (st.playedToday || st.streak >= d);
      li.className = 'step' + (done ? ' done' : '') + (st.streak === d || (st.streak > 7 && d === 7) ? ' now' : '');
      li.setAttribute('aria-label', t('wallet.ladder.day', { n: d, amount: fmt(amount) }));
      li.innerHTML = '<span class="step-day"></span><span class="step-amount"></span>';
      li.firstChild.textContent = d;
      li.lastChild.textContent = fmt(amount);
      ladder.appendChild(li);
    }

    var hint;
    if (st.pending) hint = t('wallet.streak.hint.claim');
    else if (st.playedToday) hint = t('wallet.streak.hint.done', { amount: fmt(st.nextAmount), unit: unit(st.nextAmount) });
    else if (st.atRisk) hint = t('wallet.streak.hint.risk');
    else if (st.streak === 0) hint = t('wallet.streak.hint.start');
    else hint = t('wallet.streak.hint.play', { n: st.streak + 1, days: days(st.streak + 1) });
    $('wd-hint').textContent = hint;

    var ms = $('wd-milestone');
    if (st.nextMilestone) {
      ms.hidden = false;
      var left = st.nextMilestone - st.streak;
      ms.textContent = t('wallet.milestone', {
        left: left, days: days(left), bonus: fmt(st.milestoneBonus), unit: unit(st.milestoneBonus), n: st.nextMilestone, ndays: days(st.nextMilestone)
      });
    } else ms.hidden = true;

    var claim = $('wd-claim');
    if (st.pending) {
      claim.hidden = false;
      claim.textContent = t('wallet.claim', { amount: fmt(st.pending.amount + st.pending.bonus) });
    } else claim.hidden = true;

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

  function showResetAsk(on) {
    $('wd-reset-ask').hidden = !on;
    $('wd-reset').hidden = on;
    $('wd-reset-text').textContent = t('wallet.reset.ask', { start: fmt(W.CONFIG.start), unit: unit(W.CONFIG.start) });
    (on ? $('wd-reset-cancel') : $('wd-reset')).focus();
  }

  function openDialog() {
    $('wd-reset-ask').hidden = true;
    $('wd-reset').hidden = false;
    renderDialog();
    dialog.showModal();
  }
  function closeDialog() { if (dialog.open) dialog.close(); }

  function claim() {
    var r = W.claimDaily();
    if (!r.claimed) return;
    renderBar();
    if (dialog.open) renderDialog();
    pulse(openBtn);
  }

  openBtn.addEventListener('click', openDialog);
  streakChip.addEventListener('click', openDialog);
  claimBtn.addEventListener('click', claim);
  $('wd-claim').addEventListener('click', claim);
  $('wallet-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', function (e) { if (e.target === dialog) closeDialog(); });
  $('wd-reset').addEventListener('click', function () { showResetAsk(true); });
  $('wd-reset-cancel').addEventListener('click', function () { showResetAsk(false); });
  $('wd-reset-ok').addEventListener('click', function () { W.reset(); showResetAsk(false); renderBar(); renderDialog(); });

  // Баланс мог измениться в другой вкладке или после возврата из игры
  function refresh() { renderBar(); if (dialog.open) renderDialog(); }
  W.onChange(refresh);
  window.addEventListener('pageshow', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('storage', function (e) { if (!e.key || e.key === W.KEY) refresh(); });

  I.apply();
  renderBar();
})();
