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

var app = { screen: 'start', rules: false, confirm: false, ctrl: null, sel: -1, hover: -1, animTurns: -1, weapon: 'shoot', arsenalOpen: false, place: null };

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
    (app.ctrl && app.ctrl.online ? window.BattleshipOnline.chatButtonHtml() : '') + '<button class="theme-btn" data-act="rules" aria-label="' + esc(tr('rules.button')) + '">?</button>' + themeButtonHtml('theme-btn') + '</div>';
}

// ===== Корабли и поле (рисуются как в тетради: чернильные контуры) =====
// Корабль длиной len клеток, нос справа: корпус с заострённым носом, внутренний контур, штриховка борта, башня со стволом, рубка, купол, труба
function shipG(len) {
  var W = len * C, i, o = '', t = W - 52, bowX = W - 4;
  function rect(x, y, w, h, cls) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" class="' + (cls || 'deck pf') + '"/>'; }
  function turret(x) { return '<path d="M' + (x + 12) + ' 43 H' + (x + 40) + ' M' + (x + 12) + ' 57 H' + (x + 40) + '" class="gun"/>' + rect(x - 12, 36, 26, 28, 'deck pf'); }
  o += '<path d="M8 20 L' + t + ' 12 Q' + (W - 18) + ' 28 ' + bowX + ' 50 Q' + (W - 18) + ' 72 ' + t + ' 88 L8 80 L3 66 L3 34Z" class="hull"/>';
  o += '<path d="M16 30 L' + (t - 2) + ' 24 Q' + (W - 30) + ' 38 ' + (W - 24) + ' 50 Q' + (W - 30) + ' 62 ' + (t - 2) + ' 76 L16 70Z" class="deck thin"/>';
  for (i = 24; i < W - 90; i += 11) o += '<path d="M' + i + ' 82 L' + (i + 7) + ' 76" class="shade"/>';
  if (len === 1) return o + turret(34);
  o += turret(W - 80);
  if (len >= 2) o += turret(30);
  if (len >= 3) o += rect(Math.round(W / 2) - 30, 38, 60, 24) + '<path d="M' + (Math.round(W / 2) - 20) + ' 50 H' + (Math.round(W / 2) + 20) + '" class="deck thin"/>';
  if (len === 4) o += '<ellipse cx="' + Math.round(W * 0.66) + '" cy="50" rx="16" ry="9" class="deck pf"/>';
  return o;
}
function shipSvg(sh, cls, key, style) {
  var px = OFF + sh.x * C, py = OFF + sh.y * C;
  var t = sh.dir === 'v' ? 'translate(' + (px + C) + ',' + py + ') rotate(90)' : 'translate(' + px + ',' + py + ')';
  return '<g class="ship ' + (cls || '') + '" transform="' + t + '" filter="url(#wob-' + key + ')"' + (style || '') + '>' + shipG(sh.len) + '</g>';
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
// ===== Анимации (SMIL внутри SVG поля; время в секундах от появления поля) =====
var FALL = 0.05;                                                                  // выстрел сразу взрывается на клетке, без полёта ядра
function anim(attr, from, to, begin, dur, extra) {
  return '<animate attributeName="' + attr + '" from="' + from + '" to="' + to + '" begin="' + begin.toFixed(2) + 's" dur="' + dur + 's" fill="freeze" ' + (extra || '') + '/>';
}
function appear(t) { return '<set attributeName="opacity" to="1" begin="' + t.toFixed(2) + 's"/>'; }
function cellXY(idx) { return { cx: OFF + (idx % N) * C + C / 2, cy: OFF + Math.floor(idx / N) * C + C / 2 }; }
// Удар в момент t: промах — всплеск и пузырьки, попадание — взрыв (потопление крупнее), «пусто» — лёгкое облачко
function impactFx(cx, cy, kind, t) {
  var s = '', i;
  if (kind === 'none') {
    return '<circle class="smoke" cx="' + cx + '" cy="' + cy + '" r="10" opacity="0">' + anim('r', 10, 24, t, 0.5) + '<animate attributeName="opacity" values="0;.5;0" keyTimes="0;.3;1" begin="' + t.toFixed(2) + 's" dur="0.5s" fill="freeze"/></circle>';
  }
  if (kind === 'miss') {
    for (i = 0; i < 2; i++) {
      s += '<circle class="ripple" cx="' + cx + '" cy="' + cy + '" r="6" opacity="0">' + anim('r', 6, 62 + i * 14, t + i * 0.18, 0.75) + anim('opacity', 0.95, 0, t + i * 0.18, 0.75) + anim('stroke-width', 8, 1.5, t + i * 0.18, 0.75) + '</circle>';
    }
    [[-26, -8], [-10, -22], [10, -22], [26, -8], [0, -30]].forEach(function (d) {
      s += '<circle class="drop" cx="' + (cx + d[0] * 0.3) + '" cy="' + cy + '" r="6" opacity="0">' +
        '<animate attributeName="cy" values="' + cy + ';' + (cy + d[1] * 2.2) + ';' + (cy + 6) + '" keyTimes="0;.45;1" begin="' + t.toFixed(2) + 's" dur="0.6s" fill="freeze"/>' +
        '<animate attributeName="cx" from="' + (cx + d[0] * 0.3) + '" to="' + (cx + d[0] * 1.5) + '" begin="' + t.toFixed(2) + 's" dur="0.6s" fill="freeze"/>' +
        '<animate attributeName="opacity" values="0;1;0" keyTimes="0;.2;1" begin="' + t.toFixed(2) + 's" dur="0.6s" fill="freeze"/></circle>';
    });
    [[-22, 14, 0], [18, 10, 0.18], [-6, 26, 0.34], [26, 24, 0.5]].forEach(function (b) {
      var tb = t + 0.45 + b[2];
      s += '<circle class="bubble" cx="' + (cx + b[0]) + '" cy="' + (cy + b[1]) + '" r="7" opacity="0">' + anim('cy', cy + b[1], cy + b[1] - 38, tb, 0.7) + anim('r', 4, 10, tb, 0.7) +
        '<animate attributeName="opacity" values="0;.9;0" keyTimes="0;.3;1" begin="' + tb.toFixed(2) + 's" dur="0.7s" fill="freeze"/></circle>';
    });
    return s;
  }
  var big = kind === 'sunk';
  s += '<circle class="boom-fire" cx="' + cx + '" cy="' + cy + '" r="4" opacity="0">' + anim('r', 4, big ? 90 : 62, t, 0.55) + anim('opacity', 1, 0, t, 0.55) + '</circle>';
  s += '<circle class="boom-core" cx="' + cx + '" cy="' + cy + '" r="3" opacity="0">' + anim('r', 3, big ? 56 : 38, t, 0.4) + anim('opacity', 1, 0, t, 0.4) + '</circle>';
  for (i = 0; i < 10; i++) {
    var a = i * Math.PI / 5 + 0.3, dx = Math.cos(a), dy = Math.sin(a);
    s += '<line class="spark" x1="' + (cx + dx * 14) + '" y1="' + (cy + dy * 14) + '" x2="' + (cx + dx * 14) + '" y2="' + (cy + dy * 14) + '" opacity="0">' +
      anim('x2', cx + dx * 14, cx + dx * (big ? 92 : 70), t, 0.45) + anim('y2', cy + dy * 14, cy + dy * (big ? 92 : 70), t, 0.45) + anim('opacity', 1, 0, t + 0.15, 0.3) + '</line>';
  }
  [[-14, 0], [14, 0.12], [0, 0.24]].forEach(function (sm) {
    var ts = t + 0.2 + sm[1];
    s += '<circle class="smoke" cx="' + (cx + sm[0]) + '" cy="' + cy + '" r="12" opacity="0">' + anim('cy', cy, cy - 54, ts, 0.9) + anim('r', 12, 26, ts, 0.9) +
      '<animate attributeName="opacity" values="0;.6;0" keyTimes="0;.25;1" begin="' + ts.toFixed(2) + 's" dur="0.9s" fill="freeze"/></circle>';
  });
  return s;
}
// Самолёт пролетает слева направо на высоте cy; возвращает время, когда он над столбцом cx
function planeFx(cx, cy) {
  var W = (N + 1) * C, from = -300, to = W + 300, dur = 1.5, tAt = Math.max(0.1, (cx - from) / (to - from) * dur);
  var body = '<g transform="scale(1.7)"><path d="M-2 0 Q2 -6 18 -7 L118 -6 L142 0 L118 6 L18 7 Q2 6 -2 0Z M100 -7 L72 -7 L42 -76 L58 -76Z M100 7 L72 7 L42 76 L58 76Z M10 -6 L-6 -28 L6 -28 L26 -6Z M10 6 L-6 28 L6 28 L26 6Z" class="plane-body"/>' +
    '<path d="M66 -42 H88 M66 42 H88" class="deck"/><path d="M108 -3 L122 0 L108 3Z" class="deck pf"/></g>';
  function path(dx, dy, cls) { return '<g class="' + cls + '" opacity="0" transform="translate(' + from + ',' + cy + ')">' + appear(0) + '<animateTransform attributeName="transform" type="translate" from="' + (from + dx) + ' ' + (cy + dy) + '" to="' + (to + dx) + ' ' + (cy + dy) + '" begin="0s" dur="' + dur + 's" fill="freeze"/>' + body + '</g>'; }
  return { tAt: tAt, svg: path(48, 60, 'plane shadow') + path(0, 0, 'plane') };
}
// Подлодка в точке удара: капсула с рубкой и перископом, появляется и уходит под воду
function subBodyFx(cx, cy) {
  var d = 'M16 35 Q40 6 90 6 L220 6 Q268 8 290 35 Q268 62 220 64 L90 64 Q40 64 16 35Z';
  var x0 = cx - 150, x1 = (N + 1) * C - 120, run = Math.max(300, x1 - x0);
  return '<g class="sub" opacity="0" transform="translate(' + x0 + ',' + (cy - 35) + ')"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.82;1" begin="0s" dur="2.6s" fill="freeze"/>' +
    '<animateTransform attributeName="transform" type="translate" from="' + x0 + ' ' + (cy - 35) + '" to="' + (x0 + run) + ' ' + (cy - 35) + '" begin="0.9s" dur="1.7s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".5 0 .9 .8"/>' +
    '<path d="' + d + '" class="hull"/><rect x="118" y="22" width="56" height="26" rx="3" class="deck pf"/><path d="M146 22 V10 H162" class="deck"/><path d="M40 35 H110 M182 35 H260" class="deck thin"/><path d="M-10 26 q-14 9 0 18 M-34 22 q-16 13 0 26" class="deck thin"/></g>';
}
// План анимации действия: рисунок и задержки появления итоговых отметок по клеткам
function fxPlan(fx) {
  var svg = '', delays = {};
  if (!fx) return { svg: svg, delays: delays };
  var p = cellXY(fx.idx), i;
  if (fx.kind === 'shoot') {
    svg += impactFx(p.cx, p.cy, fx.result, FALL);
    delays[fx.idx] = FALL + (fx.result === 'miss' ? 0.4 : 0.07);
  } else if (fx.kind === 'bomber') {
    var pl = planeFx(p.cx, p.cy);
    svg += pl.svg;
    fx.cells.forEach(function (d, k) {
      var t = Math.max(0.15, pl.tAt - 0.3 + k * 0.1), q = cellXY(d.idx), tIn = t;
      svg += impactFx(q.cx, q.cy, d.result, tIn);
      if (d.result !== 'none') delays[d.idx] = tIn + (d.result === 'miss' ? 0.4 : 0.07);
    });
  } else if (fx.kind === 'sub') {
    svg += subBodyFx(p.cx, p.cy);
    fx.torpedoes.forEach(function (tp) {
      var steps = tp.path.length, t0 = 0.5, dur = Math.max(0.25, steps * 0.09), end = cellXY(tp.path[steps - 1]);
      svg += '<line class="wake" x1="' + p.cx + '" y1="' + p.cy + '" x2="' + p.cx + '" y2="' + p.cy + '" opacity="0">' + appear(t0) + anim('y2', p.cy, end.cy, t0, dur) + anim('opacity', 0.8, 0, t0 + dur, 0.6) + '</line>';
      svg += '<rect class="torp" x="' + (p.cx - 7) + '" y="' + (p.cy - 20) + '" width="14" height="40" rx="7" opacity="0">' + appear(t0) + anim('y', p.cy - 20, end.cy - 20, t0, dur) + anim('opacity', 1, 0, t0 + dur, 0.01) + '</rect>';
      tp.fresh.forEach(function (ci) { delays[ci] = t0 + dur * (tp.path.indexOf(ci) + 1) / steps + 0.05; });
      if (tp.hit >= 0) { svg += impactFx(end.cx, end.cy, tp.result, t0 + dur); delays[tp.hit] = t0 + dur + 0.07; }
      else svg += impactFx(end.cx, end.cy, 'miss', t0 + dur);
    });
  } else if (fx.kind === 'radar') {
    for (i = 0; i < 3; i++) {
      svg += '<circle class="radar-ring" cx="' + p.cx + '" cy="' + p.cy + '" r="10" opacity="0">' + appear(i * 0.25) + anim('r', 10, 230, i * 0.25, 0.8) + anim('opacity', 0.9, 0, i * 0.25, 0.8) + '</circle>';
    }
    svg += '<line class="radar-arm" x1="' + p.cx + '" y1="' + p.cy + '" x2="' + (p.cx + 170) + '" y2="' + p.cy + '" opacity="0">' + appear(0) + '<animateTransform attributeName="transform" type="rotate" from="0 ' + p.cx + ' ' + p.cy + '" to="360 ' + p.cx + ' ' + p.cy + '" begin="0s" dur="0.9s" fill="freeze"/>' + anim('opacity', 0.9, 0, 0.6, 0.35) + '</line>';
    fx.cells.forEach(function (ci) { delays[ci] = 0.9; });
  }
  return { svg: svg ? '<g class="fx" pointer-events="none">' + svg + '</g>' : '', delays: delays };
}
// Выбранная цель: красные угловые скобки (клетка или область 3×3), для подлодки зелёные клетки под лодкой и линия торпед
function brackets(x, y, w, h) {
  var L = 30, r = '';
  [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(function (c) {
    r += 'M' + (c[0] + c[2] * L) + ' ' + c[1] + 'L' + c[0] + ' ' + c[1] + 'L' + c[0] + ' ' + (c[1] + c[3] * L);
  });
  return '<path class="brk" d="' + r + '"/>';
}
function selSvg(sel, weapon, key) {
  var sx = OFF + (sel % N) * C + C / 2, sy = OFF + Math.floor(sel / N) * C + C / 2, s = '', cx = sel % N, cy = Math.floor(sel / N);
  if (weapon === 'radar' || weapon === 'bomber') {
    var x0 = Math.max(0, cx - 1), x1 = Math.min(N - 1, cx + 1), y0 = Math.max(0, cy - 1), y1 = Math.min(N - 1, cy + 1);
    return '<rect x="' + (OFF + x0 * C + 6) + '" y="' + (OFF + y0 * C + 6) + '" width="' + ((x1 - x0 + 1) * C - 12) + '" height="' + ((y1 - y0 + 1) * C - 12) + '" fill="url(#hatchr-' + key + ')" opacity=".35"/>' +
      brackets(OFF + x0 * C + 4, OFF + y0 * C + 4, (x1 - x0 + 1) * C - 8, (y1 - y0 + 1) * C - 8);
  }
  if (weapon === 'sub') {
    s += '<line class="selline" x1="' + sx + '" y1="' + OFF + '" x2="' + sx + '" y2="' + (OFF + N * C) + '"/>';
    for (var gx = Math.max(0, cx - 1); gx <= Math.min(N - 1, cx + 1); gx++) s += '<rect class="greencell" x="' + (OFF + gx * C + 6) + '" y="' + (OFF + cy * C + 6) + '" width="' + (C - 12) + '" height="' + (C - 12) + '"/>';
    s += '<g class="ship ghost" transform="translate(' + (sx - 150) + ',' + (sy - 35) + ')"><path d="M20 35 Q20 5 70 5 L230 5 Q280 5 280 35 Q280 65 230 65 L70 65 Q20 65 20 35Z" class="hull"/><path d="M118 5 L130 -18 L172 -18 L184 5" class="hull"/><path d="M150 -18 L150 -36 L172 -36" class="deck"/></g>';
    return s;
  }
  return '<rect x="' + (sx - C / 2 + 8) + '" y="' + (sy - C / 2 + 8) + '" width="' + (C - 16) + '" height="' + (C - 16) + '" fill="url(#hatchr-' + key + ')" opacity=".5"/>' + brackets(sx - C / 2 + 4, sy - C / 2 + 4, C - 8, C - 8);
}
// o: { key, label, marks, ships (свои корабли для показа), sunkShips, interactive, sel, weapon, ghost: { ship, ok }, fx, small }
function boardSvg(o) {
  var W = (N + 1) * C, s = '<svg class="board' + (o.small ? ' small' : '') + (o.interactive ? '' : ' locked') + '" viewBox="0 0 ' + W + ' ' + W + '" role="img" aria-label="' + esc(o.label) + '">', i;
  var plan = fxPlan(o.fx), delays = plan.delays;
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
  if (o.sel >= 0) s += selSvg(o.sel, o.weapon || 'shoot', o.key);
  function lateStyle(cells) {
    var d = -1;
    cells.forEach(function (c) { if (delays[c] !== undefined && delays[c] > d) d = delays[c]; });
    return d >= 0 ? ' style="animation-delay:' + (d + 0.1).toFixed(2) + 's"' : '';
  }
  (o.ships || []).forEach(function (sh) {
    if (!sh.cells) { s += shipSvg(sh, '', o.key); return; }
    var sunk = sh.hit.every(Boolean), ls = sunk ? lateStyle(sh.cells) : '';
    s += shipSvg({ x: sh.cells[0] % N, y: Math.floor(sh.cells[0] / N), len: sh.len, dir: sh.cells.length > 1 && sh.cells[1] - sh.cells[0] === 1 ? 'h' : 'v' }, sunk ? 'sunk' + (ls ? ' late' : '') : '', o.key, ls);
  });
  (o.sunkShips || []).forEach(function (sh) {
    var cells = B.cellsOf(sh, N), ls = lateStyle(cells);
    s += shipSvg(sh, 'sunk' + (ls ? ' late' : ''), o.key, ls);
  });
  if (o.ghost) {
    B.cellsOf(o.ghost.ship, N).forEach(function (c) { s += '<rect class="cellfx ' + (o.ghost.ok ? 'ok' : 'no') + '" x="' + (OFF + (c % N) * C) + '" y="' + (OFF + Math.floor(c / N) * C) + '" width="' + C + '" height="' + C + '"/>'; });
    s += shipSvg(o.ghost.ship, 'ghost' + (o.ghost.ok ? '' : ' bad'), o.key);
  }
  (o.marks || []).forEach(function (m, idx) {
    if (!m) return;
    var cx = OFF + (idx % N) * C + C / 2, cy = OFF + Math.floor(idx / N) * C + C / 2, dl = delays[idx], pop = dl !== undefined ? ' pop" style="animation-delay:' + dl.toFixed(2) + 's' : '';
    if (m === 1) s += '<rect class="m-miss' + pop + '" x="' + (cx - C / 2 + 3) + '" y="' + (cy - C / 2 + 3) + '" width="' + (C - 6) + '" height="' + (C - 6) + '" fill="url(#hatch-' + o.key + ')"/>';
    else if (m === 4) s += '<g class="m-blip' + pop + '"><circle cx="' + cx + '" cy="' + cy + '" r="30"/><circle cx="' + cx + '" cy="' + cy + '" r="12" class="dot"/></g>';
    else s += '<path class="m-hit' + pop + '" d="M' + (cx - 24) + ' ' + (cy - 24) + 'L' + (cx + 24) + ' ' + (cy + 24) + 'M' + (cx + 24) + ' ' + (cy - 24) + 'L' + (cx - 24) + ' ' + (cy + 24) + '"/>';
  });
  s += plan.svg;
  if (o.interactive) {
    for (i = 0; i < N * N; i++) s += '<rect class="hit-target" data-cell="' + i + '" x="' + (OFF + (i % N) * C) + '" y="' + (OFF + Math.floor(i / N) * C) + '" width="' + C + '" height="' + C + '"/>';
  }
  return s + '</svg>';
}

// Иконки оружия, нарисованные чернилами: радар, подлодка, бомбардировщик
function weaponIcon(kind) {
  if (kind === 'radar') {
    return '<svg class="wicon" viewBox="0 0 100 100" aria-hidden="true"><rect x="6" y="6" width="88" height="88" rx="12" class="deck pf"/><rect x="14" y="14" width="72" height="72" rx="8" class="deck"/>' +
      '<circle cx="50" cy="50" r="31" class="deck pf"/><circle cx="50" cy="50" r="21" class="deck"/><circle cx="50" cy="50" r="10" class="deck"/><path d="M50 50 L50 19 A31 31 0 0 1 77 34Z" class="wi-green"/>' +
      '<path d="M19 50H81M50 19V81" class="deck thin"/><circle cx="64" cy="38" r="3.5" class="wi-dot"/></svg>';
  }
  if (kind === 'sub') {
    return '<svg class="wicon" viewBox="0 0 160 80" aria-hidden="true"><path d="M0 72 q10 -6 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" class="deck thin"/>' +
      '<path d="M6 46 Q30 30 62 30 L124 30 Q148 32 156 46 Q148 58 124 60 L62 60 Q30 60 6 46Z" class="hull"/><path d="M64 30 L70 14 L100 14 L106 30" class="hull"/><path d="M88 14 V5 H100" class="deck"/>' +
      '<path d="M26 46 H56 M112 46 H140" class="deck thin"/></svg>';
  }
  return '<svg class="wicon" viewBox="0 0 120 100" aria-hidden="true"><g transform="translate(10 50) scale(.72)"><path d="M-2 0 Q2 -6 18 -7 L118 -6 L142 0 L118 6 L18 7 Q2 6 -2 0Z M100 -7 L72 -7 L42 -68 L58 -68Z M100 7 L72 7 L42 68 L58 68Z M10 -6 L-6 -28 L6 -28 L26 -6Z M10 6 L-6 28 L6 28 L26 6Z" class="hull"/><path d="M66 -38 H88 M66 38 H88" class="deck"/></g></svg>';
}
// Вымпел «Арсенал»: щит с красной штриховкой снизу
function pennantSvg() {
  return '<svg class="pennant" viewBox="0 0 150 80" aria-hidden="true"><path d="M5 5 H145 V38 Q145 62 75 76 Q5 62 5 38Z" class="pen-body"/><path d="M26 48 H124 Q112 58 75 68 Q38 58 26 48Z" class="pen-red"/><path d="M34 50 L48 60 M50 50 L64 62 M66 50 L80 64 M82 50 L96 62 M98 50 L110 58" class="pen-hatch"/></svg>';
}

// Значки игроков над полями: вы (зелёный), соперник (серый), бот (монитор AI)
function whoIcon(kind) {
  if (kind === 'ai') return '<svg class="who ai" viewBox="0 0 40 34" aria-hidden="true"><rect x="3" y="2" width="34" height="23" rx="3"/><path d="M14 31h12M20 25v6"/><text x="20" y="18" text-anchor="middle">AI</text></svg>';
  return '<svg class="who ' + kind + '" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="12" r="8"/><path d="M5 38c0-10 6-16 15-16s15 6 15 16z"/></svg>';
}

// ===== Расстановка =====
function newPlace() { return { ships: [], pick: 4, dir: 'h', msg: '', arsenal: { radar: 1, sub: 1, bomber: 2 } }; }
function arsenalTotal(a) { return a.radar + a.sub + a.bomber; }
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
function arsenalHtml() {
  var a = app.place.arsenal, total = arsenalTotal(a), cap = B.CONFIG.arsenal.total;
  return '<div class="arsenal"><div class="cap"><span>' + esc(tr('arsenal.title')) + '</span><span class="cnt' + (total === cap ? ' ok' : '') + '">' + esc(tr('arsenal.count', { n: total, m: cap })) + '</span></div>' +
    B.WEAPONS.map(function (w) {
      var max = B.CONFIG.arsenal.max[w];
      return '<div class="arow"><span class="aicon">' + weaponIcon(w) + '</span><div class="ainfo"><b>' + esc(tr('w.' + w)) + '</b><span>' + esc(tr('w.' + w + '.d')) + '</span></div>' +
        '<div class="step"><button class="stepbtn" data-act="arsenal" data-w="' + w + '" data-d="-1" aria-label="' + esc(tr('arsenal.minus', { w: tr('w.' + w) })) + '"' + (a[w] > 0 ? '' : ' disabled') + '>−</button>' +
        '<span class="num" role="status">' + a[w] + '</span>' +
        '<button class="stepbtn" data-act="arsenal" data-w="' + w + '" data-d="1" aria-label="' + esc(tr('arsenal.plus', { w: tr('w.' + w) })) + '"' + (a[w] < max && total < cap ? '' : ' disabled') + '>+</button></div></div>';
    }).join('') + '</div>';
}
function placeHtml(v) {
  var P2 = app.place, rem = B.remaining(P2.ships), left = P2.ships.length ? B.CONFIG.fleet.length - P2.ships.length : B.CONFIG.fleet.length;
  var ghost = null, total = arsenalTotal(P2.arsenal), cap = B.CONFIG.arsenal.total;
  if (app.hover >= 0 && P2.pick && !P2.ships.some(function (sh) { return B.cellsOf(sh, N).indexOf(app.hover) >= 0; })) {
    var gs = placeShipAt(app.hover);
    ghost = { ship: gs, ok: B.canPlace(P2.ships, gs).ok };
  }
  var tray = [4, 3, 2, 1].map(function (len) {
    return '<button class="tray-ship" data-act="pick" data-len="' + len + '" aria-pressed="' + (P2.pick === len) + '" aria-label="' + esc(tr('ship.aria', { len: len, n: rem[len] })) + '"' + (rem[len] > 0 ? '' : ' disabled') + '>' + miniShip(len) + '<span>×' + rem[len] + '</span></button>';
  }).join('');
  var hint = P2.msg ? tr(P2.msg) : (left > 0 ? tr('place.left', { n: left }) : (total < cap ? tr('arsenal.need', { n: cap - total }) : tr('place.hint')));
  return '<div class="page">' + headHtml('exit', tr('place.title'), tr('exit.aria')) +
    '<div class="sheet">' + boardSvg({ key: 'p', label: tr('board.mine'), marks: [], ships: P2.ships, interactive: true, ghost: ghost }) + '</div>' +
    '<div class="hint' + (P2.msg ? ' bad' : '') + '" role="status">' + esc(hint) + '</div>' +
    '<div class="tray">' + tray + '</div>' +
    '<div class="row"><button class="btn" data-act="rotate">' + esc(tr('place.rotate')) + '</button><button class="btn" data-act="random">' + esc(tr('place.random')) + '</button><button class="btn" data-act="clear">' + esc(tr('place.clear')) + '</button></div>' +
    arsenalHtml() +
    '<button class="btn primary full" data-act="ready"' + (left === 0 && total === cap ? '' : ' disabled') + '>' + esc(tr('place.ready')) + '</button></div>';
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
  var L = v.last;
  if (!L) return '';
  var mine = L.seat === app.ctrl.seat, cell = cellLabel(L.y * N + L.x);
  if (L.kind === 'shoot') return tr(mine ? 'last.you' : 'last.foe', { cell: cell, res: tr('res.' + L.result) });
  var res = L.kind === 'radar' ? tr('res.found', { n: L.found }) : (L.hits > 0 ? tr('res.hits', { n: L.hits }) : tr('res.nohit'));
  return tr(mine ? 'last.w.you' : 'last.w.foe', { weapon: tr('w.' + L.kind), cell: cell, res: res });
}
// Описание последнего действия для анимации на поле защитника defSeat (только когда ход сменился с прошлой отрисовки)
function fxOf(v, defSeat) {
  var L = v.last;
  if (!L || L.seat === defSeat || app.animTurns === v.turns) return null;
  var fx = { kind: L.kind, idx: L.y * N + L.x };
  if (L.kind === 'shoot') fx.result = L.result;
  else if (L.kind === 'radar') fx.cells = L.cells;
  else if (L.kind === 'bomber') fx.cells = L.cells;
  else fx.torpedoes = L.torpedoes;
  return fx;
}
// Лист арсенала: иконки оружия со счётчиками; выбранное отмечено красными скобками, повторное нажатие снимает выбор
function arsenalSheetHtml(v) {
  var arm = v.seats[app.ctrl.seat].arsenal || { radar: 0, sub: 0, bomber: 0 };
  return '<div class="asheet" role="group" aria-label="' + esc(tr('w.title')) + '">' + B.WEAPONS.map(function (w) {
    var on = app.weapon === w;
    return '<button class="aitem' + (on ? ' on' : '') + '" data-act="weapon" data-w="' + w + '" aria-pressed="' + on + '" aria-label="' + esc(tr('w.' + w) + ' ×' + arm[w]) + '"' + (arm[w] > 0 ? '' : ' disabled') + '>' +
      weaponIcon(w) + '<span class="x">×' + arm[w] + '</span><em>' + esc(tr('w.' + w)) + '</em></button>';
  }).join('') + '</div>';
}
var ARROW_SVG = '<svg viewBox="0 0 70 90" aria-hidden="true"><path d="M8 6 L64 45 L8 84Z" class="arrow-body"/><path d="M16 22 L44 42 M16 34 L50 46 M16 46 L48 56 M16 58 L40 64 M16 70 L30 74" class="arrow-hatch"/></svg>';
function nameBadge(kind) {
  if (kind === 'me') { var pr = P.getProfile(); return '<span class="avs" style="background:' + P.avatarColor(pr.avatar) + '">' + esc(P.initial(pr.name)) + '</span>'; }
  return whoIcon(kind);
}
function battleHtml(v) {
  var me = app.ctrl.seat, foe = 1 - me, mine = v.seats[me], other = v.seats[foe], myTurn = v.current === me && !v.gameOver;
  var arm = mine.arsenal || { radar: 0, sub: 0, bomber: 0 };
  if (app.weapon !== 'shoot' && !(arm[app.weapon] > 0)) app.weapon = 'shoot';
  if (!myTurn) app.arsenalOpen = false;
  var foeBoard = boardSvg({ key: 'f', label: tr('board.foe'), marks: other.marks, sunkShips: other.ships.length ? [] : sunkShips(other.marks), ships: other.ships.length ? other.ships : [], interactive: myTurn, sel: myTurn ? app.sel : -1, weapon: app.weapon, fx: fxOf(v, foe) });
  var myBoard = boardSvg({ key: 'm', label: tr('board.mine'), marks: mine.marks, ships: mine.ships, small: true, fx: fxOf(v, me) });
  var leftRow = other.left ? Object.keys(other.left).sort(function (a, b) { return b - a; }).map(function (len) {
    return '<span class="lw">' + miniShip(Number(len)) + '×' + other.left[len] + '</span>';
  }).join('') : '';
  var fire = myTurn
    ? '<button class="btn primary full" data-act="fire"' + (app.sel >= 0 ? '' : ' disabled') + '>' + esc(app.sel >= 0 ? tr('fire.' + app.weapon) + ' ' + cellLabel(app.sel) : tr('fire.pick')) + '</button>'
    : '';
  var foeIcon = app.ctrl.local ? 'ai' : 'foe', myName = P.getProfile().name || tr('you'), foeName = other.name || tr('foe');
  var chip = app.weapon !== 'shoot' ? '<button class="wchip" data-act="weapon" data-w="' + app.weapon + '" aria-label="' + esc(tr('w.cancel', { w: tr('w.' + app.weapon) })) + '">' + weaponIcon(app.weapon) + '<span>' + esc(tr('w.' + app.weapon)) + '</span><b>✕</b></button>' : '';
  return '<div class="page wide">' + headHtml('exit', tr('battle.title'), tr('exit.aria')) + '<div class="redline" aria-hidden="true"></div>' +
    '<div class="topline"><button class="pennantbtn" data-act="arsenalToggle" aria-expanded="' + !!app.arsenalOpen + '"' + (myTurn ? '' : ' disabled') + '>' + pennantSvg() + '<span>' + esc(tr('w.arsenal')) + '</span></button>' + chip +
    '<div class="status"><span class="turn' + (myTurn ? ' mine' : '') + '" role="status">' + esc(tr(myTurn ? 'turn.you' : 'turn.foe')) + '</span><span class="lastshot" role="status">' + esc(lastShotText(v)) + '</span></div>' +
    (app.arsenalOpen && myTurn ? arsenalSheetHtml(v) : '') + '</div>' +
    '<div class="boards"><div class="sheet foe"><div class="cap">' + nameBadge(foeIcon) + '<span>' + esc(foeName) + '</span></div>' + foeBoard + '</div>' +
    '<div class="turnarrow ' + (myTurn ? 'mt' : 'ft') + '" aria-hidden="true">' + ARROW_SVG + '</div>' +
    '<div class="sheet mine"><div class="cap">' + nameBadge('me') + '<span>' + esc(myName) + '</span></div>' + myBoard + '</div></div>' +
    (leftRow ? '<div class="leftrow"><span>' + esc(tr('left.foe')) + '</span>' + leftRow + '</div>' : '') + fire + '</div>';
}

// ===== Окна =====
function modalHtml() {
  var out = '';
  var v = app.ctrl ? app.ctrl.view() : null;
  if (v && v.gameOver && app.screen === 'game') {
    var win = v.winner === app.ctrl.seat;
    out += '<div class="scrim"><div class="modal over ' + (win ? 'win' : 'lose') + '" role="alertdialog" aria-modal="true"><h2>' + esc(tr(win ? 'over.win' : 'over.lose')) + '</h2><p>' + esc(tr((win ? 'over.win.' : 'over.lose.') + v.reason)) + '</p>' +
      '<button class="btn primary full" data-act="menu">' + esc(tr('over.menu')) + '</button>' + (app.ctrl.local ? '<button class="btn full" data-act="again">' + esc(tr('over.again')) + '</button>' : '') + (app.ctrl.online ? '<button class="btn full" data-act="again">' + esc(tr('o.over.again')) + '</button>' : '') + '</div></div>';
  }
  if (app.ctrl && app.ctrl.online && app.screen === 'game') out += window.BattleshipOnline.askHtml();
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
var LOGO = '<svg viewBox="0 0 140 90" width="96" height="62" aria-hidden="true"><rect x="2" y="2" width="136" height="86" rx="8" class="logo-paper"/>' +
  '<path d="M2 30H138M2 58H138M36 2V88M72 2V88M106 2V88" class="logo-grid"/><g transform="translate(10,30) scale(.38)">' + shipG(3) + '</g><circle cx="104" cy="66" r="5" class="logo-dot"/><path d="M112 16l16 16M128 16l-16 16" class="m-hit logo-hit"/></svg>';
function startHtml() {
  return '<div class="start"><div class="brand-row"><div class="brand"><div class="logo-ship">' + LOGO + '</div><h1>' + esc(tr('title')) + '</h1></div>' +
    '<div class="top-actions">' + catalogLinkHtml() + themeButtonHtml('theme-btn') + '</div></div>' +
    '<div class="muted-text">' + esc(tr('sub')) + '</div>' +
    '<div class="field"><div class="field-title">' + esc(tr('start.mode')) + '</div><div class="modes"><button class="mode-btn" aria-pressed="true">' + esc(tr('start.online')) + '<small>' + esc(tr('start.onlineSub')) + '</small></button></div></div>' +
    '<div class="start-actions"><button class="btn-play" data-act="play">' + esc(tr('start.play')) + '</button>' + (DEV ? '<button class="btn-secondary wide" data-act="dev">' + esc(tr('start.dev')) + '</button>' : '') + '<button class="btn-secondary wide" data-act="rules">' + esc(tr('rules.button')) + '</button></div></div>';
}

// ===== Локальная партия против случайного бота (для проверки экранов: ?dev) =====
function devController() {
  var st, listeners = [], seat = 0, timer = null;
  function emit() { listeners.forEach(function (fn) { fn(); }); }
  function reset() {
    st = B.init([{ id: 'me', name: P.getProfile().name }, { id: 'bot', name: tr('foe') }], {});
    st = B.reduce(st, { type: 'place', seat: 1, ships: B.randomLayout(), arsenal: { radar: 1, sub: 1, bomber: 2 } }).state;
  }
  function botMove() {
    clearTimeout(timer);
    if (st.gameOver || st.current !== 1) return;
    timer = setTimeout(function () {
      var marks = st.seats[0].marks, hits = [], free = [];
      marks.forEach(function (m, i) { if (m === 0 || m === 4) free.push(i); if (m === 2) hits.push(i); });
      var near = [], arm = st.seats[1].arsenal, avail = B.WEAPONS.filter(function (w) { return arm[w] > 0; });
      hits.forEach(function (h) { [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var x = h % N + d[0], y = Math.floor(h / N) + d[1]; if (x >= 0 && y >= 0 && x < N && y < N && (marks[y * N + x] === 0 || marks[y * N + x] === 4)) near.push(y * N + x); }); });
      var pool = near.length ? near : free, pick = pool[Math.floor(Math.random() * pool.length)], type = 'shoot';
      if (avail.length && !near.length && Math.random() < 0.3) type = avail[Math.floor(Math.random() * avail.length)];   // бот иногда применяет оружие
      var r = B.reduce(st, { type: type, seat: 1, x: pick % N, y: Math.floor(pick / N) });
      if (r.ok) { st = r.state; emit(); botMove(); }
    }, 1700);
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
    if (app.ctrl.online) html = window.BattleshipOnline.bannerHtml() + html;
  } else if (app.screen === 'online') html = window.BattleshipOnline.html();
  else html = startHtml();
  appEl.innerHTML = '<div class="screen">' + html + '</div>' + modalHtml() + (window.BattleshipOnline ? window.BattleshipOnline.overlayHtml() : '');
  if (window.BattleshipOnline) window.BattleshipOnline.afterRender();
}
function startGame(ctrl) {
  app.ctrl = ctrl; app.screen = 'game'; app.place = newPlace(); app.weapon = 'shoot'; app.arsenalOpen = false; app.sel = -1; app.hover = -1; app.confirm = false; app.animTurns = -1;
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
    else if (v.current === app.ctrl.seat && !v.gameOver) {
      var mk = v.seats[1 - app.ctrl.seat].marks[idx];
      if (app.weapon !== 'shoot' || mk === 0 || mk === 4) { app.sel = idx; render(); }
    }
    return;
  }
  var el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (window.BattleshipOnline && window.BattleshipOnline.click(el)) return;
  var act = el.getAttribute('data-act'), ctrl = app.ctrl;
  switch (act) {
    case 'theme': window.PlatformTheme.toggle(); break;
    case 'rules': app.rules = true; render(); break;
    case 'closeRules': app.rules = false; render(); break;
    case 'dev': startGame(devController()); break;
    case 'exit': { var v2 = ctrl.view(); if (v2.phase === 'playing' && !v2.gameOver) { app.confirm = true; render(); } else toMenu(); break; }
    case 'stay': app.confirm = false; render(); break;
    case 'concede': app.confirm = false; ctrl.send({ type: 'concede', seat: ctrl.seat }); render(); break;
    case 'menu': toMenu(); break;
    case 'again': if (ctrl.online) { ctrl.again(); break; } ctrl.restart(); app.place = newPlace(); app.weapon = 'shoot'; app.arsenalOpen = false; app.sel = -1; app.hover = -1; app.animTurns = -1; render(); break;
    case 'pick': app.place.pick = Number(el.getAttribute('data-len')); app.place.msg = ''; render(); break;
    case 'rotate': app.place.dir = app.place.dir === 'h' ? 'v' : 'h'; render(); break;
    case 'random': app.place.ships = B.randomLayout(); app.place.pick = null; app.place.msg = ''; render(); break;
    case 'clear': app.place = newPlace(); render(); break;
    case 'ready': ctrl.send({ type: 'place', seat: ctrl.seat, ships: app.place.ships, arsenal: app.place.arsenal }); break;
    case 'unready': ctrl.send({ type: 'unplace', seat: ctrl.seat }); break;
    case 'arsenal': {
      var w = el.getAttribute('data-w'), d2 = Number(el.getAttribute('data-d')), a2 = app.place.arsenal, nv = a2[w] + d2;
      if (nv >= 0 && nv <= B.CONFIG.arsenal.max[w] && arsenalTotal(a2) + d2 <= B.CONFIG.arsenal.total) { a2[w] = nv; render(); }
      break;
    }
    case 'arsenalToggle': app.arsenalOpen = !app.arsenalOpen; render(); break;
    case 'weapon': { var wn = el.getAttribute('data-w'); app.weapon = app.weapon === wn ? 'shoot' : wn; app.arsenalOpen = false; render(); break; }
    case 'fire': if (app.sel >= 0) { var i2 = app.sel, wp = app.weapon; app.sel = -1; app.weapon = 'shoot'; ctrl.send({ type: wp, seat: ctrl.seat, x: i2 % N, y: Math.floor(i2 / N) }); } break;
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
