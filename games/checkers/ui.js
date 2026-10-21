// ===== Интерфейс игры «Шашки» =====
// Все надписи берутся из словаря (games/checkers/ru.js). Экраны работают с контроллером стола:
//   ctrl.seat — моё место; ctrl.view() — вид стола (Checkers.view); ctrl.send(action) → true | false; ctrl.subscribe(fn); ctrl.leave().
// Партия с ботом идёт в браузере (botController), онлайн-контроллер — в online.js.
var CATALOG_URL = '../../index.html';
var tr = function (key, params) { return window.I18n.t('games.checkers.' + key, params); };
var C = window.Checkers, P = window.PlatformProfile, W = window.PlatformWallet;
var appEl = document.getElementById('app');
var WIN_REWARD = { easy: 250, expert: 500 };       // награда за победу над ботом; за день не больше PlatformWallet.CONFIG.rewardCaps['checkers-<уровень>']
var STEP_MS = 190;                                 // анимация хода: столько на каждый прыжок

var app = { screen: 'start', mode: 'bot', level: 'easy', color: 'w', rules: false, confirm: false, ctrl: null, path: [], shownTurn: -1 };

function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
function sqName(i) { return 'abcdefgh'.charAt(i % 8) + (8 - Math.floor(i / 8)); }

// ===== Значки =====
function themeButtonHtml(cls) {
  var dark = window.PlatformTheme.isDark();
  var icon = dark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 13.2A8.5 8.5 0 1 1 10.8 3a6.7 6.7 0 0 0 10.2 10.2z"/></svg>';
  return '<button class="' + (cls || 'theme-btn') + '" data-act="theme" aria-label="' + esc(window.I18n.t(dark ? 'theme.toLight' : 'theme.toDark')) + '">' + icon + '</button>';
}
var GRID_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/>' +
  '<rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg>';
function catalogLinkHtml() { return '<a class="theme-btn" href="' + CATALOG_URL + '" data-leave aria-label="' + esc(tr('toCatalog')) + '" title="' + esc(tr('toCatalog')) + '">' + GRID_SVG + '</a>'; }
// Шашка: color 'w' | 'b'; king — дамка (с короной)
function pieceSvg(color, king, cls) {
  return '<svg class="pc' + (cls ? ' ' + cls : '') + '" viewBox="0 0 100 100" aria-hidden="true">' +
    '<ellipse cx="50" cy="56" rx="44" ry="40" class="body ' + color + '" stroke-width="4" opacity=".9"/>' +
    '<circle cx="50" cy="48" r="43" class="body ' + color + '" stroke-width="4"/>' +
    '<circle cx="50" cy="48" r="30" class="ring ' + color + '" stroke-width="4"/>' +
    (king ? '<path d="M28 58 L31 36 L41 47 L50 32 L59 47 L69 36 L72 58Z" class="crown"/>' : '') + '</svg>';
}

// ===== Экран партии =====
function mySeat() { return app.ctrl ? app.ctrl.seat : 0; }
function legalNow(v) { return app.ctrl && !v.gameOver && v.current === mySeat() && !app.ctrl.busy ? C.legalMoves(v) : []; }
// Ходы, совпадающие с уже выбранной частью пути (шашка и прыжки)
function candidates(v) {
  var p = app.path;
  return legalNow(v).filter(function (m) { return p.length && p.every(function (c, k) { return m.path[k] === c; }); });
}
function playerHtml(v, seat, me) {
  var s = v.seats[seat] || { name: '' }, color = C.colorOf(v, seat), cnt = C.count(v, seat), turn = !v.gameOver && v.current === seat;
  var name = me ? (app.ctrl.online ? s.name || tr('you') : tr('you')) : (s.name || tr('foe'));
  return '<div class="player' + (turn ? ' turn' : '') + '">' + pieceSvg(color, false, 'disc') +
    '<span class="nm">' + esc(name) + '</span><span class="cnt">' + esc(tr('count', { m: cnt.men, k: cnt.kings })) + '</span>' +
    (turn ? '<span class="tag">' + esc(tr(me ? 'turn.mine' : 'turn.foe')) + '</span>' : '') + '</div>';
}
function boardHtml(v) {
  var flip = C.colorOf(v, mySeat()) === 'b', legal = legalNow(v), cand = candidates(v), html = '';
  var starts = {}, dests = {}, last = {}, gone = {};
  legal.forEach(function (m) { starts[m.path[0]] = true; });
  cand.forEach(function (m) { if (m.path.length > app.path.length) dests[m.path[app.path.length]] = true; });
  var fresh = v.last && v.turns !== app.shownTurn;
  if (v.last) { last[v.last.path[0]] = true; last[v.last.path[v.last.path.length - 1]] = true; }
  if (fresh && !reduced()) v.last.captured.forEach(function (c) { gone[c] = true; });
  var mustCapture = legal.length && legal[0].captured.length && !app.path.length;
  // посреди серии взятий шашка уже стоит там, куда прыгнула, а сбитые до конца хода полупрозрачны
  var moving = app.path.length > 1 && cand.length ? { from: app.path[0], at: app.path[app.path.length - 1], taken: cand[0].captured.slice(0, app.path.length - 1) } : null;
  var selAt = moving ? moving.at : app.path[0];
  for (var r = 0; r < 8; r++) {
    for (var c = 0; c < 8; c++) {
      var i = flip ? (7 - r) * 8 + (7 - c) : r * 8 + c, dark = C.dark(i), p = v.board[i];
      if (moving && i === moving.from) p = 0;
      if (moving && i === moving.at) p = v.board[moving.from];
      var cls = 'sq' + (dark ? ' d' : '') + (last[i] ? ' last' : '') + (selAt === i ? ' sel' : '') + (dests[i] ? ' dest' : '') + (starts[i] && !app.path.length ? ' can' : '') + (mustCapture && starts[i] ? ' must' : '');
      var inner = '';
      if (p) inner = pieceSvg(p > 0 ? 'w' : 'b', Math.abs(p) === 2, moving && moving.taken.indexOf(i) >= 0 ? 'taken' : '');
      else if (gone[i]) inner = pieceSvg(C.colorOf(v, v.last.seat) === 'w' ? 'b' : 'w', false, 'gone');
      if (c === 0 && dark) inner += '<span class="lbl">' + (8 - Math.floor(i / 8)) + '</span>';
      var label = sqName(i) + (p ? ', ' + tr(p > 0 ? (Math.abs(p) === 2 ? 'cell.wk' : 'cell.w') : (Math.abs(p) === 2 ? 'cell.bk' : 'cell.b')) : '');
      html += dark ? '<button class="' + cls + '" data-sq="' + i + '" aria-label="' + esc(label) + '">' + inner + '</button>' : '<div class="' + cls + '" aria-hidden="true"></div>';
    }
  }
  return '<div class="board"><div class="grid" role="grid" aria-label="' + esc(tr('board.label')) + '">' + html + '</div></div>';
}
function noteText(v) {
  if (v.gameOver) return '';
  if (v.current !== mySeat()) return tr(app.ctrl.online ? 'wait.foe' : 'wait.bot');
  var legal = legalNow(v);
  if (app.path.length > 1) return tr('note.more');
  if (legal.length && legal[0].captured.length) return tr('note.must');
  return app.path.length ? tr('note.pick') : tr('note.your');
}
function gameHtml(v) {
  if (app.path.length && !candidates(v).length) app.path = [];       // пришёл новый вид стола: выбор шашки больше не действует
  var me = mySeat(), foe = 1 - me, legal = legalNow(v), must = legal.length && legal[0].captured.length;
  return '<div class="game"><div class="o-head"><button class="theme-btn" data-act="exit" aria-label="' + esc(tr('exit')) + '">←</button><h2>' + esc(tr('title')) + '</h2>' +
      (app.ctrl.online ? window.CheckersOnline.chatButtonHtml() : '') + '<button class="theme-btn" data-act="rules" aria-label="' + esc(tr('rules.button')) + '">?</button>' + themeButtonHtml('theme-btn') + '</div>' +
    playerHtml(v, foe, false) + boardHtml(v) + playerHtml(v, me, true) +
    '<div class="note' + (must && v.current === me ? ' must' : '') + '" role="status">' + esc(noteText(v)) + '</div>' +
    '<div class="actions">' + (app.path.length ? '<button class="btn" data-act="unselect">' + esc(tr('unselect')) + '</button>' : '') +
      (!v.gameOver ? '<button class="btn" data-act="exit">' + esc(tr('concede')) + '</button>' : '') + '</div></div>';
}

// ===== Окна =====
function rewardHtml(v) {
  var sk = app.ctrl && app.ctrl.stake && app.ctrl.stake();
  if (sk) return '<p class="reward' + (sk > 0 ? '' : ' lost') + '" role="status">' + esc(tr(sk > 0 ? 'o.stake.won' : 'o.stake.lost', { n: fmt(Math.abs(sk)) })) + '</p>';
  if (app.ctrl && app.ctrl.online && v.winner < 0 && Number(app.ctrl.stakeAmount && app.ctrl.stakeAmount())) return '<p class="reward" role="status">' + esc(tr('o.stake.back')) + '</p>';
  var r = app.ctrl && app.ctrl.reward && app.ctrl.reward();
  if (!r) return '';
  var p = { n: fmt(r.granted), unit: window.I18n.plural(r.granted, 'wallet.unit') };
  return '<p class="reward" role="status">' + esc(r.granted <= 0 ? tr('over.cap.reached') : (r.capped ? tr('over.cap.cut', p) : tr('over.reward', p))) + '</p>';
}
function modalHtml() {
  var out = '', v = app.ctrl && app.screen === 'game' ? app.ctrl.view() : null;
  if (v && v.gameOver && !app.animating) {
    var res = v.winner < 0 ? 'draw' : (v.winner === mySeat() ? 'win' : 'lose');
    out += '<div class="scrim"><div class="modal over ' + res + '" role="alertdialog" aria-modal="true"><h2>' + esc(tr('over.' + res)) + '</h2><p>' + esc(tr('over.' + res + '.' + v.reason)) + '</p>' + rewardHtml(v) +
      '<button class="btn primary full" data-act="again">' + esc(tr(app.ctrl.online ? 'o.over.again' : 'over.again')) + '</button><button class="btn full" data-act="menu">' + esc(tr('over.menu')) + '</button></div></div>';
  }
  if (app.ctrl && app.ctrl.online && app.screen === 'game') out += window.CheckersOnline.askHtml();
  if (app.confirm) {
    out += '<div class="scrim"><div class="modal" role="alertdialog" aria-modal="true"><h2>' + esc(tr('confirm.title')) + '</h2><p>' + esc(tr('confirm.text')) + '</p><div class="row"><button class="btn primary" data-act="stay">' + esc(tr('confirm.stay')) + '</button><button class="btn" data-act="concede">' + esc(tr('confirm.ok')) + '</button></div></div></div>';
  }
  if (app.rules) {
    out += '<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(tr('rules.title')) + '"><h2>' + esc(tr('rules.title')) + '</h2><ol>' +
      [1, 2, 3, 4, 5, 6, 7].map(function (k) { return '<li>' + esc(tr('rules.step' + k)) + '</li>'; }).join('') + '</ol><button class="btn primary full" data-act="closeRules">' + esc(tr('rules.close')) + '</button></div></div>';
  }
  return out;
}

// ===== Старт =====
var LOGO = '<div class="logo-ck" aria-hidden="true"><i></i><i class="d">' + pieceSvg('b', false) + '</i><i></i><i class="d">' + pieceSvg('w', true) + '</i><i></i><i class="d"></i></div>';
function segHtml(act, items, sel) {
  return '<div class="modes">' + items.map(function (it) { return '<button class="mode-btn" data-act="' + act + '" data-v="' + it + '" aria-pressed="' + (sel === it) + '">' + esc(tr('start.' + act + '.' + it)) + '</button>'; }).join('') + '</div>';
}
function startHtml() {
  return '<div class="start"><div class="brand-row"><div class="brand">' + LOGO + '<h1>' + esc(tr('title')) + '</h1></div>' +
    '<div class="top-actions">' + catalogLinkHtml() + themeButtonHtml('theme-btn') + '</div></div>' +
    '<div class="muted-text">' + esc(tr('sub')) + '</div>' +
    '<div class="field"><div class="field-title">' + esc(tr('start.mode')) + '</div><div class="modes">' +
      ['bot', 'online'].map(function (m) { return '<button class="mode-btn" data-act="mode" data-v="' + m + '" aria-pressed="' + (app.mode === m) + '">' + esc(tr('start.' + m)) + '<small>' + esc(tr('start.' + m + 'Sub')) + '</small></button>'; }).join('') + '</div></div>' +
    (app.mode === 'bot' ? '<div class="field"><div class="field-title">' + esc(tr('start.level')) + '</div>' + segHtml('level', ['easy', 'expert'], app.level) + '</div>' +
      '<div class="field"><div class="field-title">' + esc(tr('start.color')) + '</div>' + segHtml('color', ['w', 'b'], app.color) + '</div>' : '') +
    '<div class="start-actions"><button class="btn-play" data-act="play">' + esc(tr('start.play')) + '</button><button class="btn-secondary wide" data-act="rules">' + esc(tr('rules.button')) + '</button></div></div>';
}

// ===== Партия против бота: награда за победу, партия идёт в браузере =====
function botController(level, color) {
  var st, listeners = [], seat = 0, timer = null, reward = null, paid = false, ctrl;
  function emit() { listeners.forEach(function (fn) { fn(); }); }
  function settle() {
    if (!st.gameOver || paid) return;
    paid = true;
    // награда только за победу по правилам (соперник без шашек или без ходов), за день не больше предела кошелька
    if (st.winner === seat && (st.reason === 'pieces' || st.reason === 'blocked') && W) { var src = 'checkers-' + level, r = W.reward(src, WIN_REWARD[level], Date.now()); W.countWin(src); reward = { granted: r.granted, capped: r.capped }; }
  }
  function reset() {
    reward = null; paid = false;
    if (W) { W.markPlayed(); W.countPlay('checkers'); }
    st = C.init([{ id: 'me', name: P.getProfile().name }, { id: 'bot', name: tr('bot.' + level) }], { white: color === 'b' ? 1 : 0 });
  }
  function botMove() {
    clearTimeout(timer);
    if (st.gameOver || st.current !== 1) { ctrl.busy = false; return; }
    ctrl.busy = true;
    timer = setTimeout(function () {
      var r = C.reduce(st, window.CheckersBot.choose(C.view(st), 1, level));
      ctrl.busy = false;
      if (r.ok) { st = r.state; settle(); emit(); botMove(); }
    }, 650);
  }
  reset();
  ctrl = {
    local: true, seat: seat, busy: false,
    view: function () { return C.view(st); },
    send: function (a) { var r = C.reduce(st, a); if (!r.ok) return false; st = r.state; settle(); emit(); botMove(); return true; },
    reward: function () { return reward; },
    subscribe: function (fn) { listeners.push(fn); },
    again: function () { clearTimeout(timer); reset(); emit(); botMove(); },
    leave: function () { clearTimeout(timer); }
  };
  botMove();                                       // игрок выбрал чёрных: первым ходит бот
  return ctrl;
}

// ===== Анимация хода: шашка проходит путь по клеткам, сбитые гаснут =====
function animateLast(v) {
  if (!v || !v.last || v.turns === app.shownTurn) return;
  var first = app.shownTurn < 0;
  app.shownTurn = v.turns;
  if (first || reduced() || !Element.prototype.animate) return;
  var path = v.last.path, endEl = appEl.querySelector('[data-sq="' + path[path.length - 1] + '"] .pc');
  if (!endEl) return;
  var rect = function (i) { var el = appEl.querySelector('[data-sq="' + i + '"]'); return el ? el.getBoundingClientRect() : null; };
  var end = rect(path[path.length - 1]);
  if (!end) return;
  var frames = path.map(function (i) { var r = rect(i); return { transform: 'translate(' + (r.left - end.left) + 'px,' + (r.top - end.top) + 'px)' }; });
  endEl.style.zIndex = 3;
  app.animating = true;
  var a = endEl.animate(frames, { duration: STEP_MS * (path.length - 1), easing: 'ease-in-out' });
  a.onfinish = a.oncancel = function () { app.animating = false; if (app.ctrl && app.ctrl.view().gameOver) render(); };
}

// ===== Отрисовка и нажатия =====
function render() {
  var html, v = null;
  if (app.screen === 'game' && app.ctrl) {
    v = app.ctrl.view();
    html = gameHtml(v);
    if (app.ctrl.online) html = window.CheckersOnline.bannerHtml() + html;
  } else if (app.screen === 'online') html = window.CheckersOnline.html();
  else html = startHtml();
  var ai = document.activeElement, keep = ai && ai.tagName === 'INPUT' && ai.id && appEl.contains(ai) ? { id: ai.id, a: ai.selectionStart, b: ai.selectionEnd } : null;
  var focusSq = ai && ai.getAttribute && ai.getAttribute('data-sq');
  var animate = v && v.last && v.turns !== app.shownTurn;
  if (animate && app.shownTurn >= 0 && !reduced()) app.animating = true;      // окно итога ждёт конца анимации
  appEl.innerHTML = '<div class="screen">' + html + '</div>' + modalHtml() + (window.CheckersOnline ? window.CheckersOnline.overlayHtml() : '');
  if (keep) { var ni = document.getElementById(keep.id); if (ni) { try { ni.focus({ preventScroll: true }); if (keep.a !== null) ni.setSelectionRange(keep.a, keep.b); } catch (e) { /* без фокуса */ } } }
  if (focusSq !== null && focusSq !== undefined) { var fs = appEl.querySelector('[data-sq="' + focusSq + '"]'); if (fs) fs.focus({ preventScroll: true }); }
  if (v) { app.animating = false; animateLast(v); }
  if (window.CheckersOnline) window.CheckersOnline.afterRender();
}
function startGame(ctrl) {
  app.ctrl = ctrl; app.screen = 'game'; app.path = []; app.confirm = false; app.shownTurn = -1; app.animating = false;
  ctrl.subscribe(function () { if (app.ctrl === ctrl) { app.path = []; render(); } });
  render();
}
function toMenu() {
  if (app.ctrl) app.ctrl.leave();
  app.ctrl = null; app.screen = 'start'; app.confirm = false; app.path = []; render();
}
function onSquare(i) {
  var v = app.ctrl.view(), legal = legalNow(v);
  if (!legal.length) return;
  var cand = candidates(v), next = cand.filter(function (m) { return m.path[app.path.length] === i; });
  if (app.path.length && next.length) {
    app.path = app.path.concat(i);
    var done = next.filter(function (m) { return m.path.length === app.path.length; })[0];
    if (done) { var path = app.path; app.path = []; app.ctrl.send({ type: 'move', seat: mySeat(), path: path }); }
    render();
    return;
  }
  if (app.path.length > 1) return;                                     // посреди серии взятий можно идти только дальше по ней
  app.path = legal.some(function (m) { return m.path[0] === i; }) && app.path[0] !== i ? [i] : [];
  render();
}
appEl.addEventListener('click', function (e) {
  var sq = e.target.closest('[data-sq]');
  if (sq && app.ctrl && app.screen === 'game') { onSquare(Number(sq.getAttribute('data-sq'))); return; }
  var el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (window.CheckersOnline && window.CheckersOnline.click(el)) return;
  var act = el.getAttribute('data-act'), ctrl = app.ctrl, val = el.getAttribute('data-v');
  switch (act) {
    case 'theme': window.PlatformTheme.toggle(); break;
    case 'rules': app.rules = true; render(); break;
    case 'closeRules': app.rules = false; render(); break;
    case 'play': startGame(botController(app.level, app.color)); break;
    case 'level': app.level = val === 'expert' ? 'expert' : 'easy'; render(); break;
    case 'color': app.color = val === 'b' ? 'b' : 'w'; render(); break;
    case 'mode': app.mode = val === 'online' ? 'online' : 'bot'; render(); break;
    case 'exit': { var v2 = ctrl.view(); if (!v2.gameOver) { app.confirm = true; render(); } else toMenu(); break; }
    case 'stay': app.confirm = false; render(); break;
    case 'concede': app.confirm = false; ctrl.send({ type: 'concede', seat: ctrl.seat }); render(); break;
    case 'unselect': app.path = []; render(); break;
    case 'menu': toMenu(); break;
    case 'again': app.path = []; app.shownTurn = -1; ctrl.again(); render(); break;
  }
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (app.rules) app.rules = false; else if (app.confirm) app.confirm = false; else if (app.path.length) app.path = []; else return;
  render();
});
window.PlatformTheme.onChange(function () { render(); });
render();
