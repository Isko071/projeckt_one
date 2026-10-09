// Кошелёк в каталоге: баланс, серия и бонус дня над списком игр, окно «Кошелёк» с балансом.
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
  // В окне кошелька только баланс; серия и бонус дня стоят в полосе над списком, рекорды и операции — в «Статистике» в меню профиля
  function renderDialog() {
    var balance = W.getBalance();
    $('wd-balance').textContent = fmt(balance);
    $('wd-unit').textContent = unit(balance);
  }

  function openDialog() {
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
  claimBtn.addEventListener('click', claim);
  $('wallet-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', function (e) { if (e.target === dialog) closeDialog(); });

  // Баланс мог измениться в другой вкладке или после возврата из игры
  function refresh() { renderBar(); if (dialog.open) renderDialog(); }
  W.onChange(refresh);
  window.addEventListener('pageshow', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('storage', function (e) { if (!e.key || e.key === W.KEY) refresh(); });

  I.apply();
  renderBar();
})();
