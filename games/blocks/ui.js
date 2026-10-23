// ===== Интерфейс игры «Блоки» =====
// Все надписи берутся из словаря (games/blocks/ru.js) по ключам games.blocks.*.
// Поле и лоток рисуются один раз при входе в партию, дальше меняются только классы клеток (перетаскивание идёт без перерисовки страницы).
// Перетаскивание: фигура едет над пальцем (на сенсорном экране выше на две клетки, чтобы её было видно), на поле — тень и подсветка линий.
// Клавиатура: 1–3 — выбрать фигуру, стрелки — двигать, Enter — поставить, Esc — отменить.
var CATALOG_URL = '../../index.html';
var SAVE_KEY = 'game:blocks:save', BEST_KEY = 'game:blocks:best';
var B = window.Blocks, W = window.PlatformWallet, N = B.SIZE;
var tr = function (key, params) { return window.I18n.t('games.blocks.' + key, params); };

var appEl = document.getElementById('app');
var app = { screen: 'start', modal: null, game: null, best: num(window.PlatformStorage.get(BEST_KEY, 0)), toast: null, sel: -1, cur: { x: 0, y: 0 } };
var drag = null;                 // { slot, el, dx, dy, x, y, ok, pointerId }

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
function loadSaved() { try { return B.sanitize(window.PlatformStorage.get(SAVE_KEY, null)); } catch (e) { return null; } }
function save() { if (app.game && !app.game.over) window.PlatformStorage.set(SAVE_KEY, B.plain(app.game)); else window.PlatformStorage.remove(SAVE_KEY); }
function newGame() { app.game = B.create(); app.modal = null; app.toast = null; app.sel = -1; save(); }
function noteBest() { if (app.game.score > app.best) { app.best = app.game.score; window.PlatformStorage.set(BEST_KEY, app.best); } }
// Награда за очки 1000, 2500, 5000 — один раз за партию каждая; уровень нужен серверу, чтобы выдать её по своей таблице
function rewardMilestones() {
  var got = B.newMilestones(app.game), total = 0;
  if (!got.length) return;
  got.forEach(function (m) { total += W.earn('blocks', W.CONFIG.rewards.blocks['s' + m], undefined, false, 's' + m).granted; });
  var top = got[got.length - 1];
  showToast(total > 0 ? tr('reward', { score: fmtNum(top), n: fmtNum(total), unit: window.I18n.plural(total, 'wallet.unit') }) : tr('reward.limit', { score: fmtNum(top) }), total <= 0);
}
function showToast(text, dim) {
  var t = app.toast = { text: text, dim: dim };
  renderHud();
  setTimeout(function () { if (app.toast === t) { app.toast = null; renderHud(); } }, 3500);
}

function placeAt(slot, x, y) {
  var before = app.game, piece = before.tray[slot], r = B.place(before, slot, x, y);
  if (!r.ok) return false;
  var colors = before.grid.slice();                       // цвета клеток до очистки (вместе с только что поставленной фигурой)
  r.placed.forEach(function (i) { colors[i] = piece.color; });
  if (before.moves === 0) { W.markPlayed(); W.countPlay('blocks'); }      // партия началась с первого хода
  app.game = r.state; app.sel = -1;
  noteBest(); rewardMilestones(); save();
  paintBoard({ placed: r.placed, cleared: r.cleared.cells, colors: colors });
  paintTray(); renderHud();
  floatScore(r);
  if (r.state.over) setTimeout(function () { if (app.game === r.state && !app.modal) { app.modal = 'over'; renderModal(); } }, reduced() ? 0 : 900);
  return true;
}

// ===== Вёрстка =====
var LOGO = '<div class="logo" aria-hidden="true">' + [1, 1, 0, 3, 0, 1, 2, 3, 0, 2, 2, 3].map(function (c) { return '<i class="' + (c ? 'b c' + c : '') + '"></i>'; }).join('') + '</div>';
function startHtml() {
  var saved = app.game && !app.game.over && app.game.moves > 0, rw = W.CONFIG.rewards.blocks;
  return '<div class="start"><div class="brand-row"><div class="top-actions">' + catalogLinkHtml() + '</div><div class="top-actions">' + themeButtonHtml() + '</div></div>' +
    '<div class="hero">' + LOGO + '<h1>' + esc(tr('title')) + '</h1><p class="muted-text">' + esc(tr('tagline')) + '</p></div>' +
    '<div class="scores"><div class="score-box"><small>' + esc(tr('best')) + '</small><b>' + fmtNum(app.best) + '</b></div>' +
      (saved ? '<div class="score-box"><small>' + esc(tr('saved')) + '</small><b>' + fmtNum(app.game.score) + '</b></div>' : '') + '</div>' +
    '<div class="muted-text small">' + esc(tr('rewards.note', { a: rw.s1000, b: rw.s2500, c: rw.s5000 })) + '</div>' +
    '<div class="start-actions">' + (saved ? '<button class="btn-play" data-act="continue">' + esc(tr('continue')) + '</button><button class="btn-secondary wide" data-act="new">' + esc(tr('newGame')) + '</button>'
      : '<button class="btn-play" data-act="new">' + esc(tr('play')) + '</button>') +
      '<button class="btn-secondary wide" data-act="rules">' + esc(tr('rules')) + '</button></div></div>';
}
function gameHtml() {
  var cells = '';
  for (var i = 0; i < N * N; i++) cells += '<i data-c="' + i + '"></i>';
  return '<div class="topbar"><div class="top-actions"><button class="theme-btn" data-act="menu" aria-label="' + esc(tr('toMenu')) + '">←</button></div>' +
      '<div class="game-title">' + esc(tr('title')) + '</div>' +
      '<div class="top-actions" data-top>' + topActionsHtml() + '</div></div>' +
    '<div class="hud" data-hud></div>' +
    '<div class="board-wrap"><div class="board" role="application" tabindex="0" aria-label="' + esc(tr('board.label')) + '" aria-describedby="board-live">' + cells + '<div class="fx" aria-hidden="true"></div></div></div>' +
    '<div class="tray" role="group" aria-label="' + esc(tr('tray.label')) + '">' + [0, 1, 2].map(function (k) { return '<button class="slot" data-slot="' + k + '"></button>'; }).join('') + '</div>' +
    '<div class="msg" data-msg></div><div class="live" id="board-live" aria-live="polite"></div>';
}
function topActionsHtml() { return balanceChipHtml() + '<button class="theme-btn" data-act="rules" aria-label="' + esc(tr('rules')) + '">?</button>' + themeButtonHtml(); }
function renderHud() {
  var h = appEl.querySelector('[data-hud]');
  if (!h || !app.game) return;
  var g = app.game;
  h.innerHTML = '<div class="score-box"><small>' + esc(tr('score')) + '</small><b>' + fmtNum(g.score) + '</b></div>' +
    '<div class="score-box"><small>' + esc(tr('best')) + '</small><b>' + fmtNum(app.best) + '</b></div>' +
    (g.combo > 1 ? '<div class="combo" aria-label="' + esc(tr('combo.label', { n: g.combo })) + '">×' + g.combo + '</div>' : '') +
    '<button class="btn-secondary small" data-act="restart">' + esc(tr('newGame')) + '</button>';
  // сообщение о награде — под фигурами, на месте подсказки (поле не закрывает)
  var m = appEl.querySelector('[data-msg]');
  if (m) m.innerHTML = app.toast ? '<div class="toast' + (app.toast.dim ? ' dim' : '') + '" role="status">' + esc(app.toast.text) + '</div>'
    : '<p class="hint-touch muted-text">' + esc(tr('hint.touch')) + '</p><p class="hint-keys muted-text">' + esc(tr('hint.keys')) + '</p>';
}
// Поле: занятые клетки цветом; при перетаскивании — тень фигуры и подсветка линий, которые исчезнут
function paintBoard(anim) {
  var cells = appEl.querySelectorAll('.board [data-c]'), g = app.game.grid;
  var ghost = {}, clear = {}, bad = false, dist = {};
  var target = drag && drag.slot >= 0 ? drag : (app.sel >= 0 ? { slot: app.sel, x: app.cur.x, y: app.cur.y, kb: true } : null);
  if (target && target.x !== null) {
    var p = app.game.tray[target.slot], pv = p ? B.preview(g, p, target.x, target.y) : null;
    if (pv) {
      p.cells.forEach(function (c) { ghost[(target.y + c[1]) * N + target.x + c[0]] = p.color; });
      pv.rows.forEach(function (r) { for (var c = 0; c < N; c++) clear[r * N + c] = true; });
      pv.cols.forEach(function (c) { for (var r = 0; r < N; r++) clear[r * N + c] = true; });
    } else if (target.kb && p) {
      p.cells.forEach(function (c) { var x = target.x + c[0], y = target.y + c[1]; if (x < N && y < N) ghost[y * N + x] = p.color; });
      bad = true;
    }
  }
  if (anim && anim.cleared && anim.cleared.length) {
    var cx = 0, cy = 0;
    anim.placed.forEach(function (i) { cx += i % N; cy += Math.floor(i / N); });
    cx /= anim.placed.length; cy /= anim.placed.length;
    anim.cleared.forEach(function (i) { dist[i] = Math.abs(i % N - cx) + Math.abs(Math.floor(i / N) - cy); });
  }
  for (var i = 0; i < cells.length; i++) {
    var el = cells[i], v = g[i], cls = '';
    if (v) cls = 'b c' + v;
    else if (ghost[i]) cls = 'ghost c' + ghost[i] + (bad ? ' bad' : '');
    if (v && clear[i]) cls += ' will';
    if (ghost[i] && clear[i] && !bad) cls += ' will';
    if (anim && anim.placed && anim.placed.indexOf(i) >= 0 && v) cls += ' pop';
    el.className = cls;
    el.style.animationDelay = '';
    if (anim && dist[i] !== undefined && !reduced()) burst(i, anim.colors[i], dist[i]);
  }
  var live = appEl.querySelector('.live');
  if (live && anim) live.textContent = tr('live.score', { n: app.game.score }) + (anim.cleared && anim.cleared.length ? ' ' + tr('live.cleared') : '');
}
// Исчезающие клетки: отдельные кубики поверх поля вспыхивают и гаснут (сами клетки поля уже пусты)
function burst(i, color, d) {
  var fx = appEl.querySelector('.board .fx'), cell = appEl.querySelector('.board [data-c="' + i + '"]');
  if (!fx || !cell) return;
  var b = document.createElement('i');
  b.className = 'b c' + (color || 1) + ' boom';
  b.style.left = cell.offsetLeft + 'px'; b.style.top = cell.offsetTop + 'px'; b.style.width = cell.offsetWidth + 'px'; b.style.height = cell.offsetHeight + 'px';
  b.style.animationDelay = Math.round(d * 28) + 'ms';
  fx.appendChild(b);
  setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 700 + d * 28);
}
function floatScore(r) {
  var fx = appEl.querySelector('.board .fx');
  if (!fx || reduced()) return;
  var cell = appEl.querySelector('.board [data-c="' + r.placed[0] + '"]');
  var t = document.createElement('b');
  t.className = 'float' + (r.cleared.cells.length ? ' big' : '');
  t.textContent = '+' + r.gained + (r.combo > 1 && r.cleared.cells.length ? '  ' + tr('combo', { n: r.combo }) : '');
  t.style.left = Math.min(fx.offsetWidth - 40, cell.offsetLeft) + 'px'; t.style.top = cell.offsetTop + 'px';
  fx.appendChild(t);
  setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 1100);
}
function pieceHtml(p, small) {
  var s = B.sizeOf(p), map = {}, out = '';
  p.cells.forEach(function (c) { map[c[1] * 5 + c[0]] = true; });
  for (var y = 0; y < s.h; y++) for (var x = 0; x < s.w; x++) out += '<i class="' + (map[y * 5 + x] ? 'b c' + p.color : '') + '"></i>';
  return '<span class="piece' + (small ? ' mini' : '') + '" style="--w:' + s.w + ';--h:' + s.h + '">' + out + '</span>';
}
function paintTray() {
  var slots = appEl.querySelectorAll('.tray [data-slot]');
  for (var k = 0; k < slots.length; k++) {
    var p = app.game.tray[k], el = slots[k];
    var fits = p && B.fitsAnywhere(app.game.grid, p);
    el.innerHTML = p ? pieceHtml(p, true) : '';
    el.disabled = !p;
    el.className = 'slot' + (p && !fits ? ' nofit' : '') + (app.sel === k ? ' sel' : '') + (drag && drag.slot === k ? ' lifted' : '');
    el.setAttribute('aria-label', p ? tr(fits ? 'tray.piece' : 'tray.nofit', { n: k + 1, c: p.cells.length }) : tr('tray.empty', { n: k + 1 }));
    el.setAttribute('aria-pressed', String(app.sel === k));
  }
}

function rulesHtml() {
  var rw = W.CONFIG.rewards.blocks;
  return '<div class="overlay sheet-overlay" role="dialog" aria-modal="true" aria-label="' + esc(tr('rules.title')) + '"><div class="dialog rules">' +
    '<div class="rules-head"><h2>' + esc(tr('rules.title')) + '</h2><button class="btn-secondary small" data-act="close" data-autofocus>' + esc(tr('close')) + '</button></div>' +
    [1, 2, 3, 4, 5].map(function (k) { return '<div class="rule"><b>' + esc(tr('rules.' + k + '.title')) + '</b><span>' + esc(tr('rules.' + k + '.text', { a: rw.s1000, b: rw.s2500, c: rw.s5000 })) + '</span></div>'; }).join('') + '</div></div>';
}
function modalHtml() {
  var g = app.game;
  if (app.modal === 'rules') return rulesHtml();
  if (app.modal === 'restart') {
    return '<div class="overlay" role="alertdialog" aria-modal="true" aria-label="' + esc(tr('restart.title')) + '"><div class="dialog"><h2>' + esc(tr('restart.title')) + '</h2><span class="muted-text">' + esc(tr('restart.text')) + '</span>' +
      '<div class="dialog-actions"><button class="btn-secondary" data-act="close" data-autofocus>' + esc(tr('cancel')) + '</button><button class="btn-primary" data-act="restart-ok">' + esc(tr('restart.ok')) + '</button></div></div></div>';
  }
  if (app.modal === 'over') {
    var rec = g.score > 0 && g.score >= app.best;
    return '<div class="overlay" role="dialog" aria-modal="true" aria-label="' + esc(tr('over.title')) + '"><div class="dialog end"><h2>' + esc(tr('over.title')) + '</h2>' +
      '<small>' + esc(tr('score')) + '</small><div class="big-score">' + fmtNum(g.score) + '</div>' + (rec ? '<div class="record">' + esc(tr('over.record')) + '</div>' : '<div class="muted-text">' + esc(tr('best')) + ' <b>' + fmtNum(app.best) + '</b></div>') +
      '<div class="end-actions"><button class="btn-primary" data-act="restart-ok" data-autofocus>' + esc(tr('again')) + '</button><button class="btn-secondary" data-act="menu">' + esc(tr('toMenu')) + '</button>' +
      '<a class="btn-secondary" href="' + CATALOG_URL + '" data-leave>' + esc(tr('toCatalog')) + '</a></div></div></div>';
  }
  return '';
}
function renderModal() {
  var m = appEl.querySelector('.modals');
  if (!m) return;
  m.innerHTML = modalHtml();
  var auto = m.querySelector('[data-autofocus]');
  if (auto) auto.focus();
}
function render() {
  var scr = appEl.querySelector('.screen');
  if (!(app.screen === 'game' && scr && scr.getAttribute('data-screen') === 'game')) {
    appEl.innerHTML = '<div class="screen" data-screen="' + app.screen + '">' + (app.screen === 'game' ? gameHtml() : startHtml()) + '</div><div class="modals"></div>';
  } else {
    var top = appEl.querySelector('[data-top]');
    if (top) top.innerHTML = topActionsHtml();
  }
  if (app.screen === 'game') { paintBoard(); paintTray(); renderHud(); }
  renderModal();
}
function openGame() { app.screen = 'game'; app.modal = app.game.over ? 'over' : null; app.sel = -1; render(); }
function toMenu() { cancelDrag(); app.screen = 'start'; app.modal = null; render(); }

// ===== Перетаскивание =====
function cellSize() { var c = appEl.querySelector('.board [data-c="0"]'), c1 = appEl.querySelector('.board [data-c="1"]'); return c && c1 ? c1.getBoundingClientRect().left - c.getBoundingClientRect().left : 40; }
function startDrag(slot, e) {
  var p = app.game.tray[slot];
  if (!p || app.modal || app.game.over) return;
  var size = cellSize(), s = B.sizeOf(p);
  var el = document.createElement('div');
  el.className = 'drag'; el.innerHTML = pieceHtml(p, false);
  el.style.setProperty('--dcell', size + 'px');               // фигура в руке — в размер клеток поля
  document.body.appendChild(el);
  var touch = e.pointerType !== 'mouse';
  // фигура едет над пальцем: её середина по горизонтали под пальцем, а низ — выше пальца на клетку (на сенсорном экране)
  drag = { slot: slot, el: el, w: s.w * size, h: s.h * size, lift: touch ? s.h * size + size * 1.2 : s.h * size / 2, x: null, y: null, pointerId: e.pointerId };
  app.sel = -1;
  moveDrag(e.clientX, e.clientY);
  paintTray();
}
function moveDrag(px, py) {
  if (!drag) return;
  var left = px - drag.w / 2, top = py - drag.lift;
  drag.el.style.transform = 'translate(' + left + 'px,' + top + 'px)';
  var board = appEl.querySelector('.board [data-c="0"]').getBoundingClientRect(), size = cellSize();
  var x = Math.round((left - board.left) / size), y = Math.round((top - board.top) / size);
  var p = app.game.tray[drag.slot];
  var ok = B.canPlace(app.game.grid, p, x, y);
  if (ok !== !!drag.ok || x !== drag.x || y !== drag.y) { drag.x = ok ? x : null; drag.y = ok ? y : null; drag.ok = ok; paintBoard(); }
}
function endDrag() {
  if (!drag) return;
  var d = drag, placed = false;
  drag = null;
  if (d.ok) placed = placeAt(d.slot, d.x, d.y);
  if (d.el.parentNode) d.el.parentNode.removeChild(d.el);
  if (!placed) { paintBoard(); paintTray(); }
}
function cancelDrag() { if (drag) { if (drag.el.parentNode) drag.el.parentNode.removeChild(drag.el); drag = null; } }

appEl.addEventListener('pointerdown', function (e) {
  var slot = e.target.closest('.tray [data-slot]');
  if (slot && !slot.disabled && app.screen === 'game') { e.preventDefault(); startDrag(Number(slot.getAttribute('data-slot')), e); }
});
window.addEventListener('pointermove', function (e) { if (drag && e.pointerId === drag.pointerId) { e.preventDefault(); moveDrag(e.clientX, e.clientY); } }, { passive: false });
window.addEventListener('pointerup', function (e) { if (drag && e.pointerId === drag.pointerId) endDrag(); });
window.addEventListener('pointercancel', function () { if (drag) { cancelDrag(); paintBoard(); paintTray(); } });

// ===== Нажатия и клавиатура =====
appEl.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-act]');
  if (!btn) return;
  switch (btn.getAttribute('data-act')) {
    case 'theme': window.PlatformTheme.toggle(); break;
    case 'new': newGame(); openGame(); break;
    case 'continue': openGame(); break;
    case 'rules': app.modal = 'rules'; renderModal(); break;
    case 'close': app.modal = null; renderModal(); break;
    case 'restart': if (app.game.moves > 0 && !app.game.over) { app.modal = 'restart'; renderModal(); } else { newGame(); openGame(); } break;
    case 'restart-ok': newGame(); openGame(); break;
    case 'menu': toMenu(); break;
  }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if (app.modal && app.modal !== 'over') { app.modal = null; renderModal(); return; }
    if (app.sel >= 0) { app.sel = -1; paintBoard(); paintTray(); }
    return;
  }
  if (app.screen !== 'game' || app.modal || !app.game || e.altKey || e.ctrlKey || e.metaKey) return;
  if (/^[1-3]$/.test(e.key)) {
    var k = Number(e.key) - 1;
    if (app.game.tray[k]) { app.sel = app.sel === k ? -1 : k; app.cur = { x: 0, y: 0 }; paintBoard(); paintTray(); }
    e.preventDefault(); return;
  }
  if (app.sel < 0) return;
  var p = app.game.tray[app.sel], s = B.sizeOf(p), mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (mv) {
    app.cur.x = Math.max(0, Math.min(N - s.w, app.cur.x + mv[0])); app.cur.y = Math.max(0, Math.min(N - s.h, app.cur.y + mv[1]));
    paintBoard(); e.preventDefault();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!placeAt(app.sel, app.cur.x, app.cur.y)) { var b = appEl.querySelector('.board'); if (b && !reduced()) { b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); } }
  }
});

window.PlatformTheme.onChange(function () { render(); });
W.onShown(function (v) { var els = appEl.querySelectorAll('.bal [data-bal]'); for (var i = 0; i < els.length; i++) els[i].textContent = fmtNum(v); });
window.addEventListener('resize', function () { cancelDrag(); });
app.game = loadSaved();
render();
