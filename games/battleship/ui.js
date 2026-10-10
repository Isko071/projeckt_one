// ===== Интерфейс игры «Морской бой» =====
// Все надписи берутся из словаря (games/battleship/ru.js). Экраны работают с контроллером стола:
//   ctrl.seat — моё место; ctrl.view() — вид стола для меня (Battleship.view); ctrl.send(action) → true | false; ctrl.subscribe(fn); ctrl.leave().
// Онлайн-контроллер подключится на следующем этапе; для проверки экранов есть локальная партия против случайного бота: адрес страницы с ?dev.
var CATALOG_URL = '../../index.html';
var tr = function (key, params) { return window.I18n.t('games.battleship.' + key, params); };
var B = window.Battleship, P = window.PlatformProfile;
var appEl = document.getElementById('app');
var N = B.CONFIG.size, C = 100, OFF = C;            // клетка 100 единиц, поле смещено на ширину подписей
var DEV = /[?&]dev\b/.test(location.search) || location.hash === '#dev';

var app = { screen: 'start', rules: false, confirm: false, ctrl: null, sel: -1, hover: -1, animTurns: -1, place: null, msg: '' };

function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function cellLabel(idx) { return tr('letters').charAt(Math.floor(idx / N)) + (idx % N + 1); }

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
function catalogLinkHtml() {
  return '<a class="theme-btn" href="' + CATALOG_URL + '" aria-label="' + esc(tr('toCatalog')) + '" title="' + esc(tr('toCatalog')) + '">' + GRID_SVG + '</a>';
}
function headHtml(act, title, label) {
  return '<div class="o-head"><button class="theme-btn" data-act="' + act + '" aria-label="' + esc(label) + '">←</button><h2>' + esc(title) + '</h2>' +
    '<button class="theme-btn" data-act="rules" aria-label="' + esc(tr('rules.button')) + '">?</button>' + themeButtonHtml('theme-btn') + '</div>';
}

// ===== Корабли и поле (рисуются как в тетради: чернильные контуры) =====
// Корабль длиной len клеток, нос справа: корпус с заострённым носом, внутренний контур, штриховка борта, башня со стволом, рубка, купол, труба
function shipG(len) {
  var W = len * C, i, o = '';
  function circ(cx, cy, r, cls) { return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" class="' + (cls || 'deck pf') + '"/>'; }
  function box(x, y, w, h, r) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (r || 6) + '" class="deck pf"/>'; }
  if (len === 1) {
    o += '<path d="M10 14 L56 14 Q94 50 56 86 L10 86 Q-2 50 10 14Z" class="hull"/>';
    o += '<path d="M20 26 L52 26 Q76 50 52 74 L20 74 Q12 50 20 26Z" class="deck"/>';
    o += circ(40, 50, 15) + circ(40, 50, 6) + '<path d="M55 50 L74 50" class="gun"/>';
    return o;
  }
  o += '<path d="M8 10 L' + (W - 38) + ' 10 Q' + (W - 2) + ' 50 ' + (W - 38) + ' 90 L8 90 Q-4 50 8 10Z" class="hull"/>';
  o += '<path d="M20 22 L' + (W - 42) + ' 22 Q' + (W - 16) + ' 50 ' + (W - 42) + ' 78 L20 78 Q10 50 20 22Z" class="deck"/>';
  for (i = 26; i < W - 56; i += 13) o += '<path d="M' + i + ' 80 L' + (i + 9) + ' 70" class="shade"/>';       // штриховка нижнего борта
  var bow = W - 76;                                                                                    // башня со стволом у носа
  o += circ(bow, 50, 15) + circ(bow, 50, 6) + '<path d="M' + (bow + 15) + ' 50 L' + (bow + 40) + ' 50" class="gun"/>';
  o += circ(44, 50, 22) + circ(44, 50, 10);                                                           // купол на корме
  if (len >= 3) {
    var bx = Math.round(W / 2) - 26;
    o += box(bx, 34, 52, 32, 7) + circ(bx + 14, 50, 4.5, 'deck') + circ(bx + 38, 50, 4.5, 'deck');       // рубка с окнами
  }
  if (len === 4) o += circ(Math.round(W * 0.7), 50, 11) + circ(Math.round(W * 0.7), 50, 4, 'deck');     // труба
  return o;
}
function shipSvg(sh, cls, key) {
  var px = OFF + sh.x * C, py = OFF + sh.y * C;
  var t = sh.dir === 'v' ? 'translate(' + (px + C) + ',' + py + ') rotate(90)' : 'translate(' + px + ',' + py + ')';
  return '<g class="ship ' + (cls || '') + '" transform="' + t + '" filter="url(#wob-' + key + ')">' + shipG(sh.len) + '</g>';
}
function miniShip(len) { return '<svg viewBox="0 0 ' + (len * C) + ' ' + C + '" aria-hidden="true" class="board-mini"><g class="ship">' + shipG(len) + '</g></svg>'; }
// Потопленные корабли соперника восстанавливаются по отметкам «потоплен» (3): связные клетки в линию
function sunkShips(marks) {
  var seen = {}, out = [];
  for (var i = 0; i < marks.length; i++) {
    if (marks[i] !== 3 || seen[i]) continue;
    var cells = [], stack = [i];
    seen[i] = true;
    while (stack.length) {
      var c = stack.pop(), x = c % N, y = Math.floor(c / N);
      cells.push(c);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = x + d[0], ny = y + d[1], ni = ny * N + nx;
        if (nx >= 0 && ny >= 0 && nx < N && ny < N && marks[ni] === 3 && !seen[ni]) { seen[ni] = true; stack.push(ni); }
      });
    }
    cells.sort(function (a, b) { return a - b; });
    out.push({ x: cells[0] % N, y: Math.floor(cells[0] / N), len: cells.length, dir: cells.length > 1 && cells[1] - cells[0] === 1 ? 'h' : 'v' });
  }
  return out;
}
// o: { key, label, marks, ships (свои корабли для показа), sunkShips, interactive, sel, ghost: { ship, ok }, popIdx, small }
function boardSvg(o) {
  var W = (N + 1) * C, s = '<svg class="board' + (o.small ? ' small' : '') + (o.interactive ? '' : ' locked') + '" viewBox="0 0 ' + W + ' ' + W + '" role="img" aria-label="' + esc(o.label) + '">', i;
  s += '<defs><filter id="wob-' + o.key + '" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="5"/></filter>' +
    '<pattern id="hatch-' + o.key + '" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="16" class="hatch-line"/></pattern>' +
    '<pattern id="hatchr-' + o.key + '" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="14" class="hatch-red"/></pattern></defs>';
  s += '<rect class="paper" x="0" y="0" width="' + W + '" height="' + W + '"/>';
  for (i = 0; i <= N + 1; i++) {
    s += '<line class="gridline" x1="' + (i * C) + '" y1="0" x2="' + (i * C) + '" y2="' + W + '"/>';
    s += '<line class="gridline" x1="0" y1="' + (i * C) + '" x2="' + W + '" y2="' + (i * C) + '"/>';
  }
  s += '<rect class="frame" x="' + OFF + '" y="' + OFF + '" width="' + (N * C) + '" height="' + (N * C) + '" filter="url(#wob-' + o.key + ')"/>';
  for (i = 0; i < N; i++) {
    s += '<text x="' + (OFF + i * C + C / 2) + '" y="' + (C / 2) + '">' + (i + 1) + '</text>';
    s += '<text x="' + (C / 2) + '" y="' + (OFF + i * C + C / 2) + '">' + esc(tr('letters').charAt(i)) + '</text>';
  }
  if (o.sel >= 0) {
    var sx = OFF + (o.sel % N) * C + C / 2, sy = OFF + Math.floor(o.sel / N) * C + C / 2;
    s += '<rect x="' + (sx - C / 2 + 4) + '" y="' + (sy - C / 2 + 4) + '" width="' + (C - 8) + '" height="' + (C - 8) + '" fill="url(#hatchr-' + o.key + ')"/>' +
      '<g class="aim"><circle cx="' + sx + '" cy="' + sy + '" r="70"/><path d="M' + sx + ' ' + (sy - 110) + 'V' + (sy - 42) + 'M' + sx + ' ' + (sy + 42) + 'V' + (sy + 110) + 'M' + (sx - 110) + ' ' + sy + 'H' + (sx - 42) + 'M' + (sx + 42) + ' ' + sy + 'H' + (sx + 110) + '"/></g>';
  }
  (o.ships || []).forEach(function (sh) {
    if (sh.cells) s += shipSvg({ x: sh.cells[0] % N, y: Math.floor(sh.cells[0] / N), len: sh.len, dir: sh.cells.length > 1 && sh.cells[1] - sh.cells[0] === 1 ? 'h' : 'v' }, sh.hit.every(Boolean) ? 'sunk' : '', o.key);
    else s += shipSvg(sh, '', o.key);
  });
  (o.sunkShips || []).forEach(function (sh) { s += shipSvg(sh, 'sunk', o.key); });
  if (o.ghost) {
    B.cellsOf(o.ghost.ship, N).forEach(function (c) { s += '<rect class="cellfx ' + (o.ghost.ok ? 'ok' : 'no') + '" x="' + (OFF + (c % N) * C) + '" y="' + (OFF + Math.floor(c / N) * C) + '" width="' + C + '" height="' + C + '"/>'; });
    s += shipSvg(o.ghost.ship, 'ghost' + (o.ghost.ok ? '' : ' bad'), o.key);
  }
  (o.marks || []).forEach(function (m, idx) {
    if (!m) return;
    var cx = OFF + (idx % N) * C + C / 2, cy = OFF + Math.floor(idx / N) * C + C / 2, pop = idx === o.popIdx ? ' pop' : '';
    if (m === 1) s += '<rect class="m-miss' + pop + '" x="' + (cx - C / 2 + 3) + '" y="' + (cy - C / 2 + 3) + '" width="' + (C - 6) + '" height="' + (C - 6) + '" fill="url(#hatch-' + o.key + ')"/>';
    else s += '<path class="m-hit' + pop + '" d="M' + (cx - 24) + ' ' + (cy - 24) + 'L' + (cx + 24) + ' ' + (cy + 24) + 'M' + (cx + 24) + ' ' + (cy - 24) + 'L' + (cx - 24) + ' ' + (cy + 24) + '"/>';
  });
  if (o.interactive) {
    for (i = 0; i < N * N; i++) s += '<rect class="hit-target" data-cell="' + i + '" x="' + (OFF + (i % N) * C) + '" y="' + (OFF + Math.floor(i / N) * C) + '" width="' + C + '" height="' + C + '"/>';
  }
  return s + '</svg>';
}

// Значки игроков над полями: вы (зелёный), соперник (серый), бот (монитор AI)
function whoIcon(kind) {
  if (kind === 'ai') return '<svg class="who ai" viewBox="0 0 40 34" aria-hidden="true"><rect x="3" y="2" width="34" height="23" rx="3"/><path d="M14 31h12M20 25v6"/><text x="20" y="18" text-anchor="middle">AI</text></svg>';
  return '<svg class="who ' + kind + '" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="12" r="8"/><path d="M5 38c0-10 6-16 15-16s15 6 15 16z"/></svg>';
}

// ===== Расстановка =====
function newPlace() { return { ships: [], pick: 4, dir: 'h', msg: '' }; }
function placeShipAt(idx) {
  var x = idx % N, y = Math.floor(idx / N), P2 = app.place, len = P2.pick, dir = P2.dir;
  if (dir === 'h' && x + len > N) x = N - len;
  if (dir === 'v' && y + len > N) y = N - len;
  return { x: x, y: y, len: len, dir: dir };
}
function nextPick(len) {
  var rem = B.remaining(app.place.ships);
  if (rem[len] > 0) return len;
  var order = [4, 3, 2, 1];
  for (var i = 0; i < order.length; i++) if (rem[order[i]] > 0) return order[i];
  return null;
}
function onPlaceCell(idx) {
  var P2 = app.place, k = -1;
  for (var i = 0; i < P2.ships.length; i++) if (B.cellsOf(P2.ships[i], N).indexOf(idx) >= 0) { k = i; break; }
  if (k >= 0) { var sh = P2.ships.splice(k, 1)[0]; P2.pick = sh.len; P2.dir = sh.dir; P2.msg = ''; return render(); }
  if (!P2.pick) return;
  var ship = placeShipAt(idx), r = B.canPlace(P2.ships, ship);
  if (!r.ok) { P2.msg = 'place.bad'; return render(); }
  P2.ships.push(ship); P2.msg = ''; P2.pick = nextPick(ship.len);
  render();
}
function placeHtml(v) {
  var P2 = app.place, rem = B.remaining(P2.ships), left = P2.ships.length ? B.CONFIG.fleet.length - P2.ships.length : B.CONFIG.fleet.length;
  var ghost = null;
  if (app.hover >= 0 && P2.pick && !P2.ships.some(function (sh) { return B.cellsOf(sh, N).indexOf(app.hover) >= 0; })) {
    var gs = placeShipAt(app.hover);
    ghost = { ship: gs, ok: B.canPlace(P2.ships, gs).ok };
  }
  var tray = [4, 3, 2, 1].map(function (len) {
    return '<button class="tray-ship" data-act="pick" data-len="' + len + '" aria-pressed="' + (P2.pick === len) + '" aria-label="' + esc(tr('ship.aria', { len: len, n: rem[len] })) + '"' + (rem[len] > 0 ? '' : ' disabled') + '>' + miniShip(len) + '<span>×' + rem[len] + '</span></button>';
  }).join('');
  return '<div class="page">' + headHtml('exit', tr('place.title'), tr('exit.aria')) +
    '<div class="sheet">' + boardSvg({ key: 'p', label: tr('board.mine'), marks: [], ships: P2.ships, interactive: true, ghost: ghost }) + '</div>' +
    '<div class="hint' + (P2.msg ? ' bad' : '') + '" role="status">' + esc(P2.msg ? tr(P2.msg) : (left > 0 ? tr('place.left', { n: left }) : tr('place.hint'))) + '</div>' +
    '<div class="tray">' + tray + '</div>' +
    '<div class="row"><button class="btn" data-act="rotate">' + esc(tr('place.rotate')) + '</button><button class="btn" data-act="random">' + esc(tr('place.random')) + '</button><button class="btn" data-act="clear">' + esc(tr('place.clear')) + '</button></div>' +
    '<button class="btn primary full" data-act="ready"' + (left === 0 ? '' : ' disabled') + '>' + esc(tr('place.ready')) + '</button></div>';
}
function waitHtml(v) {
  var me = app.ctrl.seat;
  return '<div class="page">' + headHtml('exit', tr('place.title'), tr('exit.aria')) +
    '<div class="sheet">' + boardSvg({ key: 'w', label: tr('board.mine'), marks: [], ships: v.seats[me].ships }) + '</div>' +
    '<div class="hint" role="status">' + esc(tr('place.waiting')) + '</div>' +
    '<button class="btn full" data-act="unready">' + esc(tr('place.undo')) + '</button></div>';
}

// ===== Бой =====
function lastShotText(v) {
  if (!v.last) return '';
  var mine = v.last.seat === app.ctrl.seat;
  return tr(mine ? 'last.you' : 'last.foe', { cell: cellLabel(v.last.y * N + v.last.x), res: tr('res.' + v.last.result) });
}
function battleHtml(v) {
  var me = app.ctrl.seat, foe = 1 - me, mine = v.seats[me], other = v.seats[foe], myTurn = v.current === me && !v.gameOver;
  var pop = app.animTurns !== v.turns && v.last ? v.last.y * N + v.last.x : -1;
  var foeBoard = boardSvg({ key: 'f', label: tr('board.foe'), marks: other.marks, sunkShips: other.ships.length ? [] : sunkShips(other.marks), ships: other.ships.length ? other.ships : [], interactive: myTurn, sel: myTurn ? app.sel : -1, popIdx: v.last && v.last.seat === me ? pop : -1 });
  var myBoard = boardSvg({ key: 'm', label: tr('board.mine'), marks: mine.marks, ships: mine.ships, small: true, popIdx: v.last && v.last.seat === foe ? pop : -1 });
  var leftRow = other.left ? Object.keys(other.left).sort(function (a, b) { return b - a; }).map(function (len) {
    return '<span class="lw">' + miniShip(Number(len)) + '×' + other.left[len] + '</span>';
  }).join('') : '';
  var fire = myTurn
    ? '<button class="btn primary full" data-act="fire"' + (app.sel >= 0 ? '' : ' disabled') + '>' + esc(app.sel >= 0 ? tr('fire') + ' ' + cellLabel(app.sel) : tr('fire.pick')) + '</button>'
    : '';
  var foeIcon = app.ctrl.local ? 'ai' : 'foe';
  return '<div class="page wide">' + headHtml('exit', tr('battle.title'), tr('exit.aria')) +
    '<div class="status"><span class="turn' + (myTurn ? ' mine' : '') + '" role="status">' + esc(tr(myTurn ? 'turn.you' : 'turn.foe')) + '</span><span class="lastshot" role="status">' + esc(lastShotText(v)) + '</span></div>' +
    '<div class="boards"><div class="sheet foe"><div class="cap">' + whoIcon(foeIcon) + '<span>' + esc(tr('board.foe')) + '</span></div>' + foeBoard + '</div>' +
    '<div class="sheet mine"><div class="cap">' + whoIcon('me') + '<span>' + esc(tr('board.mine')) + '</span></div>' + myBoard + '</div></div>' +
    (leftRow ? '<div class="leftrow"><span>' + esc(tr('left.foe')) + '</span>' + leftRow + '</div>' : '') + fire + '</div>';
}

// ===== Окна =====
function modalHtml() {
  var out = '';
  var v = app.ctrl ? app.ctrl.view() : null;
  if (v && v.gameOver && app.screen === 'game') {
    var win = v.winner === app.ctrl.seat;
    out += '<div class="scrim"><div class="modal over ' + (win ? 'win' : 'lose') + '" role="alertdialog" aria-modal="true"><h2>' + esc(tr(win ? 'over.win' : 'over.lose')) + '</h2><p>' + esc(tr((win ? 'over.win.' : 'over.lose.') + v.reason)) + '</p>' +
      '<button class="btn primary full" data-act="menu">' + esc(tr('over.menu')) + '</button>' + (app.ctrl.local ? '<button class="btn full" data-act="again">' + esc(tr('over.again')) + '</button>' : '') + '</div></div>';
  }
  if (app.confirm) {
    out += '<div class="scrim"><div class="modal" role="alertdialog" aria-modal="true"><h2>' + esc(tr('confirm.title')) + '</h2><p>' + esc(tr('confirm.text')) + '</p><div class="row"><button class="btn primary" data-act="stay">' + esc(tr('confirm.stay')) + '</button><button class="btn" data-act="concede">' + esc(tr('confirm.ok')) + '</button></div></div></div>';
  }
  if (app.rules) {
    out += '<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(tr('rules.title')) + '"><h2>' + esc(tr('rules.title')) + '</h2><ol>' +
      [1, 2, 3, 4, 5].map(function (k) { return '<li>' + esc(tr('rules.step' + k)) + '</li>'; }).join('') + '</ol><button class="btn primary full" data-act="closeRules">' + esc(tr('rules.close')) + '</button></div></div>';
  }
  return out;
}

// ===== Старт =====
var LOGO = '<svg viewBox="0 0 140 90" width="96" height="62" aria-hidden="true"><rect x="2" y="2" width="136" height="86" rx="8" class="logo-paper"/>' +
  '<path d="M2 30H138M2 58H138M36 2V88M72 2V88M106 2V88" class="logo-grid"/><g transform="translate(10,30) scale(.38)">' + shipG(3) + '</g><circle cx="104" cy="66" r="5" class="logo-dot"/><path d="M112 16l16 16M128 16l-16 16" class="m-hit logo-hit"/></svg>';
function startHtml() {
  return '<div class="start"><div class="brand-row"><div class="brand"><div class="logo-ship">' + LOGO + '</div><h1>' + esc(tr('title')) + '</h1></div>' +
    '<div class="top-actions">' + catalogLinkHtml() + themeButtonHtml('theme-btn') + '</div></div>' +
    '<div class="muted-text">' + esc(tr('sub')) + '</div>' +
    '<div class="field"><div class="field-title">' + esc(tr('start.mode')) + '</div><div class="modes"><button class="mode-btn" aria-pressed="true">' + esc(tr('start.online')) + '<small>' + esc(tr('start.onlineSub')) + '</small></button></div></div>' +
    (app.msg ? '<div class="muted-text" role="status">' + esc(tr(app.msg)) + '</div>' : '') +
    '<div class="start-actions"><button class="btn-play" data-act="play">' + esc(tr('start.play')) + '</button><button class="btn-secondary wide" data-act="rules">' + esc(tr('rules.button')) + '</button></div></div>';
}

// ===== Локальная партия против случайного бота (для проверки экранов: ?dev) =====
function devController() {
  var st, listeners = [], seat = 0, timer = null;
  function emit() { listeners.forEach(function (fn) { fn(); }); }
  function reset() {
    st = B.init([{ id: 'me', name: P.getProfile().name }, { id: 'bot', name: tr('foe') }], {});
    st = B.reduce(st, { type: 'place', seat: 1, ships: B.randomLayout() }).state;
  }
  function botMove() {
    clearTimeout(timer);
    if (st.gameOver || st.current !== 1) return;
    timer = setTimeout(function () {
      var marks = st.seats[0].marks, hits = [], free = [];
      marks.forEach(function (m, i) { if (m === 0) free.push(i); if (m === 2) hits.push(i); });
      var near = [];
      hits.forEach(function (h) { [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var x = h % N + d[0], y = Math.floor(h / N) + d[1]; if (x >= 0 && y >= 0 && x < N && y < N && marks[y * N + x] === 0) near.push(y * N + x); }); });
      var pool = near.length ? near : free, pick = pool[Math.floor(Math.random() * pool.length)];
      var r = B.reduce(st, { type: 'shoot', seat: 1, x: pick % N, y: Math.floor(pick / N) });
      if (r.ok) { st = r.state; emit(); botMove(); }
    }, 900);
  }
  reset();
  return {
    local: true, seat: seat,
    view: function () { return B.view(st, seat); },
    send: function (a) { var r = B.reduce(st, a); if (!r.ok) return false; st = r.state; emit(); botMove(); return true; },
    subscribe: function (fn) { listeners.push(fn); },
    restart: function () { clearTimeout(timer); reset(); emit(); },
    leave: function () { clearTimeout(timer); }
  };
}

// ===== Отрисовка и нажатия =====
function render() {
  var html;
  if (app.screen === 'game' && app.ctrl) {
    var v = app.ctrl.view();
    html = v.phase === 'placing' ? (v.seats[app.ctrl.seat].ready ? waitHtml(v) : placeHtml(v)) : battleHtml(v);
    if (v.turns !== undefined) app.animTurns = v.turns;
  } else html = startHtml();
  appEl.innerHTML = '<div class="screen">' + html + '</div>' + modalHtml();
}
function startGame(ctrl) {
  app.ctrl = ctrl; app.screen = 'game'; app.place = newPlace(); app.sel = -1; app.hover = -1; app.confirm = false; app.animTurns = -1;
  ctrl.subscribe(function () { if (app.ctrl === ctrl) render(); });
  render();
}
function toMenu() {
  if (app.ctrl) app.ctrl.leave();
  app.ctrl = null; app.screen = 'start'; app.confirm = false; render();
}
appEl.addEventListener('click', function (e) {
  var cell = e.target.closest('[data-cell]');
  if (cell && app.ctrl) {
    var idx = Number(cell.getAttribute('data-cell')), v = app.ctrl.view();
    if (v.phase === 'placing') onPlaceCell(idx);
    else if (v.current === app.ctrl.seat && !v.gameOver && v.seats[1 - app.ctrl.seat].marks[idx] === 0) { app.sel = idx; render(); }
    return;
  }
  var el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  var act = el.getAttribute('data-act'), ctrl = app.ctrl;
  switch (act) {
    case 'theme': window.PlatformTheme.toggle(); break;
    case 'rules': app.rules = true; render(); break;
    case 'closeRules': app.rules = false; render(); break;
    case 'play': if (DEV) startGame(devController()); else { app.msg = 'start.soon'; render(); } break;
    case 'exit': { var v2 = ctrl.view(); if (v2.phase === 'playing' && !v2.gameOver) { app.confirm = true; render(); } else toMenu(); break; }
    case 'stay': app.confirm = false; render(); break;
    case 'concede': app.confirm = false; ctrl.send({ type: 'concede', seat: ctrl.seat }); render(); break;
    case 'menu': toMenu(); break;
    case 'again': ctrl.restart(); app.place = newPlace(); app.sel = -1; app.hover = -1; app.animTurns = -1; render(); break;
    case 'pick': app.place.pick = Number(el.getAttribute('data-len')); app.place.msg = ''; render(); break;
    case 'rotate': app.place.dir = app.place.dir === 'h' ? 'v' : 'h'; render(); break;
    case 'random': app.place.ships = B.randomLayout(); app.place.pick = null; app.place.msg = ''; render(); break;
    case 'clear': app.place = newPlace(); render(); break;
    case 'ready': ctrl.send({ type: 'place', seat: ctrl.seat, ships: app.place.ships }); break;
    case 'unready': ctrl.send({ type: 'unplace', seat: ctrl.seat }); break;
    case 'fire': if (app.sel >= 0) { var i2 = app.sel; app.sel = -1; ctrl.send({ type: 'shoot', seat: ctrl.seat, x: i2 % N, y: Math.floor(i2 / N) }); } break;
  }
});
// Подсказка-тень при наведении мыши (на телефоне её нет: корабль ставится нажатием)
appEl.addEventListener('mouseover', function (e) {
  var cell = e.target.closest && e.target.closest('[data-cell]');
  if (!cell || !app.ctrl || app.screen !== 'game' || app.ctrl.view().phase !== 'placing') return;
  var idx = Number(cell.getAttribute('data-cell'));
  if (app.hover === idx) return;
  app.hover = idx; render();
});
appEl.addEventListener('mouseleave', function () { if (app.hover >= 0) { app.hover = -1; if (app.screen === 'game') render(); } });
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { if (app.rules) app.rules = false; else if (app.confirm) app.confirm = false; else return; render(); }
  if ((e.key === 'r' || e.key === 'R') && app.screen === 'game' && app.place && app.ctrl && app.ctrl.view().phase === 'placing') { app.place.dir = app.place.dir === 'h' ? 'v' : 'h'; render(); }
});
window.PlatformTheme.onChange(function () { render(); });
render();
