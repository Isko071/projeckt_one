// ===== Интерфейс игры «Дурак» =====
// Все надписи берутся из словаря (games/durak/ru.js). Экраны работают с контроллером стола:
//   ctrl.seat — моё место; ctrl.view() — вид стола (Durak.view, у моего места — мои карты в hand); ctrl.send(action) → true | false; ctrl.subscribe(fn); ctrl.leave().
// Партия с ботами идёт в браузере (botController), онлайн-контроллер — в online.js.
var CATALOG_URL = '../../index.html';
var tr = function (key, params) { return window.I18n.t('games.durak.' + key, params); };
var D = window.Durak, P = window.PlatformProfile, W = window.PlatformWallet;
var appEl = document.getElementById('app');
var WIN_REWARD = { easy: 150, medium: 250, expert: 400 };       // награда, если не остался дураком против ботов; за день не больше PlatformWallet.CONFIG.rewardCaps['durak-<уровень>']
var BOT_MS = { easy: 900, medium: 800, expert: 700 };           // пауза перед ходом бота: чтобы было видно, что он положил

var app = { screen: 'start', mode: 'bot', level: 'medium', variant: 'podkidnoy', deck: 36, neighbors: false, players: 2, rules: false, settings: false, confirm: false, ctrl: null, pick: null, sel: [], shownMove: -1, hold: null, lastDefendAt: 0 };
var HOLD_MS = 3000;          // побитая пара лежит на столе не меньше 3 секунд, даже если «Бито» нажали сразу
function holdLeft() { return app.hold ? Math.max(0, app.hold.until - Date.now()) : 0; }

function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

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

// ===== Карты =====
var SUIT_CHAR = { S: '♠', C: '♣', D: '♦', H: '♥' };
// Достоинство на карте (10, В, Д, К, Т) и название для экранного диктора — из словаря
function rankLabel(c) { return /[TJQKA]/.test(c[0]) ? tr('rank.' + c[0]) : c[0]; }
function cardName(c) { return tr('card.name', { r: tr('rankName.' + c[0]), s: tr('suit.' + c[1]) }); }
// Режим стола одной строкой: «Переводной · 52 карты»
function modeLabel(mode, deck, neighbors) {
  var pm = D.parseMode(mode), nb = neighbors === undefined ? pm.neighbors : neighbors;
  return tr('mode.label', { v: tr('start.variant.' + pm.variant), d: tr('start.deck.' + (deck || pm.deck)) }) + (nb ? ' · ' + tr('mode.neighbors') : '');
}
function cardHtml(c, cls, attrs) {
  var red = c[1] === 'D' || c[1] === 'H';
  return '<span class="pcard ' + (red ? 'red' : 'blk') + (cls ? ' ' + cls : '') + '"' + (attrs || '') + '><b>' + esc(rankLabel(c)) + '<i>' + SUIT_CHAR[c[1]] + '</i></b><em>' + SUIT_CHAR[c[1]] + '</em></span>';
}
function backHtml(cls) { return '<span class="pcard back' + (cls ? ' ' + cls : '') + '"></span>'; }

// ===== Экран партии =====
function mySeat() { return app.ctrl ? app.ctrl.seat : 0; }
function myTurn(v) { return !!app.ctrl && !v.gameOver && v.actor === mySeat() && !app.ctrl.busy && !holdLeft(); }
// Что я могу сделать: в свою очередь — всё, вне очереди — подкинуть, пока отбивающийся кроет. Пока лежит побитая пара (3 с) — ничего
function legalNow(v) {
  var none = { attack: [], defend: [], transfer: [], take: false, pass: false, max: 0 };
  if (!app.ctrl || v.gameOver || holdLeft()) return none;
  if (v.actor === mySeat() && app.ctrl.busy) return none;
  return D.legal(v, mySeat());
}
function nameOf(v, seat) { var s = v.seats[seat]; if (!s) return ''; return seat === mySeat() ? tr('you') : (s.name || '—'); }
function seatTag(v, i) {
  var s = v.seats[i];
  if (v.gameOver && v.loser === i) return 'fool';
  if (s.out) return 'out';
  if (v.gameOver) return '';
  if (v.actor === i) return i === v.defender ? 'defend' : (v.phase === 'attack' ? 'attack' : 'throw');
  if (i === v.defender) return 'defend';
  return '';
}
// Места соперников вокруг овального стола (в процентах стола), по часовой стрелке от меня (я — внизу)
function ring(n) {
  return ({ 1: [[50, 9]], 2: [[24, 13], [76, 13]], 3: [[11, 42], [50, 8], [89, 42]], 4: [[10, 46], [31, 10], [69, 10], [90, 46]], 5: [[9, 54], [20, 17], [50, 7], [80, 17], [91, 54]] }[n] || [])
    .map(function (p) { return { x: p[0], y: p[1] }; });
}
function seatColor(i) { return 'oklch(' + (window.PlatformTheme.isDark() ? 0.42 : 0.86) + ' 0.07 ' + (i * 62 + 20) + ')'; }
function seatsHtml(v) {
  var me = mySeat(), n = v.seats.length, pos = ring(n - 1), out = '';
  for (var k = 1; k < n; k++) {
    var i = (me + k) % n, s = v.seats[i], cnt = D.size(v, i), tag = seatTag(v, i), p = pos[k - 1];
    out += '<div class="seat' + (v.actor === i && !v.gameOver ? ' turn' : '') + (s.out ? ' out' : '') + (s.active === false ? ' gone' : '') + '" style="left:' + p.x + '%;top:' + p.y + '%">' +
      '<span class="tag' + (tag ? ' ' + tag : ' none') + '">' + esc(tag ? tr('tag.' + tag) : '·') + '</span>' +
      '<div class="ring" data-seat="' + i + '"><div class="av" style="background:' + seatColor(i) + '">' + esc(P.initial(s.name || '?')) + '</div>' +
      '<span class="cnt" aria-label="' + esc(tr('cards', { n: cnt })) + '">' + backHtml('mini') + '<b>' + cnt + '</b></span></div>' +
      '<div class="nick">' + esc(nameOf(v, i)) + '</div></div>';
  }
  return out;
}
function tableHtml(v, lg) {
  var pick = app.pick, targets = {};
  if (pick) lg.defend.forEach(function (d) { if (d.card === pick) targets[d.target] = true; });
  // при перетаскивании карты на стол каждая пара знает, можно ли её побить этой картой (data-beat)
  var pairs = v.table.map(function (p, i) {
    var a = cardHtml(p.a, 'a', ' data-c="' + p.a + '"'), d = p.d ? cardHtml(p.d, 'd', ' data-c="' + p.d + '"') : '';
    var label = cardName(p.a) + (p.d ? ' — ' + cardName(p.d) : '');
    return targets[i] ? '<button class="pair target" data-target="' + i + '" data-pair="' + i + '" aria-label="' + esc(label) + '">' + a + d + '</button>' : '<div class="pair" data-pair="' + i + '" aria-label="' + esc(label) + '">' + a + d + '</div>';
  }).join('');
  var deck = v.deckCount, trump = '<div class="deck" aria-label="' + esc(tr('trump') + ': ' + cardName(v.trumpCard) + '. ' + (deck ? tr('deck', { n: deck }) : tr('deck.empty'))) + '">' +
    (deck ? cardHtml(v.trumpCard, 'trumpcard') + (deck > 1 ? backHtml('top') : '') + '<span class="dn">' + deck + '</span>' : '') +
    '<span class="ts' + (v.trump === 'D' || v.trump === 'H' ? ' red' : '') + '" title="' + esc(tr('trump')) + '">' + SUIT_CHAR[v.trump] + '</span></div>';
  var bito = '<div class="bito">' + (v.discard ? backHtml('pile') + '<span>' + esc(tr('discard', { n: v.discard })) + '</span>' : '') + '</div>';
  var info = !v.table.length && v.last && (v.last.type === 'bito' || v.last.type === 'took') ? '<div class="flash">' + esc(v.last.type === 'bito' ? tr('last.bito') : tr('last.took', { name: nameOf(v, v.last.seat) })) + '</div>' : '';
  // Овальный стол: соперники по кругу, в центре — карты захода, слева колода с козырем, справа отбой
  return '<div class="area n' + (v.seats.length - 1) + '"><div class="oval"></div>' + trump + '<div class="table' + (v.taking ? ' taking' : '') + '" role="group" aria-label="' + esc(tr('table.label')) + '">' + (pairs || info || '<span class="empty">' + esc(tr('table.empty')) + '</span>') + '</div>' + bito + seatsHtml(v) + '</div>';
}
// Рука веером: карты чуть повёрнуты от середины; подходящие для хода выдвинуты вверх, выбранные — ещё выше
function handHtml(v, lg) {
  var me = v.seats[mySeat()], hand = D.sortHand(me.hand || [], v.trump), n = hand.length, mid = (n - 1) / 2, spread = n > 1 ? Math.min(4, 20 / n) : 0;      // весь веер не шире ~20°
  var can = {};
  lg.attack.forEach(function (c) { can[c] = true; });
  lg.transfer.forEach(function (c) { can[c] = true; });
  lg.defend.forEach(function (d) { can[d.card] = true; });
  var cards = hand.map(function (c, i) {
    var off = i - mid, sel = app.sel.indexOf(c) >= 0 || app.pick === c;
    var cls = (can[c] ? 'ok' : '') + (sel ? ' sel' : '') + (D.isTrump(c, v.trump) ? ' tr' : '');
    var style = '--r:' + (off * spread).toFixed(2) + 'deg;--y:' + (Math.abs(off) * Math.abs(off) * 0.9).toFixed(1) + 'px';
    return '<button class="hc' + (can[c] ? ' can' : '') + (sel ? ' picked' : '') + '" data-card="' + c + '" style="' + style + '" aria-label="' + esc(cardName(c)) + '"' + (can[c] ? '' : ' aria-disabled="true"') + '>' + cardHtml(c, cls) + '</button>';
  }).join('');
  return '<div class="hand" role="group" aria-label="' + esc(tr('hand.label')) + '">' + cards + '</div>';
}
function noteText(v, lg) {
  var me = mySeat();
  if (v.gameOver) return '';
  if (v.seats[me].out) return tr('note.out');
  if (holdLeft()) return v.last && v.last.type === 'took' ? tr('last.took', { name: nameOf(v, v.defender) }) : tr('last.bito');
  if (app.sel.length) return tr('note.sel', { n: app.sel.length });
  if (!myTurn(v)) {
    if (lg.attack.length) return tr('note.throwWhile');
    if (v.taking && v.actor !== v.defender) return tr('note.waitTaking', { name: nameOf(v, v.defender) });
    return tr(v.actor === v.defender ? 'note.waitDefend' : 'note.wait', { name: nameOf(v, v.actor) });
  }
  if (app.pick) return tr('note.defendPick');
  if (v.phase === 'defend') return lg.transfer.length && !lg.defend.length ? tr('note.transfer') : tr('note.defend');
  if (v.phase === 'attack') return tr(lg.max > 1 && hasGroup(v, lg) ? 'note.attackMany' : 'note.attack');
  return tr(v.taking ? 'note.throwTaking' : 'note.throw');
}
function gameHtml(v) {
  var lg = legalNow(v);
  if (app.pick && !lg.defend.some(function (d) { return d.card === app.pick; }) && lg.transfer.indexOf(app.pick) < 0) app.pick = null;
  app.sel = app.sel.filter(function (c) { return lg.attack.indexOf(c) >= 0; });
  var btns = '';
  if (app.sel.length) {
    btns += '<button class="btn primary" data-act="playSel">' + esc(tr('act.playSel', { n: app.sel.length })) + '</button>';
    btns += '<button class="btn" data-act="unsel">' + esc(tr('act.cancel')) + '</button>';
  } else if (app.pick) {
    if (lg.transfer.indexOf(app.pick) >= 0) btns += '<button class="btn primary" data-act="transfer">' + esc(tr('act.transfer')) + '</button>';
    btns += '<button class="btn" data-act="unpick">' + esc(tr('act.cancel')) + '</button>';
  } else {
    if (lg.take) btns += '<button class="btn warn" data-act="take">' + esc(tr('act.take')) + '</button>';
    if (lg.pass) btns += '<button class="btn primary" data-act="pass">' + esc(tr(v.taking ? 'act.pass' : 'act.bito')) + '</button>';
  }
  var meTag = seatTag(v, mySeat());
  return '<div class="game"><div class="o-head"><button class="theme-btn" data-act="exit" aria-label="' + esc(tr('exit')) + '">←</button><h2>' + esc(tr('title')) + '<small>' + esc(modeLabel(v.mode, v.deckSize, v.neighbors)) + '</small></h2>' +
      (app.ctrl.online ? window.DurakOnline.chatButtonHtml() : '') + '<button class="theme-btn" data-act="rules" aria-label="' + esc(tr('rules.button')) + '">?</button>' + themeButtonHtml('theme-btn') + '</div>' +
    tableHtml(v, lg) +
    '<div class="me' + (myTurn(v) ? ' turn' : '') + '"><div class="ring" data-seat="' + mySeat() + '"><div class="av" style="background:' + P.avatarColor(P.getProfile().avatar) + '">' + esc(P.initial(P.getProfile().name)) + '</div></div><span class="nm">' + esc(tr('you')) + '</span>' + (meTag ? '<span class="tag ' + meTag + '">' + esc(tr('tag.' + meTag)) + '</span>' : '') + '</div>' +
    '<div class="note" role="status">' + esc(noteText(v, lg)) + '</div>' +
    handHtml(v, lg) +
    '<div class="actions">' + btns + '</div></div>';
}

// Есть ли в руке хотя бы две карты, которые можно положить вместе (одного достоинства на первом ходу, любые подходящие при подкидывании)
function hasGroup(v, lg) {
  if (lg.max < 2 || lg.attack.length < 2) return false;
  if (v.table.length) return true;
  var by = {}; return lg.attack.some(function (c) { by[c[0]] = (by[c[0]] || 0) + 1; return by[c[0]] > 1; });
}
// Можно ли добавить карту c к уже выбранным для хода
function fitsSel(v, lg, c) {
  if (lg.attack.indexOf(c) < 0 || app.sel.length >= lg.max) return false;
  return v.table.length || !app.sel.length || c[0] === app.sel[0][0];
}

// ===== Окна =====
function rewardHtml(v) {
  var sk = app.ctrl && app.ctrl.stake && app.ctrl.stake();
  if (sk) return '<p class="reward' + (sk > 0 ? '' : ' lost') + '" role="status">' + esc(tr(sk > 0 ? 'o.stake.won' : 'o.stake.lost', { n: fmt(Math.abs(sk)) })) + '</p>';
  if (app.ctrl && app.ctrl.online && Number(app.ctrl.stakeAmount && app.ctrl.stakeAmount())) return '<p class="reward" role="status">' + esc(tr('o.stake.back')) + '</p>';
  var r = app.ctrl && app.ctrl.reward && app.ctrl.reward();
  if (!r) return '';
  var p = { n: fmt(r.granted), unit: window.I18n.plural(r.granted, 'wallet.unit') };
  return '<p class="reward" role="status">' + esc(r.granted <= 0 ? tr('over.cap.reached') : (r.capped ? tr('over.cap.cut', p) : tr('over.reward', p))) + '</p>';
}
function modalHtml() {
  var out = '', v = app.ctrl && app.screen === 'game' ? currentView() : null;
  if (v && v.gameOver) {
    var res = v.loser < 0 ? 'draw' : (v.loser === mySeat() ? 'lose' : 'win');
    out += '<div class="scrim"><div class="modal over ' + res + '" role="alertdialog" aria-modal="true"><h2>' + esc(tr('over.' + res)) + '</h2><p>' + esc(tr('over.' + res + '.' + v.reason, { name: v.loser >= 0 ? nameOf(v, v.loser) : '' })) + '</p>' + rewardHtml(v) +
      '<button class="btn primary full" data-act="again">' + esc(tr(app.ctrl.online ? 'o.over.again' : 'over.again')) + '</button><button class="btn full" data-act="menu">' + esc(tr('over.menu')) + '</button></div></div>';
  }
  if (app.ctrl && app.ctrl.online && app.screen === 'game') out += window.DurakOnline.askHtml();
  if (app.confirm) {
    out += '<div class="scrim"><div class="modal" role="alertdialog" aria-modal="true"><h2>' + esc(tr('confirm.title')) + '</h2><p>' + esc(tr('confirm.text')) + '</p><div class="row"><button class="btn primary" data-act="stay">' + esc(tr('confirm.stay')) + '</button><button class="btn" data-act="concede">' + esc(tr('confirm.ok')) + '</button></div></div></div>';
  }
  if (app.settings) {
    out += '<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(tr('settings.title')) + '"><h2>' + esc(tr('settings.title')) + '</h2>' +
      '<div class="field"><div class="field-title">' + esc(tr('start.variant')) + '</div>' + segHtml('variant', D.CONFIG.variants, app.variant) + '</div>' +
      '<div class="field"><div class="field-title">' + esc(tr('start.deck')) + '</div>' + segHtml('deck', D.CONFIG.decks, app.deck) + '</div>' +
      '<button class="mode-btn o-mode" data-act="neighbors" aria-pressed="' + app.neighbors + '"><b>' + esc(tr('settings.neighbors')) + '</b><small>' + esc(tr(app.neighbors ? 'settings.neighborsOn' : 'settings.neighborsOff')) + '</small></button>' +
      '<button class="btn primary full" data-act="closeSettings">' + esc(tr('settings.done')) + '</button></div></div>';
  }
  if (app.rules) {
    out += '<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(tr('rules.title')) + '"><h2>' + esc(tr('rules.title')) + '</h2><ol>' +
      [1, 2, 3, 4, 5, 6, 7].map(function (k) { return '<li>' + esc(tr('rules.step' + k)) + '</li>'; }).join('') + '</ol><button class="btn primary full" data-act="closeRules">' + esc(tr('rules.close')) + '</button></div></div>';
  }
  return out;
}

// ===== Старт =====
var LOGO = '<div class="logo-dk" aria-hidden="true">' + cardHtml('6S') + cardHtml('AH') + cardHtml('KD') + '</div>';
function segHtml(act, items, sel, prefix) {
  return '<div class="modes seg">' + items.map(function (it) { return '<button class="mode-btn" data-act="' + act + '" data-v="' + it + '" aria-pressed="' + (String(sel) === String(it)) + '">' + esc(tr((prefix || 'start.' + act) + '.' + it)) + '</button>'; }).join('') + '</div>';
}
function startHtml() {
  return '<div class="start"><div class="brand-row"><div class="brand">' + LOGO + '<h1>' + esc(tr('title')) + '</h1></div>' +
    '<div class="top-actions">' + catalogLinkHtml() + themeButtonHtml('theme-btn') + '</div></div>' +
    '<div class="muted-text">' + esc(tr('sub')) + '</div>' +
    '<div class="field"><div class="field-title">' + esc(tr('start.mode')) + '</div><div class="modes duo">' +
      ['bot', 'online'].map(function (m) {
        var sub = m === 'online' && window.PlatformCloud && window.PlatformCloud.getState().user ? 'start.onlineSubIn' : 'start.' + m + 'Sub';      // вошёл через Google — просто «С друзьями»
        return '<button class="mode-btn" data-act="mode" data-v="' + m + '" aria-pressed="' + (app.mode === m) + '">' + esc(tr('start.' + m)) + '<small>' + esc(tr(sub)) + '</small></button>';
      }).join('') + '</div></div>' +
    '<button class="settings-btn" data-act="openSettings"><span>' + esc(tr('settings.title')) + '</span><small>' + esc(modeLabel(D.makeMode(app.variant, app.deck, app.neighbors))) + '</small><i aria-hidden="true">›</i></button>' +
    (app.mode === 'bot'
      ? '<div class="field"><div class="field-title">' + esc(tr('start.players')) + '</div>' + segHtml('players', [2, 3, 4, 5, 6], app.players) + '</div>' +
        '<div class="field"><div class="field-title">' + esc(tr('start.level')) + '</div>' + segHtml('level', D.CONFIG.botLevels, app.level) + '</div>'
      : '') +
    '<div class="start-actions"><button class="btn-play" data-act="play">' + esc(tr('start.play')) + '</button><button class="btn-secondary wide" data-act="rules">' + esc(tr('rules.button')) + '</button></div></div>';
}

// ===== Партия против ботов: идёт в браузере, награда — если не остался дураком =====
function botController(level, variant, deck, players, neighbors) {
  var st, listeners = [], seat = 0, timer = null, reward = null, paid = false, ctrl;
  function emit() { listeners.forEach(function (fn) { fn(); }); }
  function settle() {
    if (!st.gameOver || paid) return;
    paid = true;
    // награда только за доигранную партию, где дураком остался бот (ничья — без награды); за день не больше предела кошелька
    if (st.reason === 'finished' && st.loser >= 0 && st.loser !== seat && W) { var src = 'durak-' + level, r = W.reward(src, WIN_REWARD[level], Date.now()); W.countWin(src); reward = { granted: r.granted, capped: r.capped }; }
  }
  function reset() {
    reward = null; paid = false;
    var seats = [{ id: 'me', name: P.getProfile().name }];
    for (var i = 1; i < players; i++) seats.push({ id: 'bot' + i, name: D.botNames[(i - 1) % D.botNames.length], bot: true, level: level });
    st = D.init(seats, { mode: D.makeMode(variant, deck, neighbors) });
  }
  function view() {
    var v = D.view(st);
    v.seats[seat].hand = st.seats[seat].hand.slice();
    return v;
  }
  function botMove() {
    clearTimeout(timer);
    if (st.gameOver || st.actor === seat) { ctrl.busy = false; return; }
    ctrl.busy = true;
    timer = setTimeout(function () {
      var r = D.reduce(st, window.DurakBot.choose(st, st.actor, level));
      ctrl.busy = false;
      if (r.ok) { st = r.state; settle(); emit(); botMove(); }
    }, Math.max(BOT_MS[level], holdLeft() + 400));          // пока лежит побитая пара, бот новый заход не начинает
  }
  reset();
  ctrl = {
    bot: true, local: true, seat: seat, busy: false,
    view: view,
    send: function (a) { var r = D.reduce(st, a); if (!r.ok) return false; st = r.state; settle(); emit(); botMove(); return true; },
    reward: function () { return reward; },
    subscribe: function (fn) { listeners.push(fn); },
    again: function () { clearTimeout(timer); reset(); if (W) { W.markPlayed(); W.countPlay('durak'); } emit(); botMove(); },
    leave: function () { clearTimeout(timer); },
    started: function () { return st.moves > 0; }
  };
  if (W) { W.markPlayed(); W.countPlay('durak'); }
  botMove();                                       // первым ходит бот, если у него младший козырь
  return ctrl;
}

// ===== Анимация карт =====
// Экран перерисовывается целиком, поэтому движение считается по двум видам стола — до и после — и по положению элементов до перерисовки:
//   новая карта на столе прилетает из руки (мой ход) или с места игрока; добор летит из колоды; «бито» уходит в отбой; «взять» — к забирающему.
// Без анимаций (prefers-reduced-motion или старый браузер) всё просто появляется на месте.
var Anim = (function () {
  var MS = 520;
  function off() { return !Element.prototype.animate || reduced(); }
  function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function rect(el) { var r = el && el.getBoundingClientRect(); return r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; }
  function center(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
  // Положения до перерисовки: карты на столе (по коду), карты в руке, места игроков, колода, отбой
  function capture() {
    if (off()) return null;
    var out = { table: {}, hand: {}, seat: {}, deck: rect(appEl.querySelector('.deck')), bito: rect(appEl.querySelector('.bito')) };
    appEl.querySelectorAll('.table [data-c]').forEach(function (el) { out.table[el.getAttribute('data-c')] = { r: rect(el), d: el.classList.contains('d') }; });
    appEl.querySelectorAll('.hc[data-card]').forEach(function (el) { out.hand[el.getAttribute('data-card')] = rect(el.querySelector('.pcard')); });
    appEl.querySelectorAll('[data-seat]').forEach(function (el) { out.seat[el.getAttribute('data-seat')] = rect(el); });
    return out;
  }
  // Элемент на новом месте плавно приезжает из точки from (центр), по пути чуть уменьшен
  function flyIn(el, from, delay, scale) {
    var to = rect(el);
    if (!to || !from) return;
    var c = center(to), end = getComputedStyle(el).transform;
    end = end && end !== 'none' ? end : '';
    el.animate([{ transform: 'translate(' + (from.x - c.x) + 'px,' + (from.y - c.y) + 'px) scale(' + (scale || 0.6) + ') ' + end, opacity: 0.6 }, { transform: end || 'none', opacity: 1 }],
      { duration: MS, delay: delay || 0, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' });
  }
  // Летящая копия карты поверх экрана: из прямоугольника from в точку to, потом исчезает
  function ghost(html, from, to, delay) {
    if (!from || !to) return;
    var host = document.createElement('div');
    host.className = 'fly';
    host.innerHTML = html;
    var el = host.firstChild;
    el.style.setProperty('--w', from.w + 'px');
    host.style.left = from.x + 'px'; host.style.top = from.y + 'px';
    document.body.appendChild(host);
    var c = center(from);
    var a = host.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate(' + (to.x - c.x) + 'px,' + (to.y - c.y) + 'px) scale(.5)', opacity: 0.2 }],
      { duration: MS, delay: delay || 0, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'both' });
    a.onfinish = a.oncancel = function () { host.remove(); };
  }
  function play(prev, v, snap) {
    if (!snap || off()) return;
    var me = mySeat(), deckPt = snap.deck ? center(snap.deck) : null;
    var nowDeck = rect(appEl.querySelector('.deck .top') || appEl.querySelector('.deck .trumpcard') || appEl.querySelector('.deck')), deckFrom = deckPt || (nowDeck ? center(nowDeck) : null);
    var seatPt = function (i) { var r = snap.seat[i] || rect(appEl.querySelector('[data-seat="' + i + '"]')); return r ? center(r) : null; };
    // начало партии: раздача из колоды по кругу
    if (!prev) {
      var k = 0;
      appEl.querySelectorAll('.hc .pcard').forEach(function (el) { flyIn(el, deckFrom, 80 + k * 90, 0.5); k++; });
      v.seats.forEach(function (s, i) { if (i !== me) for (var j = 0; j < Math.min(3, D.size(v, i)); j++) ghost(backHtml(), nowDeck, seatPt(i), 80 + (k++) * 60); });
      return;
    }
    if (prev.moves === v.moves && prev.table.length === v.table.length) return;
    var was = {}; prev.table.forEach(function (p) { was[p.a] = true; if (p.d) was[p.d] = true; });
    var actor = v.last ? v.last.seat : -1;
    // новые карты на столе: из моей руки или с места того, кто положил
    appEl.querySelectorAll('.table [data-c]').forEach(function (el) {
      var c = el.getAttribute('data-c');
      if (was[c]) return;
      var dropped = app.dropFrom && app.dropFrom.cards.indexOf(c) >= 0 ? app.dropFrom : null;
      var src = dropped ? { x: dropped.x, y: dropped.y } : (snap.hand[c] ? center(snap.hand[c]) : seatPt(actor));
      flyIn(el, src, 0, dropped || snap.hand[c] ? 1 : 0.55);
    });
    // стол опустел: «бито» — в отбой, «взять» — к забирающему (если забираю я — карты встают в руку на свои места)
    var cleared = prev.table.length && !v.table.length;
    var took = cleared && v.last && v.last.type === 'took', taker = took ? v.last.seat : -1;
    if (cleared) {
      var dst = took ? seatPt(taker) : (rect(appEl.querySelector('.bito')) ? center(rect(appEl.querySelector('.bito'))) : null);
      Object.keys(snap.table).forEach(function (c, n) {
        if (took && taker === me) return;                                 // мои взятые карты прилетят прямо в руку (ниже)
        ghost(cardHtml(c, snap.table[c].d ? 'd' : 'a'), snap.table[c].r, dst, n * 60);
      });
    }
    // новые карты в моей руке: взятые — со стола, добор — из колоды
    var k2 = 0;
    appEl.querySelectorAll('.hc[data-card]').forEach(function (el) {
      var c = el.getAttribute('data-card');
      if (snap.hand[c]) return;
      var fromTable = snap.table[c] && snap.table[c].r;
      flyIn(el.querySelector('.pcard'), fromTable ? center(fromTable) : deckFrom, (fromTable ? 0 : 260) + (k2++) * 110, fromTable ? 0.9 : 0.5);
    });
    // добор соперников: рубашки из колоды к их местам
    if (prev.deckCount > v.deckCount) {
      v.seats.forEach(function (s, i) {
        if (i === me || !prev.seats[i]) return;
        var gain = D.size(v, i) - D.size(prev, i) - (took && taker === i ? prev.table.reduce(function (a, p) { return a + (p.d ? 2 : 1); }, 0) : 0);
        for (var j = 0; j < Math.min(gain, 6); j++) ghost(backHtml(), nowDeck, seatPt(i), 260 + (k2++) * 110);
      });
    }
  }
  return { capture: capture, play: play };
})();

// ===== Отрисовка и нажатия =====
// Что показывать: настоящий вид стола или — первые 3 секунды после «бито»/«взять» — прежний стол с побитой парой
function currentView() { return app.hold ? app.hold.view : app.ctrl.view(); }
function holdTrack(real) {
  var now = Date.now(), rp = app.realPrev;
  var defs = function (x) { return x ? x.table.filter(function (p) { return p.d; }).length : 0; };
  if (defs(real) > defs(rp)) app.lastDefendAt = now;
  if (!app.hold && rp && rp.table.length && !real.table.length && app.prevView && now - app.lastDefendAt < HOLD_MS) {
    app.hold = { view: app.prevView, until: app.lastDefendAt + HOLD_MS };
    setTimeout(function () { if (app.hold) render(); }, app.hold.until - now + 30);
  }
  if (app.hold && (now >= app.hold.until || real.table.length)) app.hold = null;         // время вышло или начался новый заход
  app.realPrev = real;
}
function render() {
  if (app.drag) { app.renderLater = true; return; }       // карту тянут пальцем: перерисуем, когда отпустят
  var html, v = null;
  if (app.screen === 'game' && app.ctrl) {
    holdTrack(app.ctrl.view());
    v = currentView();
    html = gameHtml(v);
    if (app.ctrl.online) html = window.DurakOnline.bannerHtml() + html;
  } else if (app.screen === 'online') html = window.DurakOnline.html();
  else html = startHtml();
  var ai = document.activeElement, keep = ai && ai.tagName === 'INPUT' && ai.id && appEl.contains(ai) ? { id: ai.id, a: ai.selectionStart, b: ai.selectionEnd } : null;
  var snap = v ? Anim.capture() : null;
  appEl.innerHTML = '<div class="screen">' + html + '</div>' + modalHtml() + (window.DurakOnline ? window.DurakOnline.overlayHtml() : '');
  if (v) Anim.play(app.prevView, v, snap);
  app.dropFrom = null;
  app.prevView = v;
  if (keep) { var ni = document.getElementById(keep.id); if (ni) { try { ni.focus({ preventScroll: true }); if (keep.a !== null) ni.setSelectionRange(keep.a, keep.b); } catch (e) { /* без фокуса */ } } }
  if (v) app.shownMove = v.moves;
  if (v) updateRings();
  if (window.DurakOnline) window.DurakOnline.afterRender();
}
// Таймер хода (онлайн): вокруг кружка того, чей ход, кольцо убывает по кругу; меньше 20 секунд — оранжевое. Меняется только стиль кольца
function updateRings() {
  if (!app.ctrl || !app.ctrl.timer || app.screen !== 'game') return;
  appEl.querySelectorAll('[data-seat]').forEach(function (el) {
    var t = app.ctrl.timer(Number(el.getAttribute('data-seat')));
    if (!t) { el.style.background = ''; el.removeAttribute('title'); el.classList.remove('low'); return; }
    var low = t.secs <= 20, col = low ? 'var(--warn)' : 'var(--accent)';
    el.style.background = 'conic-gradient(' + col + ' ' + Math.round(t.left * 360) + 'deg, var(--line) 0)';
    el.classList.toggle('low', low);
    el.title = tr('timer.left', { n: t.secs });
  });
}
window.DurakRings = updateRings;
function startGame(ctrl) {
  app.ctrl = ctrl; app.screen = 'game'; app.pick = null; app.sel = []; app.confirm = false; app.shownMove = -1; app.prevView = null; app.hold = null; app.realPrev = null; app.lastDefendAt = 0;
  ctrl.subscribe(function () { if (app.ctrl === ctrl) render(); });
  render();
}
function toMenu() {
  if (app.ctrl) app.ctrl.leave();
  app.ctrl = null; app.screen = 'start'; app.confirm = false; app.pick = null; render();
}
// Положить карты на стол (одну или несколько сразу)
function playCards(cards) {
  if (!cards.length) return;
  var a = cards.length === 1 ? { type: 'attack', seat: mySeat(), card: cards[0] } : { type: 'attack', seat: mySeat(), cards: cards };
  app.ctrl.send(a); app.sel = []; app.pick = null; render();
}
function defendWith(c, target) { app.ctrl.send({ type: 'defend', seat: mySeat(), card: c, target: target }); app.pick = null; render(); }
// Нажали карту в руке: ход или подкидывание сразу; идёт выбор нескольких — карта добавляется к выбранным;
// при отбое — сразу, если бить можно только одну карту, иначе выбор карты на столе (или свайп прямо на неё)
function onCard(c) {
  var v = currentView(), lg = legalNow(v), me = mySeat();
  if (app.sel.length) {
    var at = app.sel.indexOf(c);
    if (at >= 0) app.sel.splice(at, 1); else if (fitsSel(v, lg, c)) app.sel.push(c);
    render(); return;
  }
  if (lg.attack.indexOf(c) >= 0) { playCards([c]); return; }
  var ways = lg.defend.filter(function (d) { return d.card === c; }), canTr = lg.transfer.indexOf(c) >= 0;
  if (ways.length === 1 && !canTr) { defendWith(c, ways[0].target); return; }
  if (!ways.length && canTr) { app.ctrl.send({ type: 'transfer', seat: me, card: c }); app.pick = null; render(); return; }
  app.pick = ways.length || canTr ? (app.pick === c ? null : c) : null;
  render();
}

// ===== Карта пальцем (или мышью): удержать — выбрать несколько; потянуть вверх — положить на стол; на нужную карту стола — побить именно её =====
var press = null;
function pairUnder(x, y) {
  var el = document.elementFromPoint(x, y), pair = el && el.closest ? el.closest('[data-pair]') : null;
  return pair ? Number(pair.getAttribute('data-pair')) : -1;
}
appEl.addEventListener('pointerdown', function (e) {
  var hc = e.target.closest && e.target.closest('.hc');
  if (!hc || !app.ctrl || app.screen !== 'game' || (e.pointerType === 'mouse' && e.button !== 0)) return;
  var c = hc.getAttribute('data-card'), v = currentView(), lg = legalNow(v);
  var ways = lg.defend.filter(function (d) { return d.card === c; });
  if (lg.attack.indexOf(c) < 0 && !ways.length && lg.transfer.indexOf(c) < 0) return;
  press = { c: c, el: hc, x: e.clientX, y: e.clientY, ways: ways, drag: false, id: e.pointerId };
  // удержание карты: выбор нескольких карт одного достоинства (или подходящих к столу) для одного хода
  if (lg.attack.indexOf(c) >= 0 && hasGroup(v, lg) && !app.sel.length) {
    press.timer = setTimeout(function () { if (press && !press.drag) { app.sel = [c]; press.longDone = true; render(); } }, 450);
  }
});
appEl.addEventListener('pointermove', function (e) {
  if (!press || e.pointerId !== press.id) return;
  var dx = e.clientX - press.x, dy = e.clientY - press.y;
  if (!press.drag) {
    if (dy > -14 && Math.abs(dx) < 18) return;
    press.drag = true; clearTimeout(press.timer);
    app.drag = press;
    try { press.el.setPointerCapture(e.pointerId); } catch (er) { /* без захвата */ }
    press.el.classList.add('dragging');
    press.ways.forEach(function (w) { var p = appEl.querySelector('[data-pair="' + w.target + '"]'); if (p) p.classList.add('drop-ok'); });
  }
  press.el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1.08)';
  var over = pairUnder(e.clientX, e.clientY);
  appEl.querySelectorAll('[data-pair]').forEach(function (p) { p.classList.toggle('hover', Number(p.getAttribute('data-pair')) === over && p.classList.contains('drop-ok')); });
  e.preventDefault();
});
function endPress(e, cancel) {
  if (!press) return;
  var p = press; press = null; clearTimeout(p.timer);
  if (!p.drag) { if (p.longDone) app.skipClick = true; return; }
  app.skipClick = true; app.drag = null;
  p.el.classList.remove('dragging'); p.el.style.transform = '';
  appEl.querySelectorAll('.drop-ok, .hover').forEach(function (x) { x.classList.remove('drop-ok', 'hover'); });
  var done = false;
  if (!cancel && e) app.dropFrom = { x: e.clientX, y: e.clientY, cards: app.sel.indexOf(p.c) >= 0 ? app.sel.slice() : [p.c] };      // карта полетит с места, где её отпустили
  if (!cancel && e) {
    var v = currentView(), lg = legalNow(v), handTop = appEl.querySelector('.hand') ? appEl.querySelector('.hand').getBoundingClientRect().top : 9999;
    var over = pairUnder(e.clientX, e.clientY), way = p.ways.filter(function (w) { return w.target === over; })[0];
    if (way) { defendWith(p.c, way.target); done = true; }                           // бросил на карту стола — бьёт именно её
    else if (e.clientY < handTop - 10) {
      if (lg.attack.indexOf(p.c) >= 0) { playCards(app.sel.indexOf(p.c) >= 0 ? app.sel.slice() : [p.c]); done = true; }
      else if (p.ways.length === 1 && lg.transfer.indexOf(p.c) < 0) { defendWith(p.c, p.ways[0].target); done = true; }
      else if (!p.ways.length && lg.transfer.indexOf(p.c) >= 0) { app.ctrl.send({ type: 'transfer', seat: mySeat(), card: p.c }); done = true; }
      else if (p.ways.length) {                                                       // бить можно несколько — ближайшую к месту, куда бросил
        var best = null, bd = 1e9;
        p.ways.forEach(function (w) { var el = appEl.querySelector('[data-pair="' + w.target + '"]'); if (!el) return; var r = el.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - e.clientX) + Math.abs(r.top + r.height / 2 - e.clientY); if (d < bd) { bd = d; best = w; } });
        if (best) { defendWith(p.c, best.target); done = true; }
      }
    }
  }
  if (!done || app.renderLater) { app.renderLater = false; render(); }
}
appEl.addEventListener('pointerup', function (e) { endPress(e, false); });
appEl.addEventListener('pointercancel', function (e) { endPress(e, true); });

appEl.addEventListener('click', function (e) {
  if (app.skipClick) { app.skipClick = false; return; }       // это был свайп или удержание, а не нажатие
  var hc = e.target.closest('[data-card]');
  if (hc && app.ctrl && app.screen === 'game') { onCard(hc.getAttribute('data-card')); return; }
  var tg = e.target.closest('[data-target]');
  if (tg && app.ctrl && app.pick) { defendWith(app.pick, Number(tg.getAttribute('data-target'))); return; }
  var el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (window.DurakOnline && window.DurakOnline.click(el)) return;
  var act = el.getAttribute('data-act'), ctrl = app.ctrl, val = el.getAttribute('data-v');
  switch (act) {
    case 'theme': window.PlatformTheme.toggle(); break;
    case 'rules': app.rules = true; render(); break;
    case 'closeRules': app.rules = false; render(); break;
    case 'play': startGame(botController(app.level, app.variant, app.deck, app.players, app.neighbors)); break;
    case 'openSettings': app.settings = true; render(); break;
    case 'closeSettings': app.settings = false; render(); break;
    case 'neighbors': app.neighbors = !app.neighbors; render(); break;
    case 'playSel': playCards(app.sel.slice()); break;
    case 'unsel': app.sel = []; render(); break;
    case 'level': app.level = D.CONFIG.botLevels.indexOf(val) >= 0 ? val : 'medium'; render(); break;
    case 'variant': app.variant = val === 'perevodnoy' ? 'perevodnoy' : 'podkidnoy'; render(); break;
    case 'players': app.players = Math.max(2, Math.min(6, Number(val) || 2)); render(); break;
    case 'deck': app.deck = Number(val) === 52 ? 52 : 36; render(); break;
    case 'mode': app.mode = val === 'online' ? 'online' : 'bot'; render(); break;
    case 'exit': { var v2 = ctrl.view(), untouched = ctrl.bot && !ctrl.started(); if (!v2.gameOver && !untouched && !v2.seats[mySeat()].out) { app.confirm = true; render(); } else toMenu(); break; }      // с ботами до первого хода выходим без «Сдаться?»
    case 'stay': app.confirm = false; render(); break;
    case 'concede': app.confirm = false; ctrl.send({ type: 'concede', seat: ctrl.seat }); render(); break;
    case 'take': ctrl.send({ type: 'take', seat: mySeat() }); render(); break;
    case 'pass': ctrl.send({ type: 'pass', seat: mySeat() }); render(); break;
    case 'transfer': if (app.pick) { ctrl.send({ type: 'transfer', seat: mySeat(), card: app.pick }); app.pick = null; render(); } break;
    case 'unpick': app.pick = null; render(); break;
    case 'menu': toMenu(); break;
    case 'again': app.pick = null; app.sel = []; app.shownMove = -1; app.prevView = null; app.hold = null; app.realPrev = null; ctrl.again(); render(); break;
  }
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (app.rules) app.rules = false; else if (app.settings) app.settings = false; else if (app.confirm) app.confirm = false; else if (app.sel.length) app.sel = []; else if (app.pick) app.pick = null; else return;
  render();
});
window.PlatformTheme.onChange(function () { render(); });
render();
