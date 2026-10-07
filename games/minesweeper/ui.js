// ===== Интерфейс игры «Сапёр» =====
// Все надписи берутся из словаря (games/minesweeper/ru.js) по ключам games.minesweeper.*.
// Тема приходит из общего модуля платформы (shared/theme.js), рекорды хранятся через PlatformStorage.
var CATALOG_URL = '../../index.html';
var BEST_KEY = 'game:minesweeper:best';
var LONG_PRESS_MS = 450;
var MS = window.Minesweeper;
var tr = function (key, params) { return window.I18n.t('games.minesweeper.' + key, params); };

var game = null;
var app = {
  screen: 'start', level: 'novice', modal: null, mode: 'open', face: 'idle',
  bests: MS.sanitizeBests(window.PlatformStorage.get(BEST_KEY, null)),
  focus: 0, hintIdx: -1, startedAt: 0, elapsed: 0, anim: {}, result: null, mineDelay: {}
};
var appEl = document.getElementById('app');
var gameToken = 0; // растёт при выходе из партии: отменяет отложенные окна
var timerId = null;
var press = { timer: null, index: -1, long: false, suppress: false };

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}
function isDarkTheme() { return window.PlatformTheme.isDark(); }
function toggleTheme() { window.PlatformTheme.toggle(); }

// ===== Иконки =====
function catalogLinkHtml() {
  return '<a class="theme-btn" href="' + CATALOG_URL + '" aria-label="' + esc(tr('toCatalog')) + '" title="' + esc(tr('toCatalog')) + '">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/>' +
    '<rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg></a>';
}
function catalogButtonHtml(act) {
  return '<button class="theme-btn" data-act="' + act + '" data-key="catalog" aria-label="' + esc(tr('toCatalog')) + '" title="' + esc(tr('toCatalog')) + '">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/>' +
    '<rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg></button>';
}
function themeButtonHtml() {
  var dark = isDarkTheme();
  var icon = dark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 13.2A8.5 8.5 0 1 1 10.8 3a6.7 6.7 0 0 0 10.2 10.2z"/></svg>';
  return '<button class="theme-btn" data-act="theme" data-key="theme" aria-label="' +
    esc(window.I18n.t(dark ? 'theme.toLight' : 'theme.toDark')) + '">' + icon + '</button>';
}
var FACES = { idle: '•‿•', press: '•o•', won: '^‿^', lost: '×_×' };

// ===== Состояние партии =====
function secondsNow() {
  if (!game || game.status === 'ready') return 0;
  if (MS.isOver(game)) return app.elapsed;
  return Math.min(MS.MAX_TIME, Math.floor((Date.now() - app.startedAt) / 1000));
}
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
function startTimer() {
  stopTimer();
  timerId = setInterval(function () {
    var el = appEl.querySelector('[data-timer]');
    if (el) el.textContent = MS.formatTime(secondsNow());
  }, 500);
}

function newGame() {
  gameToken++;
  stopTimer();
  game = MS.createGame(app.level);
  app.screen = 'game';
  app.modal = null; app.face = 'idle'; app.hintIdx = -1; app.focus = 0;
  app.startedAt = 0; app.elapsed = 0; app.anim = {}; app.mineDelay = {}; app.result = null;
  press.suppress = false;
}
function toStart() {
  gameToken++;
  stopTimer();
  game = null; app.screen = 'start'; app.modal = null;
}

// Применяет результат действия: анимации, таймер, конец партии
function applyResult(res, wasReady) {
  if (!res || !res.changed) return;
  if (wasReady) { app.startedAt = Date.now(); startTimer(); window.PlatformWallet.markPlayed(); }
  app.anim = {};
  if (res.opened) res.opened.forEach(function (o) { app.anim[o.index] = Math.min(o.dist * 22, 200); });
  if (MS.isOver(game)) {
    app.elapsed = Math.min(MS.MAX_TIME, Math.floor((Date.now() - app.startedAt) / 1000));
    stopTimer();
    finish();
  }
}

function finish() {
  var token = gameToken, won = game.status === 'won', reduced = prefersReducedMotion();
  app.face = won ? 'won' : 'lost';
  if (won) {
    var rr = MS.recordResult(app.bests, game.level, app.elapsed);
    app.bests = rr.bests;
    window.PlatformStorage.set(BEST_KEY, app.bests);
    app.result = { won: true, time: app.elapsed, isRecord: rr.isRecord, best: rr.best };
  } else {
    app.result = { won: false, time: app.elapsed, left: MS.cellsToOpen(game) };
    var n = 0;
    app.mineDelay = {};
    for (var i = 0; i < game.layout.length; i++) {
      if (game.layout[i]) { app.mineDelay[i] = Math.min(n * 12, 600); n++; }
    }
  }
  setTimeout(function () {
    if (token !== gameToken) return;
    app.modal = won ? 'win' : 'lose';
    render();
  }, reduced ? 0 : (won ? 700 : 1000));
}

function openAt(i) {
  if (!game || MS.isOver(game) || app.modal) return;
  app.focus = i;
  var wasReady = game.status === 'ready';
  if (game.open[i]) { applyResult(MS.chord(game, i), false); }
  else if (!game.flag[i]) applyResult(MS.reveal(game, i), wasReady);
  render();
}
function flagAt(i) {
  if (!game || MS.isOver(game) || app.modal) return;
  app.focus = i;
  if (MS.toggleFlag(game, i)) { app.anim = {}; app.anim['f' + i] = 1; }
  render();
}

// ===== Размер клеток =====
function cellSize() {
  var lv = MS.LEVELS[game.level], cols = lv.cols, vw = window.innerWidth;
  var w = Math.min(vw, 900) - 32 - 16; // поля страницы и карточки поля
  if (vw >= 700) {
    var cap = { novice: 48, amateur: 42, expert: 36 }[game.level] || 36;
    return Math.max(20, Math.min(cap, Math.floor((w - 100) / cols)));
  }
  return Math.max(20, Math.floor((w - (vw <= 320 ? 0 : 6)) / cols));
}

// ===== Вёрстка =====
function levelCardHtml(id) {
  var lv = MS.LEVELS[id], sel = app.level === id;
  var best = app.bests[id];
  return '<button class="level-card" data-key="lv-' + id + '" data-level="' + id + '" aria-pressed="' + sel + '">' +
    '<span class="lv-name">' + esc(tr('level.' + id)) + '</span>' +
    '<span class="lv-sub">' + esc(tr('level.sub', { c: lv.cols, r: lv.rows, m: lv.mines })) + '</span>' +
    '<span class="lv-best"><small>' + esc(tr('best')) + '</small><b>' + esc(best === null ? tr('noBest') : MS.formatTime(best)) + '</b></span>' +
    '<span class="lv-check" aria-hidden="true">✓</span></button>';
}

function startHtml() {
  var cells = '';
  var demo = ['1', '', '2', '⚑', '', '1', '✸', '1', ''];
  demo.forEach(function (v, i) {
    cells += '<i class="' + (v === '' ? 'z' : (v === '⚑' ? 'f' : (v === '✸' ? 'm' : 'n' + v))) + (i === 3 || i === 6 ? ' cl' : '') + '">' + v + '</i>';
  });
  return '<div class="start">' +
    '<div class="brand-row"><div class="top-actions">' + catalogLinkHtml() + '</div><div class="top-actions">' + themeButtonHtml() + '</div></div>' +
    '<div class="hero"><div class="logo-mini" aria-hidden="true">' + cells + '</div>' +
      '<h1>' + esc(tr('title')) + '</h1><p class="muted-text">' + esc(tr('tagline')) + '</p></div>' +
    '<div class="levels" role="group" aria-label="' + esc(tr('level.label')) + '">' +
      MS.LEVEL_IDS.map(levelCardHtml).join('') + '</div>' +
    '<div class="start-actions"><button class="btn-play" id="play" data-key="play" data-act="play">' + esc(tr('play')) + '</button>' +
      '<button class="btn-secondary wide" data-act="rules" data-key="rules">' + esc(tr('rules')) + '</button></div></div>';
}

function cellHtml(i) {
  var kind = MS.cellKind(game, i), n = MS.cellNumber(game, i);
  var cls = 'c ' + kind + (n ? ' n' + n : '');
  var content = '', style = '';
  if (kind === 'flag' || kind === 'auto') content = '⚑';
  else if (kind === 'num') content = String(n);
  else if (kind === 'mine' || kind === 'boom') content = '✸';
  else if (kind === 'wrong') content = '⚑<s></s>';
  if (app.anim[i] !== undefined) { cls += ' reveal'; style = 'animation-delay:' + app.anim[i] + 'ms'; }
  if (app.anim['f' + i]) cls += ' pop';
  if (app.mineDelay[i] !== undefined) { cls += ' mine-in'; style = 'animation-delay:' + app.mineDelay[i] + 'ms'; }
  if (app.hintIdx >= 0 && !game.open[i] && !game.flag[i] && MS.neighbors(game.cols, game.rows, app.hintIdx).indexOf(i) >= 0) cls += ' hint';
  var stateKey = { closed: 'cell.closed', flag: 'cell.flag', auto: 'cell.flag', zero: 'cell.zero', mine: 'cell.mine', boom: 'cell.boom', wrong: 'cell.wrong' }[kind];
  var state = kind === 'num' ? tr('cell.num', { n: n }) : tr(stateKey);
  var aria = tr('cell.pos', { state: state, r: Math.floor(i / game.cols) + 1, c: (i % game.cols) + 1 });
  return '<button class="' + cls + '" data-i="' + i + '" tabindex="' + (i === app.focus ? 0 : -1) + '" aria-label="' + esc(aria) + '"' +
    (style ? ' style="' + style + '"' : '') + '>' + content + '</button>';
}

function gameHtml() {
  var lv = MS.LEVELS[game.level], cs = cellSize();
  var cells = '';
  for (var i = 0; i < game.cols * game.rows; i++) cells += cellHtml(i);
  var small = game.level === 'expert' && window.innerWidth < 352;
  var left = MS.minesLeft(game);
  var over = MS.isOver(game);
  var shake = game.status === 'lost' && !prefersReducedMotion() ? ' shake' : '';
  var glow = game.status === 'won' ? ' glow' : '';
  var over2 = game.status === 'ready' || game.status === 'playing';
  return '<div class="topbar"><div class="top-actions">' + catalogButtonHtml(over2 && game.status === 'playing' ? 'exit' : 'exit') + '</div>' +
      '<div class="game-title">' + esc(tr('level.name', { name: tr('level.' + game.level), c: lv.cols, r: lv.rows })) + '</div>' +
      '<div class="top-actions"><button class="theme-btn" data-act="rules" data-key="rules" aria-label="' + esc(tr('rules')) + '">?</button>' + themeButtonHtml() + '</div></div>' +
    '<div class="panel"><div class="hud" aria-label="' + esc(tr('hud.mines', { n: left })) + '"><span aria-hidden="true">✸</span><b>' + left + '</b></div>' +
      '<button class="face" data-act="restart" data-key="face" aria-label="' + esc(tr('face.restart')) + '">' + FACES[app.face] + '</button>' +
      '<div class="hud right"><b data-timer>' + MS.formatTime(secondsNow()) + '</b></div></div>' +
    (small ? '<p class="warn">' + esc(tr('warn.small')) + '</p>' : '') +
    '<div class="board-card' + shake + glow + '"><div class="board" role="grid" aria-label="' + esc(tr('board.label')) + '" style="--cs:' + (cs - 2) + 'px;grid-template-columns:repeat(' + game.cols + ',var(--cs))">' + cells + '</div></div>' +
    '<div class="live" role="status" aria-live="polite">' + (over ? esc(game.status === 'won' ? tr('live.win', { t: MS.formatTime(app.elapsed) }) : tr('live.lose')) : '') + '</div>' +
    '<div class="mode" role="group" aria-label="' + esc(tr('mode.label')) + '">' +
      '<button class="mode-btn" data-key="m-open" data-mode="open" aria-pressed="' + (app.mode === 'open') + '">' + esc(tr('mode.open')) + '</button>' +
      '<button class="mode-btn" data-key="m-flag" data-mode="flag" aria-pressed="' + (app.mode === 'flag') + '">' + esc(tr('mode.flag')) + '</button></div>' +
    '<p class="hint-touch muted-text">' + esc(tr('hint.touch')) + '</p>' +
    '<p class="hint-keys muted-text">' + [1, 2, 3, 4, 5].map(function (k) { return esc(tr('hint.key' + k)); }).join(' · ') + '</p>';
}

function rulesHtml() {
  function block(name) {
    return '<div class="rule"><b>' + esc(tr('rules.' + name + '.title')) + '</b><span>' + esc(tr('rules.' + name + '.text')) + '</span></div>';
  }
  return '<div class="overlay sheet-overlay" role="dialog" aria-modal="true" aria-label="' + esc(tr('rules.title')) + '"><div class="dialog rules">' +
    '<div class="rules-head"><h2>' + esc(tr('rules.title')) + '</h2><button class="btn-secondary small" data-act="close" data-autofocus data-key="close">' + esc(tr('close')) + '</button></div>' +
    block('goal') + block('digits') + block('flags') + block('controls') + block('first') + '</div></div>';
}
function confirmHtml(kind) {
  var exit = kind === 'exit';
  return '<div class="overlay" role="alertdialog" aria-modal="true" aria-label="' + esc(tr(exit ? 'confirmExit.title' : 'confirmRestart.title')) + '"><div class="dialog">' +
    '<h2>' + esc(tr(exit ? 'confirmExit.title' : 'confirmRestart.title')) + '</h2><span class="muted-text">' + esc(tr('confirm.text')) + '</span>' +
    '<div class="dialog-actions"><button class="btn-secondary" data-act="close" data-autofocus data-key="cancel">' + esc(tr('cancel')) + '</button>' +
    (exit ? '<a class="btn-primary" href="' + CATALOG_URL + '" data-key="ok">' + esc(tr('confirmExit.ok')) + '</a>'
          : '<button class="btn-primary" data-act="restart-ok" data-key="ok">' + esc(tr('confirmRestart.ok')) + '</button>') +
    '</div></div></div>';
}
function endHtml() {
  var r = app.result, lv = MS.LEVELS[game.level];
  var name = tr('level.name', { name: tr('level.' + game.level), c: lv.cols, r: lv.rows });
  var body;
  if (r.won) {
    body = '<small>' + esc(tr('win.sub', { name: name })) + '</small><div class="big-time">' + MS.formatTime(r.time) + '</div>' +
      (r.isRecord ? '<div class="record">' + esc(tr('win.record')) + '</div>' : '') +
      '<div class="muted-text">' + esc(tr('win.best')) + ' <b>' + MS.formatTime(r.best) + '</b></div>';
  } else {
    body = '<div class="muted-text">' + esc(tr('lose.left')) + ' <b>' + r.left + '</b></div>' +
      '<div class="muted-text">' + esc(tr('lose.time')) + ' <b>' + MS.formatTime(r.time) + '</b></div>';
  }
  return '<div class="overlay" role="dialog" aria-modal="true" aria-label="' + esc(tr(r.won ? 'win.title' : 'lose.title')) + '"><div class="dialog end">' +
    '<h2>' + esc(tr(r.won ? 'win.title' : 'lose.title')) + '</h2>' + body +
    '<div class="end-actions"><button class="btn-primary" data-act="restart-ok" data-autofocus data-key="again">' + esc(tr('again')) + '</button>' +
    '<button class="btn-secondary" data-act="menu" data-key="menu">' + esc(tr('changeLevel')) + '</button>' +
    '<a class="btn-secondary" href="' + CATALOG_URL + '" data-key="cat">' + esc(tr('toCatalog')) + '</a></div></div></div>';
}
function modalHtml() {
  if (app.modal === 'rules') return rulesHtml();
  if (app.modal === 'restart') return confirmHtml('restart');
  if (app.modal === 'exit') return confirmHtml('exit');
  if (app.modal === 'win' || app.modal === 'lose') return endHtml();
  return '';
}

// ===== Обновление DOM без пересоздания узлов =====
function morph(from, to) {
  if (from.nodeType === 1 && to.nodeType === 1) {
    Array.prototype.slice.call(from.attributes).forEach(function (attr) {
      if (!to.hasAttribute(attr.name)) from.removeAttribute(attr.name);
    });
    Array.prototype.slice.call(to.attributes).forEach(function (attr) {
      if (from.getAttribute(attr.name) !== attr.value) from.setAttribute(attr.name, attr.value);
    });
  }
  var i = 0;
  while (i < to.childNodes.length) {
    var a = from.childNodes[i], b = to.childNodes[i];
    if (!a) from.appendChild(b.cloneNode(true));
    else if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName ||
             (a.nodeType === 1 && a.getAttribute('data-morph-key') !== b.getAttribute('data-morph-key'))) {
      from.replaceChild(b.cloneNode(true), a);
    } else if (a.nodeType === 3) {
      if (a.data !== b.data) a.data = b.data;
    } else morph(a, b);
    i++;
  }
  while (from.childNodes.length > to.childNodes.length) from.removeChild(from.lastChild);
}

function render() {
  var tpl = document.createElement('template');
  tpl.innerHTML = '<div class="screen" data-morph-key="' + app.screen + '">' +
    (app.screen === 'start' ? startHtml() : gameHtml()) + '</div>' + modalHtml();
  morph(appEl, tpl.content);
  if (app.modal) {
    var auto = appEl.querySelector('[data-autofocus]');
    if (auto && !auto.closest('.overlay').contains(document.activeElement)) auto.focus();
  }
}

function closeModal() {
  var overlay = appEl.querySelector('.overlay');
  if (!overlay || prefersReducedMotion()) { app.modal = null; render(); return; }
  overlay.classList.add('closing');
  setTimeout(function () { app.modal = null; render(); }, 180);
}

// ===== События =====
function cellIndex(target) {
  var el = target.closest ? target.closest('[data-i]') : null;
  return el ? Number(el.getAttribute('data-i')) : -1;
}
function clearPress() {
  if (press.timer) { clearTimeout(press.timer); press.timer = null; }
  if (app.face === 'press') app.face = 'idle';
  app.hintIdx = -1;
}

appEl.addEventListener('pointerdown', function (e) {
  var i = cellIndex(e.target);
  if (i < 0 || !game || MS.isOver(game) || app.modal || (e.pointerType === 'mouse' && e.button !== 0)) return;
  press.index = i; press.long = false;
  if (!game.open[i] && !game.flag[i]) app.face = 'press';
  else if (game.open[i] && game.counts && game.counts[i]) app.hintIdx = i;
  if (e.pointerType !== 'mouse' && !game.open[i]) {
    press.timer = setTimeout(function () {
      press.timer = null; press.long = true; press.suppress = true;
      app.face = 'idle';
      flagAt(i);
    }, LONG_PRESS_MS);
  }
  render();
});
function endPress() { if (press.timer || app.face === 'press' || app.hintIdx >= 0) { clearPress(); render(); } }
appEl.addEventListener('pointerup', endPress);
appEl.addEventListener('pointercancel', endPress);
appEl.addEventListener('pointerleave', endPress);
appEl.addEventListener('contextmenu', function (e) {
  var i = cellIndex(e.target);
  if (i >= 0) { e.preventDefault(); clearPress(); flagAt(i); }
});

appEl.addEventListener('click', function (e) {
  var i = cellIndex(e.target);
  if (i >= 0) {
    if (press.suppress) { press.suppress = false; return; }
    if (app.mode === 'flag' && !game.open[i]) flagAt(i); else openAt(i);
    return;
  }
  var lvBtn = e.target.closest('[data-level]');
  if (lvBtn) { app.level = lvBtn.getAttribute('data-level'); render(); return; }
  var modeBtn = e.target.closest('[data-mode]');
  if (modeBtn) { app.mode = modeBtn.getAttribute('data-mode'); render(); return; }
  var btn = e.target.closest('[data-act]');
  if (!btn) return;
  var act = btn.getAttribute('data-act');
  if (act === 'theme') toggleTheme();
  else if (act === 'play') { newGame(); render(); }
  else if (act === 'rules') { app.modal = 'rules'; render(); }
  else if (act === 'close') closeModal();
  else if (act === 'menu') toStart(), render();
  else if (act === 'restart') {
    if (game.status === 'playing') { app.modal = 'restart'; render(); } else { newGame(); render(); }
  }
  else if (act === 'restart-ok') { newGame(); render(); }
  else if (act === 'exit') {
    if (game.status === 'playing') { app.modal = 'exit'; render(); } else window.location.href = CATALOG_URL;
  }
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && app.modal) { closeModal(); return; }
  var i = cellIndex(e.target);
  if (i < 0 || !game || app.modal) return;
  if (e.key.indexOf('Arrow') === 0) {
    e.preventDefault();
    app.focus = MS.moveFocus(game.cols, game.rows, i, e.key);
    render();
    var next = appEl.querySelector('[data-i="' + app.focus + '"]');
    if (next) next.focus();
  } else if (e.code === 'KeyF') {
    e.preventDefault(); flagAt(i);
    var again = appEl.querySelector('[data-i="' + i + '"]'); if (again) again.focus();
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault(); openAt(i);
    var cur = appEl.querySelector('[data-i="' + i + '"]'); if (cur) cur.focus();
  }
}, true);

appEl.addEventListener('dblclick', function (e) {
  var i = cellIndex(e.target);
  if (i >= 0 && game && game.open[i]) openAt(i);
});

window.addEventListener('resize', function () { if (app.screen === 'game') render(); });
if (window.PlatformTheme.onChange) window.PlatformTheme.onChange(render);

render();
