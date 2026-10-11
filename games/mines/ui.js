// ===== Интерфейс игры «Мины» =====
// Все надписи берутся из словаря (games/mines/ru.js) по ключам games.mines.*. Правила и награды: logic.js.
var CATALOG_URL = '../../index.html';
var MINES_KEY = 'game:mines:count';
var M = window.Mines, W = window.PlatformWallet;
var tr = function (key, params) { return window.I18n.t('games.mines.' + key, params); };
var appEl = document.getElementById('app');

var app = { screen: 'start', count: loadCount(), rules: false, confirm: false, round: null, rw: null, last: -1, fresh: false };

function loadCount() { return M.clampMines(window.PlatformStorage.get(MINES_KEY, 3)); }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function unit(n) { return window.I18n.plural(n, 'wallet.unit'); }

// ===== Значки =====
var GRID_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/>' +
  '<rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg>';
function themeButtonHtml() {
  var dark = window.PlatformTheme.isDark();
  var icon = dark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 13.2A8.5 8.5 0 1 1 10.8 3a6.7 6.7 0 0 0 10.2 10.2z"/></svg>';
  return '<button class="theme-btn" data-act="theme" aria-label="' + esc(window.I18n.t(dark ? 'theme.toLight' : 'theme.toDark')) + '">' + icon + '</button>';
}
var MINE_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="17" r="8" class="mi-body"/><path d="M16 5v5M16 24v5M4 17h5M23 17h5M7.5 8.5l3.5 3.5M21 22l3.5 3.5M24.5 8.5L21 12M11 22l-3.5 3.5" class="mi-spike"/><circle cx="13" cy="14" r="2" class="mi-shine"/></svg>';
var GEM_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 4h16l5 8-13 16L3 12z" class="gm-body"/><path d="M3 12h26M11 4l-3 8 8 16 8-16-3-8" class="gm-edge"/></svg>';

// Плашка с балансом; после раунда рядом всплывает изменение (+награда или −штраф)
function balanceHtml() {
  var b = W.getBalance(), rw = app.fresh && app.rw ? app.rw : null, cls = rw ? (rw.granted > 0 ? ' up' : (rw.lost > 0 ? ' down' : '')) : '';
  var delta = rw ? (rw.granted > 0 ? '+' + fmt(rw.granted) : (rw.lost > 0 ? '−' + fmt(rw.lost) : '')) : '';
  return '<div class="bal' + cls + '" role="status" aria-label="' + esc(tr('balance', { n: fmt(b), unit: unit(b) })) + '"><span class="coin" aria-hidden="true"></span><b>' + fmt(b) + '</b>' +
    (delta ? '<i class="delta" aria-hidden="true">' + delta + '</i>' : '') + '</div>';
}

// ===== Старт =====
var LOGO = '<svg viewBox="0 0 120 80" width="96" height="64" aria-hidden="true"><rect x="2" y="2" width="116" height="76" rx="14" class="logo-bg"/><g transform="translate(14 14)"><path d="M10 0h20l8 12-18 22L2 12z" class="gm-body"/></g><g transform="translate(66 22) scale(1.3)"><circle cx="16" cy="17" r="8" class="mi-body"/><path d="M16 5v5M16 24v5M4 17h5M23 17h5" class="mi-spike"/></g></svg>';
function startHtml() {
  var chips = [1, 3, 5, 10, 15, 24].map(function (n) {
    return '<button class="chipbtn" data-act="count" data-n="' + n + '" aria-pressed="' + (app.count === n) + '">' + n + '</button>';
  }).join('');
  return '<div class="start"><div class="brand-row"><div class="brand"><div class="logo-mines">' + LOGO + '</div><h1>' + esc(window.I18n.t('games.mines.title')) + '</h1></div>' +
    '<div class="top-actions"><a class="theme-btn" href="' + CATALOG_URL + '" aria-label="' + esc(tr('toCatalog')) + '" title="' + esc(tr('toCatalog')) + '">' + GRID_SVG + '</a>' + themeButtonHtml() + '</div></div>' +
    '<div class="muted-text">' + esc(tr('sub')) + '</div>' +
    '<div class="balrow">' + balanceHtml() + '</div>' +
    '<div class="field"><div class="field-title">' + esc(tr('start.count')) + '</div>' +
      '<div class="stepper"><button class="stepbtn" data-act="minus" aria-label="' + esc(tr('start.minus')) + '"' + (app.count <= M.CONFIG.minMines ? ' disabled' : '') + '>−</button>' +
      '<div class="stepval"><b>' + app.count + '</b><small>' + esc(tr(app.count <= M.CONFIG.flatMax ? 'start.perCell' : 'start.perCellGrow', { n: M.cellReward(app.count), step: M.CONFIG.cellStep })) + '</small></div>' +
      '<button class="stepbtn" data-act="plus" aria-label="' + esc(tr('start.plus')) + '"' + (app.count >= M.CONFIG.maxMines ? ' disabled' : '') + '>+</button></div>' +
      '<div class="chips">' + chips + '</div></div>' +
    (canPlay() ? '' : '<div class="muted-text" role="status">' + esc(tr('start.need', { n: M.lossFor(app.count) })) + '</div>') +
    '<div class="start-actions"><button class="btn-play" data-act="play"' + (canPlay() ? '' : ' disabled') + '>' + esc(tr('start.play')) + '</button><button class="btn-secondary wide" data-act="rules">' + esc(tr('rules.button')) + '</button></div></div>';
}

// ===== Раунд =====
function startRound() {
  window.PlatformStorage.set(MINES_KEY, app.count);
  app.round = M.init(app.count); app.rw = null; app.last = -1; app.fresh = false; app.confirm = false; app.screen = 'game';
  render();
}
// Раунд закончен: награда без дневного предела; мина списывает штраф (700 при 1–10 минах, 200 при 11–24; сколько есть, если меньше)
function finish(v) {
  if (v.payout > 0) { W.add(v.payout, 'mines', Date.now()); W.countWin('mines'); app.rw = { granted: v.payout, lost: 0 }; }
  else { var take = Math.min(M.lossFor(v.mines), W.getBalance()); if (take > 0) W.spend(take, 'mines', Date.now()); app.rw = { granted: 0, lost: take }; }
}
function canPlay(mines) { return W.getBalance() >= M.lossFor(mines === undefined ? app.count : mines); }
function act(action) {
  var r = M.reduce(app.round, action);
  if (!r.ok) return;
  if (action.type === 'open') { app.last = action.index; if (app.round.openedCount === 0) { W.markPlayed(); W.countPlay('mines'); } }
  app.round = r.state; app.fresh = true;
  if (r.state.status !== 'playing') finish(M.view(r.state));
  render();
}

// Анимируется только то, что изменилось этим ходом: последняя клетка, а при конце раунда — остальные мины по очереди
function cellHtml(v, i, order) {
  var open = v.opened[i], over = v.status !== 'playing', mine = v.layout && v.layout[i], cls = 'cell', inner = '', style = '', label = tr('cell.aria', { n: i + 1 });
  var fresh = app.fresh && i === app.last;
  if (open && !mine) { cls += ' safe' + (fresh ? ' pop gleam' : ''); inner = GEM_SVG; label += ', ' + tr('cell.safe'); }
  else if (open && mine) { cls += ' boom' + (app.fresh ? ' blast' : ''); inner = MINE_SVG; label += ', ' + tr('cell.mine'); }
  else if (over && mine) { cls += ' mine' + (app.fresh ? ' reveal' : ''); inner = MINE_SVG; label += ', ' + tr('cell.mine'); if (app.fresh) style = ' style="animation-delay:' + (350 + order * 90) + 'ms"'; }
  else if (over) cls += ' dim';
  return '<button class="' + cls + '" data-cell="' + i + '"' + style + ' aria-label="' + esc(label) + '"' + (open || over ? ' disabled' : '') + '>' + inner + '</button>';
}
function gameHtml() {
  var v = M.view(app.round), over = v.status !== 'playing', cells = '';
  var order = 0, shake = app.fresh && v.status === 'lost';
  for (var i = 0; i < M.CONFIG.cells; i++) cells += cellHtml(v, i, v.layout && v.layout[i] && !v.opened[i] ? order++ : 0);
  var result = '';
  if (over) {
    var rw = app.rw || { granted: 0, lost: 0 }, text = v.status === 'lost' ? tr('result.lost', { n: fmt(rw.lost) }) : tr(v.status === 'cleared' ? 'result.cleared' : 'result.cashed', { n: fmt(rw.granted) });
    result = '<div class="result rise ' + (v.status === 'lost' ? 'lose' : 'win') + '" role="status"><b>' + esc(text) + '</b></div>';
  }
  var take = over
    ? '<div class="row"><button class="btn primary" data-act="again"' + (canPlay(app.round.mines) ? '' : ' disabled') + '>' + esc(tr('again')) + '</button><button class="btn" data-act="menu">' + esc(tr('menu')) + '</button></div>'
    : '<button class="btn primary full take" data-act="take"' + (v.openedCount ? '' : ' disabled') + '>' + esc(v.openedCount ? tr('take', { n: fmt(v.earned) }) : tr('take.none')) + '</button>';
  return '<div class="page"><div class="o-head"><button class="theme-btn" data-act="exit" aria-label="' + esc(tr('exit.aria')) + '">←</button><h2>' + esc(window.I18n.t('games.mines.title')) + '</h2>' + balanceHtml() +
    '<button class="theme-btn" data-act="rules" aria-label="' + esc(tr('rules.button')) + '">?</button>' + themeButtonHtml() + '</div>' +
    '<div class="stats"><div class="stat"><small>' + esc(tr('mines')) + '</small><b>' + v.mines + '</b></div>' +
    '<div class="stat"><small>' + esc(tr('earned')) + '</small><b' + (app.fresh && v.earned ? ' class="bump"' : '') + '>' + fmt(v.earned) + '</b></div>' +
    '<div class="stat"><small>' + esc(tr('next')) + '</small><b>' + esc(tr('plus', { n: v.next })) + '</b></div></div>' +
    '<div class="board' + (shake ? ' shake' : '') + '" role="group">' + cells + '</div>' + result + take + '</div>';
}

function modalHtml() {
  var out = '';
  if (app.confirm) out += '<div class="scrim"><div class="modal" role="alertdialog" aria-modal="true"><h2>' + esc(tr('confirm.title')) + '</h2><p>' + esc(tr('confirm.text')) + '</p><div class="row"><button class="btn primary" data-act="stay">' + esc(tr('confirm.stay')) + '</button><button class="btn" data-act="menu">' + esc(tr('confirm.ok')) + '</button></div></div></div>';
  if (app.rules) out += '<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(tr('rules.title')) + '"><h2>' + esc(tr('rules.title')) + '</h2><ol>' +
    [1, 2, 3, 4, 5].map(function (k) { return '<li>' + esc(tr('rules.step' + k)) + '</li>'; }).join('') + '</ol><button class="btn primary full" data-act="closeRules">' + esc(tr('rules.close')) + '</button></div></div>';
  return out;
}
function render() {
  appEl.innerHTML = '<div class="screen">' + (app.screen === 'game' && app.round ? gameHtml() : startHtml()) + '</div>' + modalHtml();
  app.fresh = false;
}

appEl.addEventListener('click', function (e) {
  var cell = e.target.closest('[data-cell]');
  if (cell && app.round && app.round.status === 'playing') { act({ type: 'open', index: Number(cell.getAttribute('data-cell')) }); return; }
  var el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  switch (el.getAttribute('data-act')) {
    case 'theme': window.PlatformTheme.toggle(); break;
    case 'minus': app.count = M.clampMines(app.count - 1); render(); break;
    case 'plus': app.count = M.clampMines(app.count + 1); render(); break;
    case 'count': app.count = M.clampMines(Number(el.getAttribute('data-n'))); render(); break;
    case 'play': if (canPlay(app.count)) startRound(); break;
    case 'again': if (canPlay(app.round ? app.round.mines : app.count)) { app.count = app.round ? app.round.mines : app.count; startRound(); } break;
    case 'take': act({ type: 'cashout' }); break;
    case 'rules': app.rules = true; render(); break;
    case 'closeRules': app.rules = false; render(); break;
    case 'exit': if (app.round && app.round.status === 'playing' && app.round.openedCount > 0) { app.confirm = true; render(); } else { app.screen = 'start'; render(); } break;
    case 'stay': app.confirm = false; render(); break;
    case 'menu': app.confirm = false; app.screen = 'start'; app.round = null; render(); break;
  }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { if (app.rules) app.rules = false; else if (app.confirm) app.confirm = false; else return; render(); }
});
window.PlatformTheme.onChange(function () { render(); });
render();
