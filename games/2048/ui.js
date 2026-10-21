// ===== Интерфейс игры 2048 =====
// Все надписи берутся из словаря (games/2048/ru.js) по ключам games.2048.*.
// Плитки — отдельные элементы поверх сетки: при ходе каждая едет в новую клетку (CSS transition), потом появляются слитые и новая.
// Партия и рекорд хранятся через PlatformStorage (game:2048:*), поэтому после перезагрузки партия продолжается.
var CATALOG_URL = '../../index.html';
var SAVE_KEY = 'game:2048:save', BEST_KEY = 'game:2048:best';
var G = window.G2048, W = window.PlatformWallet;
var tr = function (key, params) { return window.I18n.t('games.2048.' + key, params); };
var SLIDE_MS = 110;

var appEl = document.getElementById('app');
var app = { screen: 'start', modal: null, game: null, best: num(window.PlatformStorage.get(BEST_KEY, 0)), toast: null, wonShown: false };
var anim = { timer: null, finish: null };
var tileEls = {};                  // номер плитки → элемент

function num(v) { v = Number(v); return isFinite(v) && v >= 0 ? Math.floor(v) : 0; }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmtNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

// ===== Значки =====
var GRID_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/>' +
  '<rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg>';
function catalogLinkHtml() { return '<a class="theme-btn" href="' + CATALOG_URL + '" data-leave aria-label="' + esc(tr('toCatalog')) + '" title="' + esc(tr('toCatalog')) + '">' + GRID_SVG + '</a>'; }
function themeButtonHtml() {
  var dark = window.PlatformTheme.isDark();
  var icon = dark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 13.2A8.5 8.5 0 1 1 10.8 3a6.7 6.7 0 0 0 10.2 10.2z"/></svg>';
  return '<button class="theme-btn" data-act="theme" aria-label="' + esc(window.I18n.t(dark ? 'theme.toLight' : 'theme.toDark')) + '">' + icon + '</button>';
}
function balanceChipHtml() {
  var now = W.getBalance(), seen = W.shownBalance();
  return '<div class="bal" aria-label="' + esc(tr('balance', { n: fmtNum(now), unit: window.I18n.plural(now, 'wallet.unit') })) + '"><span class="coin" aria-hidden="true"></span><b data-bal>' + fmtNum(seen) + '</b></div>';
}

// ===== Партия =====
function loadSaved() { try { return G.sanitize(window.PlatformStorage.get(SAVE_KEY, null)); } catch (e) { return null; } }
function save() {
  if (app.game && !app.game.over) window.PlatformStorage.set(SAVE_KEY, G.plain(app.game));
  else window.PlatformStorage.remove(SAVE_KEY);
}
function newGame() {
  stopAnim();
  app.game = G.create(); app.wonShown = false; app.modal = null; app.toast = null;
  save();
}
function noteBest() {
  if (app.game.score > app.best) { app.best = app.game.score; window.PlatformStorage.set(BEST_KEY, app.best); }
}
// Награда за плитки 512, 1024, 2048 — один раз за партию каждая; уровень нужен серверу, чтобы выдать её по своей таблице
function rewardMilestones() {
  var got = G.newMilestones(app.game), total = 0;
  if (!got.length) return;
  got.forEach(function (m) {
    var level = 't' + m;
    total += W.earn('2048', W.CONFIG.rewards['2048'][level], undefined, false, level).granted;
  });
  var top = got[got.length - 1];
  app.toast = total > 0 ? { text: tr('reward', { tile: top, n: fmtNum(total), unit: window.I18n.plural(total, 'wallet.unit') }) } : { text: tr('reward.limit', { tile: top }), dim: true };
  if (top === 2048 && !app.wonShown) { app.wonShown = true; app.modal = 'won'; }
  var t = app.toast;
  setTimeout(function () { if (app.toast === t) { app.toast = null; renderHud(); } }, 3500);
}
function doMove(dir) {
  if (app.screen !== 'game' || app.modal || !app.game) return;
  if (anim.finish) anim.finish();                         // прошлый ход ещё доигрывает анимацию: завершаем сразу
  var before = app.game, r = G.move(before, dir);
  if (!r.ok) { nudge(dir); return; }
  if (before.moves === 0) { W.markPlayed(); W.countPlay('2048'); }       // партия началась с первого хода
  app.game = r.state;
  noteBest();
  rewardMilestones();
  save();
  if (r.state.over) setTimeout(function () { if (app.game === r.state && !app.modal) { app.modal = 'over'; render(); } }, reduced() ? 0 : SLIDE_MS + 450);
  if (reduced()) { syncTiles(app.game.tiles, false); renderHud(); if (app.modal) render(); return; }
  // 1) плитки прошлого поля едут в новые клетки; 2) на их месте слитые и новая плитка
  r.slides.forEach(function (s) { var el = tileEls[s.id]; if (el) place(el, s.to); });
  var state = app.game;
  anim.finish = function () { clearTimeout(anim.timer); anim.timer = null; anim.finish = null; if (app.game === state) syncTiles(state.tiles, true); };
  anim.timer = setTimeout(anim.finish, SLIDE_MS);
  renderHud();
  if (app.modal) render();
}
function stopAnim() { if (anim.timer) clearTimeout(anim.timer); anim.timer = null; anim.finish = null; }
// Ход в сторону, где ничего не сдвигается: поле слегка качнётся
function nudge(dir) {
  var b = appEl.querySelector('.board');
  if (!b || reduced()) return;
  b.classList.remove('nudge-left', 'nudge-right', 'nudge-up', 'nudge-down');
  void b.offsetWidth;
  b.classList.add('nudge-' + dir);
}

// ===== Плитки =====
function place(el, i) { el.style.setProperty('--x', i % G.SIZE); el.style.setProperty('--y', Math.floor(i / G.SIZE)); }
function tileClass(v) { return 'tile v' + (v <= 2048 ? v : 'big') + (v >= 1024 ? ' small' : '') + (v >= 16384 ? ' tiny' : ''); }
function syncTiles(tiles, animate) {
  var layer = appEl.querySelector('.tiles');
  if (!layer) return;
  var keep = {};
  tiles.forEach(function (t) {
    keep[t.id] = true;
    var el = tileEls[t.id];
    if (!el || el.parentNode !== layer) {
      el = document.createElement('div');
      el.setAttribute('aria-hidden', 'true');
      tileEls[t.id] = el;
      layer.appendChild(el);
      el.className = tileClass(t.v) + (animate && t.merged ? ' merged' : '') + (animate && t.fresh ? ' fresh' : '');
    }
    el.textContent = String(t.v);
    place(el, t.i);
  });
  Object.keys(tileEls).forEach(function (id) { if (!keep[id]) { var el = tileEls[id]; if (el.parentNode) el.parentNode.removeChild(el); delete tileEls[id]; } });
  var live = appEl.querySelector('.live');
  if (live) live.textContent = boardText();
}
// Поле для читалки экрана: строки сверху вниз
function boardText() {
  var g = [], i;
  for (i = 0; i < 16; i++) g.push('·');
  app.game.tiles.forEach(function (t) { g[t.i] = String(t.v); });
  var rows = [];
  for (i = 0; i < 4; i++) rows.push(g.slice(i * 4, i * 4 + 4).join(' '));
  return tr('board.text', { rows: rows.join('; '), score: app.game.score });
}

// ===== Вёрстка =====
var LOGO = '<div class="logo" aria-hidden="true"><i class="tile v2">2</i><i class="tile v8">8</i><i class="tile v64">64</i><i class="tile v2048 small">2048</i></div>';
function startHtml() {
  var saved = app.game && !app.game.over && app.game.moves > 0;
  return '<div class="start"><div class="brand-row"><div class="top-actions">' + catalogLinkHtml() + '</div><div class="top-actions">' + themeButtonHtml() + '</div></div>' +
    '<div class="hero">' + LOGO + '<h1>' + esc(tr('title')) + '</h1><p class="muted-text">' + esc(tr('tagline')) + '</p></div>' +
    '<div class="scores"><div class="score-box"><small>' + esc(tr('best')) + '</small><b>' + fmtNum(app.best) + '</b></div>' +
      (saved ? '<div class="score-box"><small>' + esc(tr('saved')) + '</small><b>' + fmtNum(app.game.score) + '</b></div>' : '') + '</div>' +
    '<div class="rewards-note muted-text">' + esc(tr('rewards.note', { a: W.CONFIG.rewards['2048'].t512, b: W.CONFIG.rewards['2048'].t1024, c: W.CONFIG.rewards['2048'].t2048 })) + '</div>' +
    '<div class="start-actions">' + (saved ? '<button class="btn-play" data-act="continue">' + esc(tr('continue')) + '</button><button class="btn-secondary wide" data-act="new">' + esc(tr('newGame')) + '</button>'
      : '<button class="btn-play" data-act="new">' + esc(tr('play')) + '</button>') +
      '<button class="btn-secondary wide" data-act="rules">' + esc(tr('rules')) + '</button></div></div>';
}
function hudHtml() {
  var g = app.game;
  return '<div class="score-box"><small>' + esc(tr('score')) + '</small><b data-score>' + fmtNum(g.score) + '</b></div>' +
    '<div class="score-box"><small>' + esc(tr('best')) + '</small><b data-best>' + fmtNum(app.best) + '</b></div>' +
    '<button class="btn-secondary small" data-act="restart">' + esc(tr('newGame')) + '</button>';
}
function toastHtml() { return app.toast ? '<div class="toast' + (app.toast.dim ? ' dim' : '') + '" role="status">' + esc(app.toast.text) + '</div>' : '<div class="toast empty" role="status"></div>'; }
function gameHtml() {
  var cells = '';
  for (var i = 0; i < 16; i++) cells += '<i></i>';
  return '<div class="topbar"><div class="top-actions"><button class="theme-btn" data-act="menu" aria-label="' + esc(tr('toMenu')) + '">←</button></div>' +
      '<div class="game-title">' + esc(tr('title')) + '</div>' +
      '<div class="top-actions">' + balanceChipHtml() + '<button class="theme-btn" data-act="rules" aria-label="' + esc(tr('rules')) + '">?</button>' + themeButtonHtml() + '</div></div>' +
    '<div class="hud">' + hudHtml() + '</div>' + toastHtml() +
    '<div class="board-wrap"><div class="board" role="application" tabindex="0" aria-label="' + esc(tr('board.label')) + '" aria-describedby="board-live"><div class="cells">' + cells + '</div><div class="tiles"></div></div></div>' +
    '<div class="live" id="board-live" aria-live="polite"></div>' +
    '<p class="hint-touch muted-text">' + esc(tr('hint.touch')) + '</p><p class="hint-keys muted-text">' + esc(tr('hint.keys')) + '</p>';
}
// Счёт и сообщение без перерисовки поля (иначе пропали бы плитки посреди анимации)
function renderHud() {
  var h = appEl.querySelector('.hud'), t = appEl.querySelector('.toast');
  if (h) { var s = h.querySelector('[data-score]'), b = h.querySelector('[data-best]'); if (s) s.textContent = fmtNum(app.game.score); if (b) b.textContent = fmtNum(app.best); }
  if (t) { var tmp = document.createElement('div'); tmp.innerHTML = toastHtml(); t.replaceWith(tmp.firstChild); }
}
function rulesHtml() {
  return '<div class="overlay sheet-overlay" role="dialog" aria-modal="true" aria-label="' + esc(tr('rules.title')) + '"><div class="dialog rules">' +
    '<div class="rules-head"><h2>' + esc(tr('rules.title')) + '</h2><button class="btn-secondary small" data-act="close" data-autofocus>' + esc(tr('close')) + '</button></div>' +
    [1, 2, 3, 4, 5].map(function (k) { return '<div class="rule"><b>' + esc(tr('rules.' + k + '.title')) + '</b><span>' + esc(tr('rules.' + k + '.text', { a: W.CONFIG.rewards['2048'].t512, b: W.CONFIG.rewards['2048'].t1024, c: W.CONFIG.rewards['2048'].t2048 })) + '</span></div>'; }).join('') + '</div></div>';
}
function modalHtml() {
  var g = app.game;
  if (app.modal === 'rules') return rulesHtml();
  if (app.modal === 'restart') {
    return '<div class="overlay" role="alertdialog" aria-modal="true" aria-label="' + esc(tr('restart.title')) + '"><div class="dialog"><h2>' + esc(tr('restart.title')) + '</h2><span class="muted-text">' + esc(tr('restart.text')) + '</span>' +
      '<div class="dialog-actions"><button class="btn-secondary" data-act="close" data-autofocus>' + esc(tr('cancel')) + '</button><button class="btn-primary" data-act="restart-ok">' + esc(tr('restart.ok')) + '</button></div></div></div>';
  }
  if (app.modal === 'won') {
    return '<div class="overlay" role="dialog" aria-modal="true" aria-label="' + esc(tr('won.title')) + '"><div class="dialog end"><h2>' + esc(tr('won.title')) + '</h2><span class="muted-text">' + esc(tr('won.text')) + '</span>' +
      '<div class="end-actions"><button class="btn-primary" data-act="close" data-autofocus>' + esc(tr('won.keep')) + '</button><button class="btn-secondary" data-act="restart-ok">' + esc(tr('newGame')) + '</button></div></div></div>';
  }
  if (app.modal === 'over') {
    var rec = g.score > 0 && g.score >= app.best;
    return '<div class="overlay" role="dialog" aria-modal="true" aria-label="' + esc(tr('over.title')) + '"><div class="dialog end"><h2>' + esc(tr('over.title')) + '</h2>' +
      '<small>' + esc(tr('score')) + '</small><div class="big-score">' + fmtNum(g.score) + '</div>' + (rec ? '<div class="record">' + esc(tr('over.record')) + '</div>' : '<div class="muted-text">' + esc(tr('best')) + ' <b>' + fmtNum(app.best) + '</b></div>') +
      '<div class="muted-text">' + esc(tr('over.tile', { n: g.maxTile })) + '</div>' +
      '<div class="end-actions"><button class="btn-primary" data-act="restart-ok" data-autofocus>' + esc(tr('again')) + '</button><button class="btn-secondary" data-act="menu">' + esc(tr('toMenu')) + '</button>' +
      '<a class="btn-secondary" href="' + CATALOG_URL + '" data-leave>' + esc(tr('toCatalog')) + '</a></div></div></div>';
  }
  return '';
}

function render() {
  var scr = appEl.querySelector('.screen');
  if (app.screen === 'game' && scr && scr.getAttribute('data-screen') === 'game') {
    // поле уже на экране: обновляем только шапку, счёт и окна
    renderHud();
    var top = scr.querySelector('.topbar .top-actions:last-child');
    if (top) top.innerHTML = balanceChipHtml() + '<button class="theme-btn" data-act="rules" aria-label="' + esc(tr('rules')) + '">?</button>' + themeButtonHtml();
  } else {
    tileEls = {};
    appEl.innerHTML = '<div class="screen" data-screen="' + app.screen + '">' + (app.screen === 'game' ? gameHtml() : startHtml()) + '</div><div class="modals"></div>';
    if (app.screen === 'game') syncTiles(app.game.tiles, false);
  }
  var m = appEl.querySelector('.modals');
  if (m) m.innerHTML = modalHtml();
  var auto = appEl.querySelector('.modals [data-autofocus]');
  if (auto) auto.focus();
}
function openGame() { app.screen = 'game'; app.modal = app.game.over ? 'over' : null; render(); }
function toMenu() { if (anim.finish) anim.finish(); app.screen = 'start'; app.modal = null; render(); }

// ===== Управление =====
appEl.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-act]');
  if (!btn) return;
  switch (btn.getAttribute('data-act')) {
    case 'theme': window.PlatformTheme.toggle(); break;
    case 'new': newGame(); openGame(); break;
    case 'continue': openGame(); break;
    case 'rules': app.modal = 'rules'; render(); break;
    case 'close': app.modal = null; render(); break;
    case 'restart': if (app.game.moves > 0 && !app.game.over) { app.modal = 'restart'; render(); } else { newGame(); app.screen = 'game'; appEl.innerHTML = ''; render(); } break;
    case 'restart-ok': newGame(); app.screen = 'game'; appEl.innerHTML = ''; render(); break;
    case 'menu': toMenu(); break;
  }
});
var KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && app.modal && app.modal !== 'over') { app.modal = null; render(); return; }
  var dir = KEYS[e.code] || KEYS[e.key];
  if (!dir || app.screen !== 'game' || app.modal || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  e.preventDefault();
  doMove(dir);
});
// Свайп по полю: направление по большей составляющей, короткие касания не считаются
var swipe = null;
appEl.addEventListener('pointerdown', function (e) {
  if (!e.target.closest('.board') || app.modal) return;
  swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
appEl.addEventListener('pointerup', function (e) {
  if (!swipe || swipe.id !== e.pointerId) return;
  var dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  swipe = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
  doMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
});
appEl.addEventListener('pointercancel', function () { swipe = null; });

window.PlatformTheme.onChange(function () { render(); });
W.onShown(function (v) { var els = appEl.querySelectorAll('.bal [data-bal]'); for (var i = 0; i < els.length; i++) els[i].textContent = fmtNum(v); });
app.game = loadSaved();
render();
