// ===== «Мины» прямо в главном меню: виджет внутри постера каталога, без перехода на отдельную страницу =====
// Все надписи берутся из словаря (games/mines/ru.js) по ключам games.mines.*. Правила и награды: logic.js.
//   MinesWidget.mount(container) — рисует игру в container и сама обновляется; повторный вызов для того же элемента ничего не меняет
(function (root) {
  var M = root.Mines, W = root.PlatformWallet, I = root.I18n;
  var MINES_KEY = 'game:mines:count';
  var tr = function (key, params) { return I.t('games.mines.' + key, params); };

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  var MINE_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="17" r="8" class="mw-mi-body"/><path d="M16 5v5M16 24v5M4 17h5M23 17h5M7.5 8.5l3.5 3.5M21 22l3.5 3.5M24.5 8.5L21 12M11 22l-3.5 3.5" class="mw-mi-spike"/><circle cx="13" cy="14" r="2" class="mw-mi-shine"/></svg>';
  var GEM_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 4h16l5 8-13 16L3 12z" class="mw-gm-body"/><path d="M3 12h26M11 4l-3 8 8 16 8-16-3-8" class="mw-gm-edge"/></svg>';

  function mount(el) {
    if (el.getAttribute('data-mw')) return;
    el.setAttribute('data-mw', '1');
    el.classList.add('mw');
    var st = { count: M.clampMines(root.PlatformStorage.get(MINES_KEY, 3)), round: null, rw: null, anim: {}, rules: false };

    function canPlay(n) { return W.getBalance() >= M.lossFor(n === undefined ? st.count : n); }

    function startHtml() {
      var chips = [1, 3, 5, 10, 15, 24].map(function (n) { return '<button class="mw-chip" data-mw="count" data-n="' + n + '" aria-pressed="' + (st.count === n) + '">' + n + '</button>'; }).join('');
      var hint = tr(st.count <= M.CONFIG.flatMax ? 'start.perCell' : 'start.perCellGrow', { n: M.cellReward(st.count), step: M.CONFIG.cellStep });
      return '<div class="mw-title">' + esc(tr('start.count')) + '</div>' +
        '<div class="mw-stepper"><button class="mw-step" data-mw="minus" aria-label="' + esc(tr('start.minus')) + '"' + (st.count <= M.CONFIG.minMines ? ' disabled' : '') + '>−</button>' +
        '<div class="mw-stepval"><b>' + st.count + '</b><small>' + esc(hint) + '</small></div>' +
        '<button class="mw-step" data-mw="plus" aria-label="' + esc(tr('start.plus')) + '"' + (st.count >= M.CONFIG.maxMines ? ' disabled' : '') + '>+</button></div>' +
        '<div class="mw-chips">' + chips + '</div>' +
        (canPlay() ? '' : '<p class="mw-note" role="status">' + esc(tr('start.need', { n: M.lossFor(st.count) })) + '</p>') +
        '<div class="mw-row"><button class="mw-btn primary" data-mw="play"' + (canPlay() ? '' : ' disabled') + '>' + esc(tr('start.play')) + '</button>' +
        '<button class="mw-btn" data-mw="rules">' + esc(tr('rules.button')) + '</button></div>';
    }
    function cellHtml(v, i) {
      var open = v.opened[i], over = v.status !== 'playing', mine = v.layout && v.layout[i], cls = 'mw-cell', inner = '', label = tr('cell.aria', { n: i + 1 });
      if (open && !mine) { cls += ' safe' + (st.anim[i] ? ' pop' : ''); inner = GEM_SVG; label += ', ' + tr('cell.safe'); }
      else if (open && mine) { cls += ' boom pop'; inner = MINE_SVG; label += ', ' + tr('cell.mine'); }
      else if (over && mine) { cls += ' mine'; inner = MINE_SVG; label += ', ' + tr('cell.mine'); }
      else if (over) cls += ' dim';
      return '<button class="' + cls + '" data-cell="' + i + '" aria-label="' + esc(label) + '"' + (open || over ? ' disabled' : '') + '>' + inner + '</button>';
    }
    function gameHtml() {
      var v = M.view(st.round), over = v.status !== 'playing', cells = '';
      for (var i = 0; i < M.CONFIG.cells; i++) cells += cellHtml(v, i);
      var result = '';
      if (over) {
        var rw = st.rw || { granted: 0, lost: 0 }, text = v.status === 'lost' ? tr('result.lost', { n: fmt(rw.lost) }) : tr(v.status === 'cleared' ? 'result.cleared' : 'result.cashed', { n: fmt(rw.granted) });
        result = '<div class="mw-result ' + (v.status === 'lost' ? 'lose' : 'win') + '" role="status"><b>' + esc(text) + '</b></div>';
      }
      var foot = over
        ? '<div class="mw-row"><button class="mw-btn primary" data-mw="again"' + (canPlay(st.round.mines) ? '' : ' disabled') + '>' + esc(tr('again')) + '</button><button class="mw-btn" data-mw="menu">' + esc(tr('menu')) + '</button></div>'
        : '<button class="mw-btn primary take" data-mw="take"' + (v.openedCount ? '' : ' disabled') + '>' + esc(v.openedCount ? tr('take', { n: fmt(v.earned) }) : tr('take.none')) + '</button>';
      return '<div class="mw-stats"><div class="mw-stat"><small>' + esc(tr('mines')) + '</small><b>' + v.mines + '</b></div>' +
        '<div class="mw-stat"><small>' + esc(tr('earned')) + '</small><b>' + fmt(v.earned) + '</b></div>' +
        '<div class="mw-stat"><small>' + esc(tr('next')) + '</small><b>' + esc(tr('plus', { n: v.next })) + '</b></div></div>' +
        '<div class="mw-board" role="group">' + cells + '</div>' + result + foot;
    }
    function rulesHtml() {
      return '<div class="mw-rules"><ol>' + [1, 2, 3, 4, 5].map(function (k) { return '<li>' + esc(tr('rules.step' + k)) + '</li>'; }).join('') + '</ol>' +
        '<button class="mw-btn" data-mw="closeRules">' + esc(tr('rules.close')) + '</button></div>';
    }
    function render() { el.innerHTML = st.rules ? rulesHtml() : (st.round ? gameHtml() : startHtml()); }

    function startRound() {
      root.PlatformStorage.set(MINES_KEY, st.count);
      st.round = M.init(st.count); st.rw = null; st.anim = {}; render();
    }
    // Раунд закончен: награда без дневного предела; мина списывает штраф (700 при 1–10 минах, 200 при 11–24; сколько есть, если меньше)
    function finish(v) {
      if (v.payout > 0) { W.add(v.payout, 'mines', Date.now()); W.countWin('mines'); st.rw = { granted: v.payout, lost: 0 }; }
      else { var take = Math.min(M.lossFor(v.mines), W.getBalance()); if (take > 0) W.spend(take, 'mines', Date.now()); st.rw = { granted: 0, lost: take }; }
    }
    function act(action) {
      var r = M.reduce(st.round, action);
      if (!r.ok) return;
      if (action.type === 'open') { st.anim[action.index] = true; if (st.round.openedCount === 0) { W.markPlayed(); W.countPlay('mines'); } }
      st.round = r.state;
      if (r.state.status !== 'playing') finish(M.view(r.state));
      render();
    }

    el.addEventListener('click', function (e) {
      var cell = e.target.closest('[data-cell]');
      if (cell && st.round && st.round.status === 'playing') { act({ type: 'open', index: Number(cell.getAttribute('data-cell')) }); return; }
      var b = e.target.closest('[data-mw]');
      if (!b || b === el || b.disabled) return;
      switch (b.getAttribute('data-mw')) {
        case 'minus': st.count = M.clampMines(st.count - 1); render(); break;
        case 'plus': st.count = M.clampMines(st.count + 1); render(); break;
        case 'count': st.count = M.clampMines(Number(b.getAttribute('data-n'))); render(); break;
        case 'play': if (canPlay(st.count)) startRound(); break;
        case 'again': if (st.round && canPlay(st.round.mines)) { st.count = st.round.mines; startRound(); } break;
        case 'take': act({ type: 'cashout' }); break;
        case 'menu': st.round = null; render(); break;
        case 'rules': st.rules = true; render(); break;
        case 'closeRules': st.rules = false; render(); break;
      }
    });
    W.onChange(function () { if (!st.round || st.round.status !== 'playing') render(); });   // баланс мог измениться: обновить доступность «Играть»
    render();
  }

  root.MinesWidget = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
