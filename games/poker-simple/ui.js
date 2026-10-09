// ===== Интерфейс игры «Покер: просто» =====
// Все надписи берутся из словаря (games/poker-simple/ru.js) по ключам games.poker-simple.*.
// Правила и боты лежат в games/poker/ (logic.js, bots.js): здесь только экраны и ход партии «С ботами».
var CATALOG_URL = '../../index.html';
var tr = function (key, params) { return window.I18n.t('games.poker-simple.' + key, params); };
var PK = window.Poker, Bots = window.PokerBots, W = window.PlatformWallet, P = window.PlatformProfile, Cloud = window.PlatformCloud;
var appEl = document.getElementById('app');
var SOURCE = 'poker-simple';
var PREFS_KEY = 'game:poker-simple:prefs';
var DEN = [100, 150, 200, 250, 500, 750, 1000, 2000, 3000, 5000], HUE = [255, 215, 145, 85, 25, 350, 300, 195, 120, 50];
var HANDS = [['royalFlush', 'AS KS QS JS TS'], ['straightFlush', '9H 8H 7H 6H 5H'], ['quads', '8S 8H 8D 8C KD'], ['fullHouse', 'QS QD QC 4H 4S'], ['flush', 'AD JD 9D 6D 3D'],
  ['straight', '9C 8D 7S 6H 5C'], ['trips', '7S 7H 7D KC 2S'], ['twoPair', 'JS JD 4H 4C AS'], ['pair', 'TH TC AD 8S 3H'], ['high', 'AS JD 9C 6H 3S']];
var ANTES = [50, 100, 250], SIZES = [2, 3, 4, 5, 6], BOT_MODES = ['careful', 'mixed', 'risky'];
var BOT_DELAY = 800;

var app = { screen: 'start', rules: false, menu: false, combos: false, modal: null, prefs: loadPrefs(), bet: [], sheet: null, notice: null, noticeUntil: 0 };
var G = null;            // идущая партия: { state, botStack, spent, stage, holdUntil, prevBoardLen, timer }

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function now() { return Date.now(); }
function unit(n) { return window.I18n.plural(n, 'wallet.unit'); }
function loadPrefs() {
  var p = window.PlatformStorage.get(PREFS_KEY, null) || {};
  return { n: SIZES.indexOf(p.n) >= 0 ? p.n : 4, bots: BOT_MODES.indexOf(p.bots) >= 0 ? p.bots : 'mixed', ante: ANTES.indexOf(p.ante) >= 0 ? p.ante : 50 };
}
function savePrefs() { window.PlatformStorage.set(PREFS_KEY, app.prefs); }
function notify(text, ms) { app.notice = text; app.noticeUntil = now() + (ms || 5000); setTimeout(render, (ms || 5000) + 50); }
function activeNotice() {
  if (app.notice && now() > app.noticeUntil) app.notice = null;
  return app.notice;
}

// ===== Значки =====
function themeButtonHtml() {
  var dark = window.PlatformTheme.isDark();
  var icon = dark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 13.2A8.5 8.5 0 1 1 10.8 3a6.7 6.7 0 0 0 10.2 10.2z"/></svg>';
  return '<button class="icon-btn" data-act="theme" data-key="theme" aria-label="' + esc(window.I18n.t(dark ? 'theme.toLight' : 'theme.toDark')) + '">' + icon + '</button>';
}
var GRID_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/>' +
  '<rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg>';
function catalogLinkHtml() {
  return '<a class="icon-btn" href="' + CATALOG_URL + '" data-key="catalog" aria-label="' + esc(tr('toCatalog')) + '" title="' + esc(tr('toCatalog')) + '">' + GRID_SVG + '</a>';
}
function balHtml() { return '<div class="bal" data-key="bal">' + esc(fmt(W.getBalance()) + ' ' + tr('unitShort')) + '</div>'; }

// ===== Карты =====
function cardHtml(code, size, extra) {
  var cls = 'card ' + size + (extra ? ' ' + extra : '');
  if (code === null) return '<div class="' + cls + ' back"></div>';
  if (code === '') return '<div class="' + cls + ' empty"></div>';
  var rank = code.charAt(0) === 'T' ? '10' : code.charAt(0), suit = code.charAt(1), sym = tr('suit.' + suit);
  var red = suit === 'H' || suit === 'D';
  return '<div class="' + cls + (red ? ' red' : '') + '"><div class="tl">' + rank + '<br>' + sym + '</div><div class="mid">' + sym + '</div><div class="br">' + rank + '<br>' + sym + '</div></div>';
}
function miniHtml(code) {
  var rank = code.charAt(0) === 'T' ? '10' : code.charAt(0), suit = code.charAt(1);
  return '<span class="mini' + (suit === 'H' || suit === 'D' ? ' red' : '') + '">' + rank + tr('suit.' + suit) + '</span>';
}
function handName(key) { return tr('hand.' + key); }

// ===== Размещение мест за столом =====
function ring(n) {
  var small = (document.documentElement.clientWidth || window.innerWidth) < 360;
  var a = { 1: [270], 2: [235, 305], 3: [150, 270, 30], 4: [150, 240, 300, 30], 5: [150, 228, 270, 312, 30] }[n] || [];
  return a.map(function (deg) { var r = deg * Math.PI / 180; return { x: 50 + (small ? 37 : 40) * Math.cos(r), y: 55 + 40 * Math.sin(r) }; });
}
function botColor(i) { return 'oklch(' + (window.PlatformTheme.isDark() ? 0.42 : 0.86) + ' 0.07 ' + (i * 70 + 20) + ')'; }

// ===== Партия =====
function botSeats(n, mode) {
  var out = [];
  for (var i = 1; i < n; i++) {
    var bot = Bots.makeBot(i);
    if (mode === 'careful') bot.style = 'careful'; else if (mode === 'risky') bot.style = 'risky';
    out.push(bot);
  }
  return out;
}
function sitDown() {
  var ante = app.prefs.ante, balance = W.getBalance();
  if (balance < ante) return;
  W.capStart(now());
  var prof = P.getProfile();
  var seats = [{ id: 'me', name: prof.name || tr('you'), kind: 'human', chips: balance }].concat(botSeats(app.prefs.n, app.prefs.bots).map(function (b) { return Object.assign(b, { chips: balance }); }));
  G = { state: PK.init(seats, { variant: 'simple', ante: ante, minBet: ante * 2, tableSize: app.prefs.n }, null), botStack: balance, spent: 0, stage: null, holdUntil: 0, prevBoardLen: 0, timer: null, caption: '' };
  app.screen = 'table'; app.menu = false; app.combos = false; app.modal = null; app.sheet = null; app.bet = [];
  startHand();
}
function startHand() {
  var st = G.state;
  if (W.getBalance() < st.ante) { G.stage = 'broke'; render(); return; }
  st.seats[0].chips = W.getBalance();
  st.seats.forEach(function (s, i) { if (i > 0) { s.chips = G.botStack; s.sitOut = false; } });
  var r = PK.reduce(st, { type: 'deal', seat: 0 }, Math.random);
  if (!r.ok) { G.stage = 'broke'; render(); return; }
  G.state = r.state; G.stage = null; G.holdUntil = 0; G.prevBoardLen = 0; G.caption = '';
  app.sheet = null; app.bet = []; app.modal = null;
  W.markPlayed(); W.countPlay(SOURCE);
  spendSync();
  render(); pump();
}
// Деньги за столом списываются сразу: уйти посреди раздачи, не потеряв ставок, нельзя
function spendSync() {
  var total = G.state.seats[0].total;
  if (total > G.spent) { W.spend(total - G.spent, SOURCE, now()); G.spent = total; }
}
function apply(action) {
  var before = G.state, r = PK.reduce(before, action, Math.random);
  if (!r.ok) return false;
  G.state = r.state;
  spendSync();
  if (r.state.phase === 'settled') { onSettled(); return true; }
  if (r.state.board.length > before.board.length) {            // открылась следующая карта: короткая пауза с подписью
    G.prevBoardLen = before.board.length; G.holdUntil = now() + (reduced() ? 400 : 1000); G.caption = tr('cap.next');
    setTimeout(render, (reduced() ? 400 : 1000) + 20);
  }
  app.sheet = null; app.bet = [];
  render(); pump();
  return true;
}
function pump() {
  clearTimeout(G.timer);
  var st = G.state;
  if (G.stage || st.phase === 'waiting' || st.phase === 'settled' || st.current <= 0) return;
  var wait = Math.max(0, G.holdUntil - now()) + (reduced() ? 200 : BOT_DELAY + Math.random() * 400), token = G;
  G.timer = setTimeout(function () {
    if (G !== token || G.state.current <= 0) return;
    var a = Bots.nextBotAction(G.state, Math.random);
    if (!a || !apply(a)) apply({ type: G.state.currentBet > G.state.seats[G.state.current].bet ? 'fold' : 'check', seat: G.state.current });
  }, wait);
}
function onSettled() {
  var st = G.state, me = st.seats[0], payout = me.total + me.net;
  if (payout > 0) {
    var cr = W.capPayout(SOURCE, payout, G.spent, now());
    if (cr.capped) notify(tr(cr.granted > 0 ? 'cap.cut' : 'cap.reached', { n: fmt(cr.granted) }), 6000);
  }
  if (me.net > 0) W.countWin(SOURCE);
  G.spent = 0;
  app.sheet = null; app.bet = []; app.modal = null;
  G.caption = '';
  if (st.result && st.result.showdown) {
    G.stage = 'flip'; render();
    var token = G;
    setTimeout(function () { if (G === token && G.stage === 'flip') { G.stage = 'summary'; render(); } }, reduced() ? 600 : 1100);
  } else { G.stage = 'short'; render(); }
}
function backToTable() {
  G.stage = null;
  startHand();
}
function leaveTable() {
  if (G) clearTimeout(G.timer);
  G = null; app.screen = 'start'; app.modal = null; app.menu = false; app.combos = false; app.sheet = null; app.bet = [];
  render();
}
function inHand() { return !!G && (G.state.phase === 'preflop' || G.state.phase === 'flop' || G.state.phase === 'turn' || G.state.phase === 'river') && !G.state.seats[0].folded; }

// ===== Подготовка данных для экрана =====
function roundLabel(st) {
  if (G.stage === 'flip' || G.stage === 'summary' || (st.phase === 'settled' && st.result && st.result.showdown)) return tr('round.show');
  return { preflop: tr('round.pre'), flop: tr('round.flop'), turn: tr('round.turn'), river: tr('round.river') }[st.phase] || tr('round.wait');
}
function holding() { return !!G && now() < G.holdUntil; }
function shownBoardLen(st) { return holding() ? G.prevBoardLen : st.board.length; }
function statusOf(s) {
  var st = G.state, isMe = s.index === 0;
  if (!s.active) return '✕ ' + tr('st.left');
  if (G.stage === 'broke' && isMe) return tr('st.out');
  if (st.phase === 'settled') { if (s.net > 0 && s.inHand) return '★ ' + tr('st.win'); return s.folded ? '✕ ' + tr('st.fold') : ''; }
  if (st.phase === 'waiting' || !s.inHand) return '';
  if (s.folded) return '✕ ' + tr('st.fold');
  if (s.allIn) return '▲ ' + tr('st.allin');
  if (st.current === s.index && !holding()) return isMe ? tr('st.yourTurn') : '● ' + tr('st.turn');
  if (s.acted) {
    if (s.last === 'check') return '✓ ' + tr('st.check');
    if (s.last === 'call') return '✓ ' + tr('st.call');
    if (s.last === 'raise' || s.last === 'bet') return '▲ ' + tr('st.raise', { n: fmt(s.bet) });
  }
  return '… ' + tr('st.wait');
}
// Лучшие пять карт победителей (подсветка при вскрытии)
function winnerCodes(st) {
  var codes = {}, win = {};
  (st.pots || []).forEach(function (p) { (p.winners || []).forEach(function (i) { win[i] = true; }); });
  Object.keys(win).forEach(function (i) { var h = st.seats[i].hand; if (h) h.cards.forEach(function (c) { codes[c] = true; }); });
  return { codes: codes, win: win };
}

// ===== Экраны =====
function startHtml() {
  return '<div class="bar" data-key="bar">' + catalogLinkHtml() + '<div class="title">' + esc(tr('title')) + '</div><div class="right">' + themeButtonHtml() + balHtml() + '</div></div>' +
    '<div class="page" data-key="page"><div><div class="h1">' + esc(tr('title')) + '</div><div class="muted" style="font-size:14px;line-height:1.4">' + esc(tr('sub')) + '</div></div>' +
    '<div style="display:flex;flex-direction:column;gap:12px"><button class="btn primary full" data-act="play" data-key="play">' + esc(tr('play')) + '</button>' +
    '<button class="btn full" data-act="rules" data-key="rules">' + esc(tr('rules')) + '</button></div></div>';
}
function setupHtml() {
  var pr = app.prefs, bal = W.getBalance(), broke = bal < pr.ante, cap = W.capStatus(now());
  function seg(items, sel, act) {
    return '<div class="seg">' + items.map(function (it) { return '<button data-act="' + act + '" data-v="' + it.v + '" data-key="' + act + it.v + '" aria-pressed="' + (it.v === sel) + '">' + esc(it.t) + '</button>'; }).join('') + '</div>';
  }
  var dots = ring(pr.n - 1).concat([{ x: 50, y: 88 }]).map(function (p, i, a) { return '<div class="dot' + (i === a.length - 1 ? ' me' : '') + '" data-key="d' + i + '" style="left:' + p.x + '%;top:' + p.y + '%"></div>'; }).join('');
  return '<div class="bar" data-key="bar"><button class="icon-btn" data-act="toStart" data-key="back" aria-label="' + esc(tr('back')) + '">←</button><div class="title">' + esc(tr('modeBots')) + '</div><div class="right">' + themeButtonHtml() + balHtml() + '</div></div>' +
    '<div class="page" data-key="page">' +
    '<div><div class="lbl">' + esc(tr('setup.players')) + '</div>' + seg(SIZES.map(function (n) { return { v: n, t: String(n) }; }), pr.n, 'size') + '</div>' +
    '<div class="prev" data-key="prev"><div class="felt"></div>' + dots + '</div>' +
    '<div><div class="lbl">' + esc(tr('setup.bots')) + '</div>' + seg([{ v: 'careful', t: tr('setup.botsCareful') }, { v: 'mixed', t: tr('setup.botsMixed') }, { v: 'risky', t: tr('setup.botsRisky') }], pr.bots, 'bots') + '</div>' +
    '<div><div class="lbl">' + esc(tr('setup.ante')) + '</div>' + seg(ANTES.map(function (n) { return { v: n, t: String(n) }; }), pr.ante, 'ante') + '<div class="muted" style="font-size:13px;margin-top:6px">' + esc(tr('setup.minNote', { n: pr.ante * 2 })) + '</div></div>' +
    '<div class="stackline">' + esc(tr('setup.stack', { n: fmt(bal) + ' ' + unit(bal) })) + '</div>' +
    '<div class="capline">' + esc(tr('setup.cap', { n: fmt(cap.left) })) + '</div>' +
    (broke ? '<div class="warnbox">' + esc(tr('setup.broke', { n: pr.ante })) + '</div>' : '') +
    '<div style="display:flex"><button class="btn primary full" data-act="sit" data-key="sit"' + (broke ? ' disabled' : '') + '>' + esc(tr('setup.sit')) + '</button></div></div>';
}
function avatarStyle(i) { return 'background:' + botColor(i); }

function tableHtml() {
  var st = G.state, me = st.seats[0], n = st.seats.length, show = G.stage === 'flip' || G.stage === 'summary' || G.stage === 'short';
  var showdown = st.phase === 'settled' && st.result && st.result.showdown;
  var wc = showdown ? winnerCodes(st) : { codes: {}, win: {} };
  var boardN = shownBoardLen(st), la = (!G.stage && !holding() && st.current === 0) ? PK.legalActions(st, 0) : null;
  var pos = ring(n - 1);
  var seatsHtml = '', betsHtml = '';
  for (var i = 1; i < n; i++) {
    var s = st.seats[i], p = pos[i - 1], active = st.current === i && !G.stage && !holding();
    var cards = '';
    if (s.inHand && !s.folded) {
      if (showdown && s.shown) cards = s.cards.map(function (c) { return cardHtml(c, 'opp-card', 'flip' + (wc.win[s.index] ? ' hl' : ' dim')); }).join('');
      else cards = cardHtml(null, 'opp-card') + cardHtml(null, 'opp-card');
    }
    var bx = 50 + (p.x - 50) * 0.62, by = p.y < 45 ? p.y + 17 : p.y - 2;
    seatsHtml += '<div class="seat' + (s.folded ? ' folded' : '') + (active ? ' active' : '') + '" data-key="o' + i + '" style="left:' + p.x + '%;top:' + p.y + '%">' +
      '<div class="status">' + esc(statusOf(s)) + '</div><div class="box"><div class="ring' + (active ? ' active' : '') + '"><div class="av" style="' + avatarStyle(i) + '">' + esc(P.initial(s.name)) + '</div></div>' +
      '<div class="cards">' + cards + '</div><div class="nick">' + esc(s.name) + '</div></div></div>';
    if (s.bet > 0 && st.phase !== 'settled') betsHtml += '<div class="bet-pill" data-key="b' + i + '" style="left:' + bx + '%;top:' + by + '%"><span class="pot-dot"></span>' + fmt(s.bet) + '</div>';
  }
  var board = '';
  for (var k = 0; k < 5; k++) {
    if (k < boardN) { var c = st.board[k], mark = showdown ? (wc.codes[c] ? 'hl' : 'dim') : ''; board += cardHtml(c, 'board-card', mark); }
    else board += cardHtml('', 'board-card');
  }
  var mine = '';
  if (me.cards.length && me.inHand) mine = me.cards.map(function (c) { return cardHtml(c, 'mine-card', me.folded ? 'dim' : (showdown ? (wc.win[0] ? 'hl' : 'dim') : '')); }).join('');
  else mine = cardHtml('', 'mine-card') + cardHtml('', 'mine-card');
  var myActive = st.current === 0 && !G.stage && !holding();
  var prof = P.getProfile();
  var cap = G.caption && holding() ? G.caption : '';
  var toast = activeNotice();
  var covered = !!(G.stage || (app.sheet === 'raise' && la && la.raise));
  return '<div class="bar" data-key="bar"><button class="icon-btn" data-act="menu" data-key="menuBtn" aria-label="' + esc(tr('menu.aria')) + '">⋯</button><div class="title">' + esc(tr('title')) + '</div><div class="right">' + themeButtonHtml() + balHtml() + '</div></div>' +
    (toast ? '<div class="toast" role="status" data-key="toast"><div>' + esc(toast) + '</div></div>' : '') +
    '<div class="area" data-key="area"><div class="felt"></div><div class="center"><div class="round">' + esc(roundLabel(st)) + '</div><div class="board">' + board + '</div>' +
    '<div class="pot"><span class="pot-dot"></span>' + esc(tr('pot', { n: fmt(st.pot) })) + '</div>' + (cap ? '<div class="cap" role="status">' + esc(cap) + '</div>' : '') + '</div>' +
    seatsHtml + betsHtml + '</div>' +
    '<div class="me-row' + (covered ? ' hidden' : '') + '" data-key="me"><div class="me-box"><div class="me-status' + (myActive ? ' active' : '') + '">' + esc(statusOf(me)) + '</div><div class="ring' + (myActive ? ' active' : '') + '"><div class="av" style="background:' + P.avatarColor(prof.avatar) + ';width:calc(var(--avs) + 4px);height:calc(var(--avs) + 4px)">' + esc(P.initial(prof.name)) + '</div></div><div class="nm">' + esc(tr('you')) + '</div></div>' +
    '<div class="me-cards">' + mine + '</div><div class="me-bet">' + (me.bet > 0 && st.phase !== 'settled' ? '<div class="bet-pill" style="position:static;transform:none"><span class="pot-dot"></span>' + fmt(me.bet) + '</div>' : '') + '</div></div>' +
    actionsHtml(st, la) + sheetHtml(st, la);
}

function actionsHtml(st, la) {
  if (G.stage || st.phase === 'waiting' || st.phase === 'settled') return '';
  var wait = function (t) { return '<div class="actions" data-key="actions"><div class="btn-row"><button class="btn wait" disabled>' + esc(t) + '</button></div></div>'; };
  if (holding()) return wait(tr('act.waitCard'));
  if (st.current !== 0 || !la) return wait(st.current > 0 ? tr('act.waitFor', { name: st.seats[st.current].name }) : tr('act.waitBot'));
  var btn = function (cls, act, text) { return '<button class="btn ' + cls + '" data-act="' + act + '" data-key="a' + act + '">' + esc(text) + '</button>'; };
  var row = btn('', 'fold', tr('act.fold'));
  if (la.mustBet) row += la.raise ? btn('primary', 'raise', tr('act.betFrom', { n: fmt(la.raise.min) })) : btn('primary', 'allin', tr('bet.allin'));
  else {
    row += la.check ? btn('primary', 'check', tr('act.check')) : btn('primary', 'call', tr('act.call', { n: fmt(la.call) }));
    if (la.raise) row += btn('soft', 'raise', tr('act.raise'));
  }
  return '<div class="actions" data-key="actions">' + (la.mustBet ? '<div class="mand">' + esc(tr('mand')) + '</div>' : '') + '<div class="btn-row">' + row + '</div></div>';
}

// ===== Нижние панели: ставка, итог =====
function betSum() { return app.bet.reduce(function (a, b) { return a + b; }, 0); }
function sheetHtml(st, la) {
  if (G.stage === 'broke') return '<div class="sheet" role="region" data-key="broke"><h3>' + esc(tr('broke.title')) + '</h3><div class="muted" style="font-size:14px">' + esc(tr('broke.text')) + '</div><button class="btn primary full" data-act="leave" data-key="brokeLeave">' + esc(tr('broke.leave')) + '</button></div>';
  if (G.stage === 'short') {
    var w = st.seats.filter(function (s) { return s.net > 0; })[0], pay = w ? w.net + w.total : st.pot;
    return '<div class="sheet" role="region" aria-label="' + esc(tr('sum.aria')) + '" data-key="short"><h3>' + esc(w && w.index === 0 ? tr('sum.takesYou', { n: fmt(pay) }) : tr('sum.takes', { name: w ? w.name : '', n: fmt(pay) })) + '</h3>' + backButtons() + '</div>';
  }
  if (G.stage === 'summary') return summaryHtml(st);
  if (app.sheet === 'raise' && la && la.raise) return raiseHtml(st, la);
  return '';
}
function backButtons() {
  return '<div class="col"><button class="btn primary full" data-act="back" data-key="backBtn">' + esc(tr('sum.back')) + '</button><button class="btn full" data-act="leave" data-key="leaveBtn">' + esc(tr('sum.leave')) + '</button></div>';
}
function raiseHtml(st, la) {
  var sum = betSum(), min = la.raise.min, max = la.raise.max, onlyAllin = min >= max;
  var chips = DEN.map(function (v, i) { return { v: v, i: i }; }).filter(function (o) { return o.v <= max; }).map(function (o) {
    return '<button class="chip" style="--h:' + HUE[o.i] + '" data-act="chip" data-v="' + o.v + '" data-key="c' + o.v + '"' + (sum + o.v > max ? ' disabled' : '') + '>' + o.v + '</button>';
  }).join('');
  var stack = app.bet.slice(-8).map(function (v, j) { return '<span class="chip sm" style="--h:' + HUE[DEN.indexOf(v)] + '" data-key="s' + j + '">' + v + '</span>'; }).join('');
  var ok = !onlyAllin && sum >= min && sum <= max, label = la.mustBet || st.currentBet === 0 ? tr('bet.betN', { n: fmt(sum) }) : tr('bet.raiseTo', { n: fmt(sum) });
  var note = onlyAllin ? tr('bet.onlyAllin') : tr('bet.min', { n: fmt(min) }) + (sum < min ? tr('bet.short') : '');
  var hole = st.seats[0].cards.map(function (c) { return cardHtml(c, 'sum-card', 'tiny'); }).join('');
  return '<div class="sheet" data-key="raise"><div class="line"><div class="big">' + esc(tr('bet.sum', { n: fmt(sum) })) + '</div><div class="mine">' + hole + '</div><button class="btn-link" data-act="resetBet" data-key="resetBet">' + esc(tr('bet.reset')) + '</button></div>' +
    '<div class="stackrow"><button class="stack-btn" data-act="popBet" data-key="popBet" aria-label="' + esc(tr('bet.pop')) + '">' + (stack || '<span class="muted">' + esc(tr('bet.empty')) + '</span>') + '</button>' +
    '<button class="allin-btn" data-act="allin" data-key="allinBtn">' + esc(tr('bet.allin')) + '</button></div>' +
    '<div class="chips">' + chips + '</div><div class="muted" style="font-size:13px;text-align:center">' + esc(note) + '</div>' +
    '<div class="two"><button class="btn" data-act="cancelRaise" data-key="cancelRaise">' + esc(tr('bet.cancel')) + '</button><button class="btn primary" data-act="confirmRaise" data-key="confirmRaise"' + (ok ? '' : ' disabled') + '>' + esc(sum < min || onlyAllin ? tr('bet.raise') : label) + '</button></div></div>';
}
function mergedPots(st) {
  var out = [];
  (st.pots || []).forEach(function (p) {
    var key = p.eligible.join(',') + '|' + (p.winners || []).join(','), last = out[out.length - 1];
    if (last && last.key === key) last.amount += p.amount; else out.push({ key: key, amount: p.amount, eligible: p.eligible.slice(), winners: (p.winners || []).slice() });
  });
  return out;
}
function summaryHtml(st) {
  var rows = st.seats.filter(function (s) { return s.inHand; }).sort(function (a, b) { return (b.net > 0) - (a.net > 0) || a.index - b.index; }).map(function (s) {
    var pay = s.net + s.total, name = s.index === 0 ? tr('you') : s.name;
    var cards = s.folded ? '' : s.cards.map(function (c) { return cardHtml(c, 'sum-card', 'tiny'); }).join('');
    return '<div class="sum-row" data-key="r' + s.index + '"><div class="who"><b>' + esc(name) + '</b><span>' + esc(tr(s.folded ? 'sum.betFold' : 'sum.bet', { n: fmt(s.total) })) + '</span></div><div class="cards">' + cards + '</div>' +
      '<div class="combo' + (s.net > 0 ? '' : ' mute') + '">' + esc(!s.folded && s.hand ? handName(s.hand.name) : '') + '</div>' + (s.net > 0 ? '<div class="win">' + esc(tr('sum.win', { n: fmt(pay) })) + '</div>' : '') + '</div>';
  }).join('');
  var side = 0, lines = mergedPots(st).map(function (p, i) {
    var names = p.winners.map(function (w) { return w === 0 ? tr('you') : st.seats[w].name; }).join(', ');
    if (p.eligible.length === 1) return '<div class="ret" data-key="l' + i + '">' + esc(tr('sum.returned', { name: names, n: fmt(p.amount) })) + '</div>';
    var first = side++ === 0, tie = p.winners.length > 1, win = Math.floor(p.amount / p.winners.length);
    var key = first ? (tie ? 'sum.mainTie' : 'sum.main') : (tie ? 'sum.sideTie' : 'sum.side');
    return '<div data-key="l' + i + '">' + esc(tr(key, { n: fmt(p.amount), name: names, win: fmt(win), k: side - 1 })) + '</div>';
  }).join('');
  return '<div class="sheet" role="region" aria-label="' + esc(tr('sum.aria')) + '" data-key="summary"><div style="display:flex;flex-direction:column;gap:6px">' + rows + '</div>' +
    '<div style="font-size:15px;font-weight:700">' + esc(tr('sum.bank', { n: fmt(st.pot) })) + '</div><div class="sum-lines">' + lines + '</div>' + backButtons() + '</div>';
}

// ===== Окна =====
function modalHtml() {
  var out = '';
  if (app.menu) out += '<div class="menu-back" data-act="closeMenu" data-key="menuBack"></div><div class="menu" data-key="menu"><button data-act="rules" data-key="mRules">' + esc(tr('menu.rules')) + '</button><button data-act="combos" data-key="mCombos">' + esc(tr('menu.combos')) + '</button><button data-act="leaveAsk" data-key="mLeave">' + esc(tr('menu.leave')) + '</button></div>';
  if (app.combos) {
    out += '<div class="scrim" data-act="closeCombos" data-key="combosScrim"><div class="combos" role="dialog" aria-label="' + esc(tr('combos.title')) + '" data-key="combos"><div class="head"><span>' + esc(tr('combos.title')) + '</span><button class="icon-btn" data-act="closeCombos" data-key="combosX" aria-label="' + esc(tr('combos.close')) + '">✕</button></div>' +
      HANDS.map(function (h, i) { return '<div class="row" data-key="h' + i + '"><span class="n">' + (i + 1) + '</span><span class="name">' + esc(handName(h[0])) + '</span><span class="cards">' + h[1].split(' ').map(function (c) { return cardHtml(c, 'combo-card', 'tiny'); }).join('') + '</span></div>'; }).join('') + '</div></div>';
  }
  if (app.rules) {
    out += '<div class="scrim" data-key="rulesScrim"><div class="rules" role="dialog" aria-label="' + esc(tr('rules.title')) + '" data-key="rules"><div class="head"><h2>' + esc(tr('rules.title')) + '</h2><button class="btn" data-act="closeRules" data-key="rulesX">' + esc(tr('rules.close')) + '</button></div>' +
      '<ol>' + [1, 2, 3, 4, 5].map(function (k) { return '<li>' + esc(tr('rules.step' + k)) + '</li>'; }).join('') + '</ol>' +
      '<div style="font-weight:700">' + esc(tr('rules.strength')) + '</div><div class="hands">' + HANDS.map(function (h, i) { return '<div class="hand-row" data-key="rh' + i + '"><b>' + esc(handName(h[0])) + '</b><span class="mini-cards">' + h[1].split(' ').map(miniHtml).join('') + '</span></div>'; }).join('') + '</div>' +
      '<div class="note-card"><div style="font-weight:700">' + esc(tr('rules.mandTitle')) + '</div><p>' + esc(tr('rules.mandText', { n: app.prefs.ante * 2 })) + '</p></div></div></div>';
  }
  var m = app.modal;
  if (m) {
    var me = G ? G.state.seats[0] : null;
    var d = { fold: [tr('confirm.foldTitle'), tr('confirm.foldText'), tr('confirm.stay'), tr('confirm.fold'), 'doFold'],
      allin: [tr('confirm.allinTitle', { n: me ? fmt(me.chips) : '' }), tr('confirm.allinText'), tr('confirm.cancel'), tr('confirm.allin'), 'doAllin'],
      leave: [tr('confirm.leaveTitle'), tr('confirm.leaveText'), tr('confirm.stay'), tr('confirm.leave'), 'leave'] }[m];
    if (d) out += '<div class="scrim" data-key="modalScrim"><div class="modal" role="alertdialog" aria-modal="true" data-key="modal"><h2>' + esc(d[0]) + '</h2><p>' + esc(d[1]) + '</p><div class="row"><button class="btn primary" data-act="closeModal" data-autofocus data-key="mStay">' + esc(d[2]) + '</button><button class="btn" data-act="' + d[4] + '" data-key="mOk">' + esc(d[3]) + '</button></div></div></div>';
  }
  return out;
}

// ===== Отрисовка =====
function morph(from, to) {
  if (from.nodeType === 1 && to.nodeType === 1) {
    Array.prototype.slice.call(from.attributes).forEach(function (attr) { if (!to.hasAttribute(attr.name)) from.removeAttribute(attr.name); });
    Array.prototype.slice.call(to.attributes).forEach(function (attr) { if (from.getAttribute(attr.name) !== attr.value) from.setAttribute(attr.name, attr.value); });
  }
  var i = 0;
  while (i < to.childNodes.length) {
    var a = from.childNodes[i], b = to.childNodes[i];
    if (!a) from.appendChild(b.cloneNode(true));
    else if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName || (a.nodeType === 1 && a.getAttribute('data-key') !== b.getAttribute('data-key'))) from.replaceChild(b.cloneNode(true), a);
    else if (a.nodeType === 3) { if (a.data !== b.data) a.data = b.data; }
    else morph(a, b);
    i++;
  }
  while (from.childNodes.length > to.childNodes.length) from.removeChild(from.lastChild);
}
function screenHtml() {
  if (app.screen === 'table' && G) return tableHtml();
  if (app.screen === 'setup') return setupHtml();
  return startHtml();
}
function render() {
  var tpl = document.createElement('template');
  tpl.innerHTML = '<div class="screen" data-key="' + app.screen + '">' + screenHtml() + '</div>' + modalHtml();
  morph(appEl, tpl.content);
  var auto = appEl.querySelector('[data-autofocus]');
  if (auto && !auto.closest('.scrim').contains(document.activeElement)) auto.focus();
}

// ===== Нажатия =====
function chipAdd(v) {
  var st = G.state, la = PK.legalActions(st, 0);
  if (la && la.raise && betSum() + v <= la.raise.max) app.bet.push(v);
}
function doAction(type, extra) {
  if (!G || G.stage || G.state.current !== 0 || holding()) return;
  apply(Object.assign({ type: type, seat: 0 }, extra || {}));
}
function onClick(e) {
  var el = e.target.closest('[data-act]');
  if (!el) return;
  var act = el.getAttribute('data-act'), v = el.getAttribute('data-v');
  if (act === 'closeCombos' && e.target.closest('.combos') && el.classList.contains('scrim') && e.target !== el) return;
  switch (act) {
    case 'theme': window.PlatformTheme.toggle(); break;
    case 'play': app.screen = 'setup'; render(); break;
    case 'toStart': app.screen = 'start'; render(); break;
    case 'size': app.prefs.n = Number(v); savePrefs(); render(); break;
    case 'bots': app.prefs.bots = v; savePrefs(); render(); break;
    case 'ante': app.prefs.ante = Number(v); savePrefs(); render(); break;
    case 'sit': sitDown(); break;
    case 'rules': app.rules = true; app.menu = false; render(); break;
    case 'closeRules': app.rules = false; render(); break;
    case 'menu': app.menu = !app.menu; render(); break;
    case 'closeMenu': app.menu = false; render(); break;
    case 'combos': app.combos = true; app.menu = false; render(); break;
    case 'closeCombos': app.combos = false; render(); break;
    case 'leaveAsk': app.menu = false; if (inHand()) app.modal = 'leave'; else leaveTable(); render(); break;
    case 'leave': app.modal = null; leaveTable(); break;
    case 'closeModal': app.modal = null; render(); break;
    case 'fold': app.modal = 'fold'; render(); break;
    case 'doFold': app.modal = null; doAction('fold'); break;
    case 'check': doAction('check'); break;
    case 'call': doAction('call'); break;
    case 'raise': app.sheet = 'raise'; app.bet = []; render(); break;
    case 'chip': chipAdd(Number(v)); render(); break;
    case 'popBet': app.bet.pop(); render(); break;
    case 'resetBet': app.bet = []; render(); break;
    case 'cancelRaise': app.sheet = null; app.bet = []; render(); break;
    case 'confirmRaise': doAction('raise', { amount: betSum() }); break;
    case 'allin': app.modal = 'allin'; render(); break;
    case 'doAllin': app.modal = null; doAction('allin'); break;
    case 'back': backToTable(); break;
  }
}
appEl.addEventListener('click', onClick);
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (app.modal) app.modal = null; else if (app.combos) app.combos = false; else if (app.rules) app.rules = false; else if (app.menu) app.menu = false; else if (app.sheet) { app.sheet = null; app.bet = []; } else return;
  render();
});
window.PlatformTheme.onChange(function () { render(); });
window.PlatformWallet.onChange(function () { render(); });
window.addEventListener('resize', function () { if (app.screen !== 'start') render(); });
render();
