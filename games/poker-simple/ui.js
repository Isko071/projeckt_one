// ===== Интерфейс игры «Покер: Чожук» =====
// Все надписи берутся из словаря (games/poker-simple/ru.js) по ключам games.poker-simple.*.
// Ход партии ведёт shared/poker-core.js (с ботами или онлайн через сервер), правила и боты лежат в games/poker/: здесь только экраны.
var CATALOG_URL = '../../index.html';
var tr = function (key, params) { return window.I18n.t('games.poker-simple.' + key, params); };
var PK = window.Poker, Core = window.PokerCore, W = window.PlatformWallet, P = window.PlatformProfile, Cloud = window.PlatformCloud;
var appEl = document.getElementById('app');
var SOURCE = 'poker-simple', GAME_ID = 'poker-simple';
var PREFS_KEY = 'game:poker-simple:prefs';
var DEN = Core.DEN, HUE = Core.HUE;
var HANDS = [['royalFlush', 'AS KS QS JS TS'], ['straightFlush', '9H 8H 7H 6H 5H'], ['quads', '8S 8H 8D 8C KD'], ['fullHouse', 'QS QD QC 4H 4S'], ['flush', 'AD JD 9D 6D 3D'],
  ['straight', '9C 8D 7S 6H 5C'], ['trips', '7S 7H 7D KC 2S'], ['twoPair', 'JS JD 4H 4C AS'], ['pair', 'TH TC AD 8S 3H'], ['high', 'AS JD 9C 6H 3S']];
var ANTES = [50, 100, 250], SIZES = [2, 3, 4, 5, 6];
var ICON = { win: '★ ', fold: '✕ ', allin: '▲ ', turn: '● ', check: '✓ ', call: '✓ ', raise: '▲ ', wait: '… ', ready: '✓ ', skip: '– ', left: '✕ ', yourTurn: '', out: '', '': '' };
var IDLE_MS = 30000, ASK_MS = 7000;

var app = {
  deal: null, screen: 'start', mode: 'bots', rules: false, menu: false, combos: false, modal: null, prefs: loadPrefs(), bet: [], sheet: null,
  code: '', codeBad: false, bseen: 0, bfrom: 0, rooms: null, banner: null, err: null, busy: false, copied: false, invite: null
};
var T = null;            // стол: PokerCore (против ботов или онлайн)
var chat = window.PlatformChatUI.create({
  root: appEl,
  getView: function () { return T && T.ctrl ? T.ctrl.getView() : null; },
  myUid: function () { var u = Cloud.getState().user; return u ? u.uid : null; },
  send: function (text, cid) { return T && T.chatSend ? T.chatSend(text, cid) : false; },
  render: function () { render(); }
});
var net = window.PokerNet.create({ gameId: GAME_ID, variant: 'simple', Cloud: Cloud, onStatus: function (s) { setBanner(s); } });
var listTimer = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function now() { return Date.now(); }
function unit(n) { return window.I18n.plural(n, 'wallet.unit'); }
function loadPrefs() {
  var p = window.PlatformStorage.get(PREFS_KEY, null) || {};
  return { n: SIZES.indexOf(p.n) >= 0 ? p.n : 4, ante: ANTES.indexOf(p.ante) >= 0 ? p.ante : 50, size: SIZES.indexOf(p.size) >= 0 ? p.size : 4, closed: !!p.closed };
}
function savePrefs() { window.PlatformStorage.set(PREFS_KEY, app.prefs); }
function user() { return Cloud.getState().user; }
function signedIn() { return Cloud.getState().status === 'signedIn' && !!user(); }
function setBanner(s) {
  if (s === 'open') { if (app.banner === 'lost' || app.banner === 'wake') app.banner = 'back'; setTimeout(function () { if (app.banner === 'back') { app.banner = null; render(); } }, 3000); }
  else if (T || app.busy || app.screen === 'pick') app.banner = T && app.banner !== 'wake' && s === 'down' ? 'lost' : 'wake';
  render();
}

// ===== Значки =====
function themeButtonHtml(cls) {
  var dark = window.PlatformTheme.isDark();
  var icon = dark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 13.2A8.5 8.5 0 1 1 10.8 3a6.7 6.7 0 0 0 10.2 10.2z"/></svg>';
  return '<button class="' + (cls || 'icon-btn') + '" data-act="theme" data-key="theme" aria-label="' + esc(window.I18n.t(dark ? 'theme.toLight' : 'theme.toDark')) + '">' + icon + '</button>';
}
var GRID_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/>' +
  '<rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg>';
function catalogLinkHtml(cls) {
  return '<a class="' + (cls || 'icon-btn') + '" href="' + CATALOG_URL + '" data-key="catalog" aria-label="' + esc(tr('toCatalog')) + '" title="' + esc(tr('toCatalog')) + '">' + GRID_SVG + '</a>';
}
// Шапка экранов выбора, настройки и ожидания: слева назад или выход, посередине название, справа переключатель темы (как в «Ятзи»)
function headHtml(act, title, label) {
  return '<div class="o-head" data-key="head"><button class="theme-btn" data-act="' + act + '" data-key="back" aria-label="' + esc(label) + '">←</button><h2>' + esc(title) + '</h2>' + themeButtonHtml('theme-btn') + '</div>';
}
function balHtml() { return '<div class="bal" data-key="bal">' + esc(fmt(W.getBalance()) + ' ' + tr('unitShort')) + '</div>'; }
function bannerHtml() {
  if (!app.banner) return '';
  var k = { wake: 'net.wake', lost: 'net.lost', back: 'net.back' }[app.banner];
  return '<div class="banner ' + (app.banner === 'back' ? 'ok' : 'warn') + '" role="status" data-key="banner">' + esc(tr(k)) + '</div>';
}

// ===== Карты =====
function cardHtml(code, size, extra, attrs) {
  var cls = 'card ' + size + (extra ? ' ' + extra : ''), at = attrs || '';
  if (code === null) return '<div class="' + cls + ' back"' + at + '></div>';
  if (code === '') return '<div class="' + cls + ' empty"' + at + '></div>';
  var rank = code.charAt(0) === 'T' ? '10' : code.charAt(0), suit = code.charAt(1), sym = tr('suit.' + suit);
  var red = suit === 'H' || suit === 'D';
  return '<div class="' + cls + (red ? ' red' : '') + '"' + at + '><div class="tl">' + rank + '<br>' + sym + '</div><div class="mid">' + sym + '</div><div class="br">' + rank + '<br>' + sym + '</div></div>';
}
function miniHtml(code) {
  var rank = code.charAt(0) === 'T' ? '10' : code.charAt(0), suit = code.charAt(1);
  return '<span class="mini' + (suit === 'H' || suit === 'D' ? ' red' : '') + '">' + rank + tr('suit.' + suit) + '</span>';
}
function handName(key) { return tr('hand.' + key); }

// ===== Размещение мест за столом =====
function ring(n) {
  // Места соперников в процентах стола: боковые стоят выше, по бокам от общих карт; на узком экране ещё выше (над рядом общих карт) и ближе к краю
  var w = document.documentElement.clientWidth || window.innerWidth, k = w < 360 ? 0.86 : w < 500 ? 0.9 : 1;
  var t = { 1: [[50, 14]], 2: [[27, 20], [73, 20]], 3: [[12, 50], [50, 14], [88, 50]], 4: [[12, 52], [34, 17], [66, 17], [88, 52]], 5: [[11, 58], [24, 25], [50, 13], [76, 25], [89, 58]] }[n] || [];
  return t.map(function (p) { return { x: 50 + (p[0] - 50) * k, y: p[1] + (w < 500 && Math.abs(p[0] - 50) > 35 ? -14 : 0) }; });
}
function seatColor(i) { return 'oklch(' + (window.PlatformTheme.isDark() ? 0.42 : 0.86) + ' 0.07 ' + (i * 70 + 20) + ')'; }
function statusText(s) { return s.k ? ICON[s.k] + tr('st.' + s.k, { n: fmt(s.n || 0) }) : ''; }
function avatarOf(seat, i) {
  if (seat.isMe) { var prof = P.getProfile(); return { bg: P.avatarColor(prof.avatar), letter: P.initial(prof.name) }; }
  return { bg: seatColor(i), letter: P.initial(seat.name) };
}
function ringStyle(timer) {
  if (!timer) return '';
  var total = timer.stage === 'asking' ? ASK_MS : IDLE_MS, pct = Math.max(0, Math.min(1, timer.ms / total));
  return ' style="background:conic-gradient(var(--accent) ' + Math.round(pct * 360) + 'deg, var(--line) 0)"';
}

// ===== Партия =====
function sitDown() {
  var ante = app.prefs.ante;
  if (W.getBalance() < ante && W.capStatus(now()).left > 0) return;
  var prof = P.getProfile();
  T = Core.createSolo({ variant: 'simple', size: app.prefs.n, ante: ante, name: prof.name || tr('you'), wallet: W, source: SOURCE });
  bindTable(); app.screen = 'game'; app.menu = false; app.modal = null; app.sheet = null; app.bet = [];
  T.begin();
}
function bindTable() {
  T.subscribe(function (t) {
    if (T !== t) return;
    var m = t.model();
    if (m.closed && !app.err) { app.err = { k: 'closed' }; closeTable(); app.screen = 'err'; }
    else if (!m.lobby && app.screen === 'wait' || (m.lobby && app.screen === 'game')) app.screen = m.lobby ? 'wait' : 'game';
    if (m.stage === 'summary' || m.stage === 'short' || m.stage === 'broke' || m.phase === 'settled') { app.sheet = null; app.bet = []; }
    if (!m.lobby && !m.me.la) { app.sheet = null; app.bet = []; }
    render();
  });
}
function closeTable() {
  if (T) { T.leave(); T = null; }
  chat.reset();
  app.modal = null; app.menu = false; app.sheet = null; app.bet = []; app.combos = false;
}
function leaveTable() {
  var online = T && T.ctrl;
  closeTable();
  app.screen = online ? 'pick' : 'start';
  if (online) openPick();
  render();
}

// ===== Онлайн =====
function openOnlineMode() {
  if (!signedIn()) { app.mode = 'online'; render(); return; }
  openPick();
}
function openPick() {
  app.screen = 'pick'; app.err = null; app.rooms = null; app.code = ''; app.codeBad = false;
  refreshRooms();
  clearInterval(listTimer);
  listTimer = setInterval(function () { if (app.screen === 'pick') refreshRooms(); else { clearInterval(listTimer); listTimer = null; } }, 5000);
  render();
}
function refreshRooms() {
  var api = net.api();
  if (!api) return;
  api.listRooms().then(function (list) { app.rooms = list; if (app.screen === 'pick') render(); }, function () { app.rooms = app.rooms || []; if (app.screen === 'pick') render(); });
}
function errKey(e) {
  var c = e && e.code;
  return { 'not-found': 'notFound', full: 'full', started: 'started', closed: 'closed', 'wrong-game': 'notFound' }[c] || 'other';
}
function enterTable(promise) {
  app.busy = true; render();
  promise.then(function (res) {
    app.busy = false;
    var ctrl = res.host || res;
    T = Core.createOnline({ ctrl: ctrl, wallet: W, source: SOURCE, uid: user().uid, variant: 'simple', onWin: function () { if (window.PlatformRating) window.PlatformRating.reportWin('poker-simple'); } });
    T.ctrl = ctrl; bindTable();
    var m = T.model();
    app.screen = m && !m.lobby && !m.loading ? 'game' : 'wait'; app.err = null; app.copied = false;
    render();
  }, function (e) { app.busy = false; app.err = { k: errKey(e) }; app.screen = 'err'; render(); });
}
function createOnlineTable() {
  var api = net.api();
  if (!api || app.busy) return;
  var prof = P.getProfile(), ante = app.prefs.ante;
  enterTable(api.createRoom({ size: app.prefs.size, ante: ante, minBet: ante * 2, private: app.prefs.closed, name: prof.name, avatar: prof.avatar, chips: W.getBalance() }));
}
function joinOnlineTable(code) {
  var api = net.api();
  code = String(code || '').toUpperCase().trim();
  if (!api || app.busy) return;
  if (!/^[A-Z0-9]{5}$/.test(code)) { app.codeBad = true; render(); return; }
  var prof = P.getProfile();
  enterTable(api.joinRoom(code, { name: prof.name, avatar: prof.avatar, chips: W.getBalance() }));
}
function consumeInvite() {
  var code = app.invite;
  if (!code || !signedIn() || !net.available()) return;
  app.invite = null;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* адрес не обязателен */ }
  joinOnlineTable(code);
}

// ===== Экраны =====
var LOGO = '<div class="logo" aria-hidden="true"><div class="lc"><span>A</span><i>♠</i></div><div class="lc red"><span>K</span><i>♥</i></div></div>';
function startHtml() {
  var online = app.mode === 'online', avail = net.available(), needAuth = online && !signedIn();
  var modes = avail ? '<div class="field"><div class="field-title">' + esc(tr('start.mode')) + '</div><div class="modes" data-key="modes">' +
    '<button class="mode-btn" data-act="mode" data-v="bots" data-key="mbots" aria-pressed="' + !online + '">' + esc(tr('mode.bots')) + '</button>' +
    '<button class="mode-btn" data-act="mode" data-v="online" data-key="monline" aria-pressed="' + online + '">' + esc(tr('mode.online')) + '</button></div></div>' : '';
  return '<div class="start" data-key="start"><div class="brand-row"><div class="brand">' + LOGO + '<h1>' + esc(tr('title')) + '</h1></div>' +
    '<div class="top-actions">' + catalogLinkHtml('theme-btn') + themeButtonHtml('theme-btn') + '</div></div>' +
    '<div class="muted-text">' + esc(tr(online ? 'start.onlineSub' : 'sub')) + '</div>' + modes +
    (needAuth ? '<div class="note-card" data-key="auth"><div style="font-weight:700">' + esc(tr('login.need')) + '</div><p>' + esc(tr('login.text')) + '</p><div><button class="btn" data-act="signin" data-key="signin">' + esc(tr(app.busy ? 'login.busy' : 'login.btn')) + '</button></div></div>' : '') +
    '<div class="start-actions"><button class="btn-play" data-act="play" data-key="play"' + (needAuth ? ' disabled' : '') + '>' + esc(tr('play')) + '</button>' +
    '<button class="btn-secondary wide" data-act="rules" data-key="rules">' + esc(tr('rules')) + '</button></div>' +
    '<div class="bal-line" data-key="bal">' + esc(tr('balance', { n: fmt(W.getBalance()) + ' ' + unit(W.getBalance()) })) + '</div></div>';
}
function segHtml(items, sel, act) {
  return '<div class="seg">' + items.map(function (it) { return '<button data-act="' + act + '" data-v="' + it.v + '" data-key="' + act + it.v + '" aria-pressed="' + (it.v === sel) + '">' + esc(it.t) + '</button>'; }).join('') + '</div>';
}
function setupHtml() {
  var pr = app.prefs, bal = W.getBalance(), cap = W.capStatus(now()), broke = bal < pr.ante && cap.left > 0;
  var dots = ring(pr.n - 1).concat([{ x: 50, y: 88 }]).map(function (p, i, a) { return '<div class="dot' + (i === a.length - 1 ? ' me' : '') + '" data-key="d' + i + '" style="left:' + p.x + '%;top:' + p.y + '%"></div>'; }).join('');
  return '<div class="page" data-key="page">' + headHtml('toStart', tr('modeBots'), tr('back')) +
    '<div><div class="lbl">' + esc(tr('setup.players')) + '</div>' + segHtml(SIZES.map(function (n) { return { v: n, t: String(n) }; }), pr.n, 'size') + '</div>' +
    '<div class="prev" data-key="prev"><div class="felt"></div>' + dots + '</div>' +
    '<div><div class="lbl">' + esc(tr('setup.ante')) + '</div>' + segHtml(ANTES.map(function (n) { return { v: n, t: String(n) }; }), pr.ante, 'ante') + '<div class="muted" style="font-size:13px;margin-top:6px">' + esc(tr('setup.minNote', { n: pr.ante * 2 })) + '</div></div>' +
    '<div class="stackline">' + esc(tr('setup.stack', { n: fmt(bal) + ' ' + unit(bal) })) + '</div>' +
    '<div class="capline">' + esc(tr('setup.cap', { n: fmt(cap.left) })) + '</div>' +
    (broke ? '<div class="warnbox">' + esc(tr('setup.broke', { n: pr.ante })) + '</div>' : '') +
    '<div style="display:flex"><button class="btn primary full" data-act="sit" data-key="sit"' + (broke ? ' disabled' : '') + '>' + esc(tr('setup.sit')) + '</button></div></div>';
}
function pickHtml() {
  var code = app.code, bad = app.codeBad, rooms = app.rooms;
  var list;
  if (rooms === null) list = '<div class="rows">' + [1, 2, 3].map(function (k) { return '<div class="skel" data-key="sk' + k + '"></div>'; }).join('') + '</div>';
  else if (!rooms.length) list = '<div class="emptybox" data-key="empty">' + esc(tr('online.empty')) + '</div>';
  else list = '<div class="rows">' + rooms.map(function (r) {
    return '<div class="trow" data-key="r' + esc(r.code) + '"><div class="av-sm">' + esc(P.initial(r.hostName)) + '</div><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px">' + esc(r.hostName || r.code) + '</div><div class="muted" style="font-size:12px">' + esc(tr('online.count', { n: r.players, m: r.size })) + '</div></div>' +
      '<button class="btn primary sm" data-act="joinRoom" data-v="' + esc(r.code) + '" data-key="j' + esc(r.code) + '"' + (app.busy ? ' disabled' : '') + '>' + esc(tr('online.enter')) + '</button></div>';
  }).join('') + '</div>';
  var hint = bad ? tr('online.codeBad') : (code.length && code.length < 5 ? tr('online.codeMore', { n: 5 - code.length }) : tr('online.codeHint'));
  return '<div class="page tight" data-key="page">' + headHtml('toStart', tr('online.title'), tr('back')) + bannerHtml() +
    '<button class="btn primary full" data-act="toCreate" data-key="create">' + esc(tr('online.create')) + '</button>' +
    '<div style="display:flex;flex-direction:column;gap:6px"><div class="codeline"><input class="code-input' + (bad ? ' bad' : '') + '" id="code" data-key="code" maxlength="5" autocapitalize="characters" autocomplete="off" spellcheck="false" value="' + esc(code) + '" placeholder="' + esc(tr('online.code')) + '" aria-label="' + esc(tr('online.code')) + '">' +
    '<button class="btn" data-act="paste" data-key="paste">' + esc(tr('online.paste')) + '</button><button class="btn primary" data-act="joinCode" data-key="joinCode"' + (code.length === 5 && !app.busy ? '' : ' disabled') + '>' + esc(tr(app.busy ? 'online.busy' : 'online.join')) + '</button></div>' +
    '<div class="codehint' + (bad ? ' bad' : '') + '">' + esc(hint) + '</div></div>' +
    '<div class="lbl" style="margin:4px 0 0">' + esc(tr('online.open')) + '</div>' + list + '</div>';
}
function createHtml() {
  var pr = app.prefs;
  return '<div class="page" data-key="page">' + headHtml('toPick', tr('create.title'), tr('back')) +
    '<div><div class="lbl">' + esc(tr('create.seats')) + '</div>' + segHtml(SIZES.map(function (n) { return { v: n, t: String(n) }; }), pr.size, 'osize') + '</div>' +
    '<div><div class="lbl">' + esc(tr('setup.ante')) + '</div>' + segHtml(ANTES.map(function (n) { return { v: n, t: String(n) }; }), pr.ante, 'ante') + '<div class="muted" style="font-size:13px;margin-top:6px">' + esc(tr('setup.minNote', { n: pr.ante * 2 })) + '</div></div>' +
    '<button class="switch-row" role="switch" data-act="closedSw" data-key="closedSw" aria-checked="' + pr.closed + '"><span><b>' + esc(tr('create.closed')) + '</b><span class="muted" style="display:block;font-size:13px">' + esc(tr('create.closedSub')) + '</span></span><span class="knob' + (pr.closed ? ' on' : '') + '"><i></i></span></button>' +
    '<div style="display:flex"><button class="btn primary full" data-act="createGo" data-key="createGo"' + (app.busy ? ' disabled' : '') + '>' + esc(tr('create.go')) + '</button></div></div>';
}
function waitHtml(m) {
  var seats = [], pos = ring(Math.max(1, m.size - 1)).concat([{ x: 50, y: 88 }]);
  var order = m.members.slice().sort(function (a, b) { return (a.uid === user().uid ? -1 : 0) - (b.uid === user().uid ? -1 : 0) || a.seat - b.seat; });
  for (var i = 0; i < m.size; i++) {
    var p = i === 0 ? pos[pos.length - 1] : pos[i - 1], mem = order[i], me = mem && mem.uid === user().uid;
    seats.push('<div class="wseat" data-key="w' + i + '" style="left:' + p.x + '%;top:' + p.y + '%"><div class="av' + (mem ? '' : ' empty') + '" style="' + (mem ? 'background:' + (me ? P.avatarColor(P.getProfile().avatar) : seatColor(i)) : '') + ';width:40px;height:40px">' + esc(mem ? P.initial(mem.name) : '?') + '</div>' +
      '<div class="nm">' + esc(mem ? (me ? P.getProfile().name : mem.name) : tr('wait.free')) + '</div><div class="muted" style="font-size:12px">' + esc(mem && mem.uid === m.owner ? tr('wait.creator') : '') + '</div></div>');
  }
  var can = m.isOwner && m.members.length >= 2 && m.startIn === 0;
  var action = m.isOwner
    ? '<button class="btn primary" data-act="startGame" data-key="startGame"' + (can ? '' : ' disabled') + '>' + esc(m.members.length >= 2 && m.startIn > 0 ? tr('wait.in', { n: Math.ceil(m.startIn / 1000) }) : tr('wait.start')) + '</button>'
    : '<div class="muted" style="font-size:14px;text-align:right">' + esc(tr('wait.guest')) + '</div>';
  return '<div class="page tight" data-key="page">' + headHtml('leave', tr('wait.title'), tr('wait.leave')) + bannerHtml() +
    '<div style="text-align:center"><div class="muted" style="font-size:12px">' + esc(tr('wait.code')) + '</div><div style="font-size:34px;font-weight:700;letter-spacing:6px;line-height:1.1" data-key="codeBig">' + esc(m.code) + '</div>' + (m.private ? '<div class="muted" style="font-size:13px;font-weight:700">' + esc(tr('wait.private')) + '</div>' : '') + '</div>' +
    '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap"><button class="btn" data-act="copyCode" data-key="copy">' + esc(tr(app.copied ? 'wait.copied' : 'wait.copy')) + '</button><button class="btn" data-act="shareLink" data-key="share">' + esc(tr('wait.share')) + '</button></div>' +
    '<div class="prev wait" data-key="wprev"><div class="felt"></div>' + seats.join('') + '</div>' +
    '<div class="muted" style="font-size:12px;text-align:center">' + esc(tr('wait.params', { a: m.ante, m: m.minBet })) + '</div>' + chat.panelHtml({ mode: 'lobby' }) +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><button class="btn" data-act="leave" data-key="leaveWait">' + esc(tr('wait.leave')) + '</button>' + action + '</div></div>';
}
function errHtml() {
  var k = app.err ? app.err.k : 'other';
  return '<div class="page center" data-key="page">' + headHtml('toPick', tr('online.title'), tr('back')) + '<div class="note-card errcard"><div style="font-size:20px;font-weight:700">' + esc(tr('err.' + k)) + '</div><p>' + esc(tr('err.' + k + 'Text')) + '</p><button class="btn primary" data-act="toPick" data-key="errBtn">' + esc(tr('err.toPick')) + '</button></div></div>';
}

// ===== Раздача в начале руки =====
// Пока m.dealMs > 0, карты вылетают из центра стола к местам; смещение каждой карты считается один раз и запоминается в app.deal.fx
function dealState(m) {
  if (!(m.dealMs > 0)) { app.deal = null; return null; }
  if (!app.deal || app.deal.round !== m.round) app.deal = { round: m.round, fx: {} };
  return app.deal;
}
function launchDeal() {
  if (!app.deal) return;
  var origin = appEl.querySelector('.area .center');
  if (!origin) return;
  var o = origin.getBoundingClientRect(), cx = o.left + o.width / 2, cy = o.top + o.height / 2;
  Array.prototype.forEach.call(appEl.querySelectorAll('.card.dealfly[data-fly]'), function (c) {
    var key = c.getAttribute('data-fly');
    if (app.deal.fx[key] || key.charAt(0) === 'b') return;                  // общие карты летят с фиксированного места
    var anim = c.style.animation;
    c.style.animation = 'none';                                           // замер без учёта самой анимации
    var r = c.getBoundingClientRect();
    c.style.animation = anim;
    var fx = app.deal.fx[key] = { sx: Math.round(cx - (r.left + r.width / 2)), sy: Math.round(cy - (r.top + r.height / 2)) };
    c.style.setProperty('--sx', fx.sx + 'px'); c.style.setProperty('--sy', fx.sy + 'px');
  });
}

// ===== Стол =====
function tableHtml(m) {
  var me = m.seats[0], opp = m.seats.slice(1), pos = ring(opp.length);
  var seatsHtml = '', betsHtml = '';
  var deal = dealState(m), dealOrder = {};
  if (deal) {                                           // порядок раздачи: по кругу от места после кнопки, сначала по первой карте, потом по второй
    var ns = m.seats.length, di = 0, withCards = [];
    m.seats.forEach(function (x, i) { if (x.dealer) di = i; });
    for (var q = 1; q <= ns; q++) { var si = (di + q) % ns; if (m.seats[si].cards.length) withCards.push(si); }
    withCards.forEach(function (si, r) { dealOrder[si] = r; });
    dealOrder.n = withCards.length;
  }
  var fly = function (seatPos, ci, key) {
    if (!deal || dealOrder[seatPos] === undefined) return { cls: '', attrs: '' };
    var fx = deal.fx[key], d = 150 + (ci * dealOrder.n + dealOrder[seatPos]) * 180;
    return { cls: 'dealfly ', attrs: ' data-fly="' + key + '" style="animation-delay:' + d + 'ms' + (fx ? ';--sx:' + fx.sx + 'px;--sy:' + fx.sy + 'px' : '') + '"' };
  };
  opp.forEach(function (s, k) {
    var p = pos[k], av = avatarOf(s, k + 1), bx = 50 + (p.x - 50) * 0.62, by = p.y < 45 ? p.y + 17 : p.y - 2;
    var cards = s.cards.map(function (c, ci) { var f = fly(k + 1, ci, 'o' + s.index + ':' + ci); return cardHtml(c.code, 'opp-card', f.cls + (c.fold ? 'fold ' : '') + (c.flip ? 'flip d' + k + ' ' : '') + (c.hl ? 'hl ' : '') + (c.dim ? 'dim' : ''), f.attrs); }).join('');
    seatsHtml += '<div class="seat' + (s.folded || s.out ? ' folded' : '') + (s.turn ? ' active' : '') + '" data-key="o' + s.index + '" style="left:' + p.x + '%;top:' + p.y + '%">' +
      '<div class="status">' + esc(statusText(s.status)) + '</div><div class="box"><div class="ring' + (s.turn ? ' active' : '') + '"' + (s.turn ? ringStyle(s.timer) : '') + '><div class="av" style="background:' + av.bg + '">' + esc(av.letter) + '</div></div>' +
      '<div class="cards">' + cards + '</div><div class="nick">' + esc(s.name) + '</div></div></div>';
    if (s.bet > 0) betsHtml += '<div class="bet-pill" data-key="b' + s.index + '" style="left:' + bx + '%;top:' + by + '%"><span class="pot-dot"></span>' + fmt(s.bet) + '</div>';
  });
  var shown = m.board.filter(function (c) { return c.code; }).length;
  if (shown < app.bseen) { app.bseen = shown; app.bfrom = shown; } else if (shown > app.bseen) { app.bfrom = app.bseen; app.bseen = shown; }
  var board = m.board.map(function (c, b) {
    // общие карты тоже раздаются: после карт игрокам по очереди выезжают пять рубашек
    var bf = deal && dealOrder.n ? { cls: 'dealfly ', attrs: ' data-fly="b' + b + '" style="animation-delay:' + (150 + 2 * dealOrder.n * 180 + b * 140) + 'ms;--sx:0px;--sy:-70px"' } : { cls: '', attrs: '' };
    return cardHtml(c.code, 'board-card', bf.cls + (c.code && b >= app.bfrom ? 'flip d' + (b - app.bfrom) : (c.hl ? 'hl' : (c.dim ? 'dim' : ''))), bf.attrs);
  }).join('');
  var covered = !!(m.stage && m.stage !== 'flip' || (app.sheet === 'raise' && m.me.la && m.me.la.raise) || m.ask);
  var myAv = avatarOf(me, 0), mine = me.cards.length ? me.cards.map(function (c, ci) { var f = fly(0, ci, 'me:' + ci); return cardHtml(c.code, 'mine-card', f.cls + (c.fold ? 'fold ' : '') + (c.hl ? 'hl ' : '') + (c.dim ? 'dim' : ''), f.attrs); }).join('') : cardHtml('', 'mine-card') + cardHtml('', 'mine-card');
  var cap = m.caption ? tr('cap.next') : (m.ready && m.stage === 'ready' ? tr('ready.wait', { n: m.ready.count, m: m.ready.total }) : '');
  var notice = m.notice ? tr({ capCut: 'cap.cut', free: 'cap.free' }[m.notice.k] || 'cap.reached', { n: fmt(m.notice.n) }) : '';
  var toasts = (m.toasts || []).map(function (t, i) { return '<div data-key="t' + i + '">' + esc(tr('toast.' + t.k, { name: t.name })) + '</div>'; }).join('');
  var top = '<div class="bar wide" data-key="bar"><button class="icon-btn" data-act="menu" data-key="menuBtn" aria-label="' + esc(tr('menu.aria')) + '">⋯</button><div class="title">' + esc(tr('title')) + '</div><div class="right">' + (m.mode === 'online' ? chat.buttonHtml() : '') + themeButtonHtml() + '<div class="bal" data-key="bal">' + esc(fmt(m.me.stack) + ' ' + tr('unitShort')) + '</div></div></div>' + bannerHtml();
  return top + (notice || toasts ? '<div class="toast" role="status" data-key="toast">' + (notice ? '<div>' + esc(notice) + '</div>' : '') + toasts + '</div>' : '') +
    '<div class="area" data-key="area"><div class="felt"></div><div class="center"><div class="round">' + esc(tr('round.' + m.roundKey)) + '</div><div class="board">' + board + '</div>' +
    '<div class="pot"><span class="pot-dot"></span>' + esc(tr('pot', { n: fmt(m.pot) })) + '</div>' + (cap ? '<div class="cap" role="status">' + esc(cap) + '</div>' : '') + '</div>' + seatsHtml + betsHtml + '</div>' +
    '<div class="me-row' + (covered ? ' hidden' : '') + '" data-key="me"><div class="me-box"><div class="me-status' + (me.turn ? ' active' : '') + '">' + esc(statusText(me.status)) + '</div><div class="ring' + (me.turn ? ' active' : '') + '"' + (me.turn ? ringStyle(me.timer) : '') + '><div class="av" style="background:' + myAv.bg + ';width:calc(var(--avs) + 4px);height:calc(var(--avs) + 4px)">' + esc(myAv.letter) + '</div></div><div class="nm">' + esc(tr('you')) + '</div></div>' +
    '<div class="me-cards">' + mine + '</div><div class="me-bet">' + (me.bet > 0 ? '<div class="bet-pill" style="position:static;transform:none"><span class="pot-dot"></span>' + fmt(me.bet) + '</div>' : '') + '</div></div>' +
    actionsHtml(m) + sheetHtml(m);
}
function actionsHtml(m) {
  if (m.stage || m.phase === 'waiting' || m.phase === 'settled' || m.ask) return '';
  var wait = function (t) { return '<div class="actions" data-key="actions"><div class="btn-row"><button class="btn wait" disabled>' + esc(t) + '</button></div></div>'; };
  var la = m.me.la;
  if (m.dealMs > 0) return wait(tr('act.dealing'));
  if (m.pending) return wait(tr('act.sent'));
  if (m.me.holding) return wait(tr('act.waitCard'));
  if (!la) return wait(m.me.waitingFor ? tr('act.waitFor', { name: m.me.waitingFor }) : tr('act.waitBot'));
  var btn = function (cls, act, text) { return '<button class="btn ' + cls + '" data-act="' + act + '" data-key="a' + act + '">' + esc(text) + '</button>'; };
  var row = btn('', 'fold', tr('act.fold'));
  if (la.mustBet) row += la.raise ? btn('primary', 'raise', tr('act.betFrom', { n: fmt(la.raise.min) })) : btn('primary', 'allin', tr('bet.allin'));
  else {
    row += la.check ? btn('primary', 'check', tr('act.check')) : btn('primary', 'call', tr('act.call', { n: fmt(la.call) }));
    if (la.raise) row += btn('soft', 'raise', tr('act.raise'));
  }
  return '<div class="actions" data-key="actions">' + (la.mustBet ? '<div class="mand">' + esc(tr('mand')) + '</div>' : '') + '<div class="btn-row">' + row + '</div></div>';
}
function betSum() { return app.bet.reduce(function (a, b) { return a + b; }, 0); }
function backButtons() {
  return '<div class="col"><button class="btn primary full" data-act="back" data-key="backBtn">' + esc(tr('sum.back')) + '</button><button class="btn full" data-act="leave" data-key="leaveBtn">' + esc(tr('sum.leave')) + '</button></div>';
}
function sheetHtml(m) {
  if (m.ask) return askHtml(m.ask);
  if (m.stage === 'broke') return '<div class="sheet" role="region" data-key="broke"><h3>' + esc(tr('broke.title')) + '</h3><div class="muted" style="font-size:14px">' + esc(tr('broke.text')) + '</div><button class="btn primary full" data-act="leave" data-key="brokeLeave">' + esc(tr('broke.leave')) + '</button></div>';
  if (m.stage === 'short') {
    var w = m.summary.taker;
    return '<div class="sheet" role="region" aria-label="' + esc(tr('sum.aria')) + '" data-key="short"><h3>' + esc(w && w.isMe ? tr('sum.takesYou', { n: fmt(w.pay) }) : tr('sum.takes', { name: w ? w.name : '', n: fmt(w ? w.pay : m.pot) })) + '</h3>' + backButtons() + '</div>';
  }
  if (m.stage === 'summary') return summaryHtml(m);
  if (m.stage === 'ready') return '';
  if (app.sheet === 'raise' && m.me.la && m.me.la.raise) return raiseHtml(m);
  return '';
}
function askHtml(a) {
  if (a.k === 'ask') {
    var left = Math.ceil(a.ms / 1000), pct = Math.round(100 * a.ms / a.total);
    return '<div class="sheet" role="alertdialog" data-key="ask"><h3>' + esc(tr('ask.title')) + '</h3><div class="askrow"><div class="asknum" role="timer">' + left + '</div><div class="askbar"><i style="width:' + pct + '%"></i></div></div><div class="muted" style="font-size:14px">' + esc(tr('ask.text')) + '</div>' +
      '<div class="two"><button class="btn primary" data-act="here" data-key="here">' + esc(tr('ask.yes')) + '</button><button class="btn" data-act="leave" data-key="askLeave">' + esc(tr('ask.leave')) + '</button></div></div>';
  }
  if (a.k === 'auto') return '<div class="sheet" role="alertdialog" data-key="auto"><h3>' + esc(tr('ask.autoTitle')) + '</h3><div class="muted" style="font-size:14px">' + esc(tr('ask.autoText')) + '</div><button class="btn primary full" data-act="ackAuto" data-key="ackAuto">' + esc(tr('ask.ok')) + '</button></div>';
  return '<div class="sheet" role="alertdialog" data-key="out"><h3>' + esc(tr('ask.outTitle')) + '</h3><div class="muted" style="font-size:14px">' + esc(tr('ask.outText')) + '</div><button class="btn primary full" data-act="leave" data-key="outBtn">' + esc(tr('ask.toPick')) + '</button></div>';
}
function raiseHtml(m) {
  var la = m.me.la, sum = betSum(), min = la.raise.min, max = la.raise.max, onlyAllin = min >= max;
  var chips = DEN.map(function (v, i) { return { v: v, i: i }; }).filter(function (o) { return o.v <= max; }).map(function (o) {
    return '<button class="chip" style="--h:' + HUE[o.i] + '" data-act="chip" data-v="' + o.v + '" data-key="c' + o.v + '"' + (sum + o.v > max ? ' disabled' : '') + '>' + o.v + '</button>';
  }).join('');
  var stack = app.bet.slice(-8).map(function (v, j) { return '<span class="chip sm" style="--h:' + HUE[DEN.indexOf(v)] + '" data-key="s' + j + '">' + v + '</span>'; }).join('');
  var ok = !onlyAllin && sum >= min && sum <= max, label = la.mustBet || m.currentBet === 0 ? tr('bet.betN', { n: fmt(sum) }) : tr('bet.raiseTo', { n: fmt(sum) });
  var note = onlyAllin ? tr('bet.onlyAllin') : tr('bet.min', { n: fmt(min) }) + (sum < min ? tr('bet.short') : '');
  var hole = m.seats[0].cards.map(function (c) { return cardHtml(c.code, 'sum-card', 'tiny'); }).join('');
  return '<div class="sheet" data-key="raise"><div class="line"><div class="big">' + esc(tr('bet.sum', { n: fmt(sum) })) + '</div><div class="mine">' + hole + '</div><button class="btn-link" data-act="resetBet" data-key="resetBet">' + esc(tr('bet.reset')) + '</button></div>' +
    '<div class="stackrow"><button class="stack-btn" data-act="popBet" data-key="popBet" aria-label="' + esc(tr('bet.pop')) + '">' + (stack || '<span class="muted">' + esc(tr('bet.empty')) + '</span>') + '</button>' +
    '<button class="allin-btn" data-act="allin" data-key="allinBtn">' + esc(tr('bet.allin')) + '</button></div>' +
    '<div class="chips">' + chips + '</div><div class="muted" style="font-size:13px;text-align:center">' + esc(note) + '</div>' +
    '<div class="two"><button class="btn" data-act="cancelRaise" data-key="cancelRaise">' + esc(tr('bet.cancel')) + '</button><button class="btn primary" data-act="confirmRaise" data-key="confirmRaise"' + (ok ? '' : ' disabled') + '>' + esc(sum < min || onlyAllin ? tr('bet.raise') : label) + '</button></div></div>';
}
function summaryHtml(m) {
  var sm = m.summary, nm = function (n) { return n.isMe ? tr('you') : n.name; };
  var rows = sm.rows.map(function (r) {
    var cards = r.cards.map(function (c) { return cardHtml(c, 'sum-card', 'tiny'); }).join('');
    return '<div class="sum-row" data-key="r' + r.seat + '"><div class="who"><b>' + esc(r.isMe ? tr('you') : r.name) + '</b><span>' + esc(tr(r.folded ? 'sum.betFold' : 'sum.bet', { n: fmt(r.bet) })) + '</span></div><div class="cards">' + cards + '</div>' +
      '<div class="combo' + (r.win ? '' : ' mute') + '">' + esc(r.combo ? handName(r.combo) : '') + '</div>' + (r.win ? '<div class="win">' + esc(tr('sum.win', { n: fmt(r.win) })) + '</div>' : '') + '</div>';
  }).join('');
  var lines = sm.lines.map(function (l, i) {
    var names = l.names.map(nm).join(', ');
    if (l.k === 'returned') return '<div class="ret" data-key="l' + i + '">' + esc(tr('sum.returned', { name: names, n: fmt(l.amount) })) + '</div>';
    return '<div data-key="l' + i + '">' + esc(tr('sum.' + l.k, { n: fmt(l.amount), name: names, win: fmt(l.win), k: l.n })) + '</div>';
  }).join('');
  var wait = m.ready ? '<div class="muted" style="font-size:13px" data-key="rdy">' + esc(tr('ready.wait', { n: m.ready.count, m: m.ready.total })) + (m.ready.left >= 0 ? ' · ' + esc(tr('ready.left', { n: Math.ceil(m.ready.left / 1000) })) : '') + '</div>' : '';
  return '<div class="sheet" role="region" aria-label="' + esc(tr('sum.aria')) + '" data-key="summary"><div style="display:flex;flex-direction:column;gap:6px">' + rows + '</div>' +
    '<div style="font-size:15px;font-weight:700">' + esc(tr('sum.bank', { n: fmt(sm.bank) })) + '</div><div class="sum-lines">' + lines + '</div>' + wait + backButtons() + '</div>';
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
    var me = T && T.st ? T.st.seats[0] : null, chips = T ? T.model().me.chips : 0;
    void me;
    var d = { fold: [tr('confirm.foldTitle'), tr('confirm.foldText'), tr('confirm.stay'), tr('confirm.fold'), 'doFold'],
      allin: [tr('confirm.allinTitle', { n: fmt(chips) }), tr('confirm.allinText'), tr('confirm.cancel'), tr('confirm.allin'), 'doAllin'],
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
  if (app.screen === 'game' || app.screen === 'wait') {
    var m = T ? T.model() : null;
    if (!m || m.loading) return '<div class="page" data-key="loading"><div class="muted">' + esc(tr('online.busy')) + '</div></div>';
    if (m.lobby) return waitHtml(m);
    return tableHtml(m);
  }
  if (app.screen === 'setup') return setupHtml();
  if (app.screen === 'pick') return pickHtml();
  if (app.screen === 'create') return createHtml();
  if (app.screen === 'err') return errHtml();
  return startHtml();
}
function render() {
  // чат узнаёт о новых сообщениях из вида стола: без этого отправленные сообщения остаются «Не отправлено» и показываются дважды
  var cv = T && T.ctrl && T.ctrl.getView ? T.ctrl.getView() : null;
  if (cv) chat.update(cv, cv.status === 'playing' ? 'game' : 'lobby');
  var tpl = document.createElement('template');
  tpl.innerHTML = '<div class="screen" data-key="' + (T && app.screen === 'wait' ? 'wait' : app.screen) + '">' + screenHtml() + '</div>' + (app.screen === 'game' ? chat.panelHtml({ mode: 'game', myTurn: !!(T && T.model().me && T.model().me.la) }) + chat.extraHtml() : '') + modalHtml();
  var focus = document.activeElement && document.activeElement.id === 'code' ? document.activeElement.selectionStart : -1;
  morph(appEl, tpl.content);
  launchDeal();
  chat.afterRender();
  var auto = appEl.querySelector('[data-autofocus]');
  if (auto && !auto.closest('.scrim').contains(document.activeElement)) auto.focus();
  if (focus >= 0) { var ci = document.getElementById('code'); if (ci && document.activeElement !== ci) { ci.focus(); ci.setSelectionRange(focus, focus); } }
}

// ===== Нажатия =====
function chipAdd(v) {
  var m = T && T.model(), la = m && m.me && m.me.la;
  if (la && la.raise && betSum() + v <= la.raise.max) app.bet.push(v);
}
function onClick(e) {
  var el = e.target.closest('[data-act]');
  if (!el) return;
  var act = el.getAttribute('data-act'), v = el.getAttribute('data-v');
  if (act === 'closeCombos' && el.classList.contains('scrim') && e.target !== el) return;
  switch (act) {
    case 'theme': window.PlatformTheme.toggle(); break;
    case 'mode': app.mode = v; render(); break;
    case 'signin': if (!app.busy) { app.busy = true; render(); Cloud.signIn().then(function () { app.busy = false; if (app.mode === 'online' && signedIn()) openPick(); consumeInvite(); render(); }, function () { app.busy = false; render(); }); } break;
    case 'play': if (app.mode === 'online') openOnlineMode(); else { app.screen = 'setup'; render(); } break;
    case 'toStart': clearInterval(listTimer); app.screen = 'start'; render(); break;
    case 'size': app.prefs.n = Number(v); savePrefs(); render(); break;
    case 'osize': app.prefs.size = Number(v); savePrefs(); render(); break;
    case 'ante': app.prefs.ante = Number(v); savePrefs(); render(); break;
    case 'sit': sitDown(); break;
    case 'toPick': if (T) leaveTable(); else openPick(); break;
    case 'toCreate': app.screen = 'create'; render(); break;
    case 'closedSw': app.prefs.closed = !app.prefs.closed; savePrefs(); render(); break;
    case 'createGo': createOnlineTable(); break;
    case 'joinRoom': joinOnlineTable(v); break;
    case 'joinCode': joinOnlineTable(app.code); break;
    case 'paste': if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(function (t) { app.code = String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); app.codeBad = false; render(); }, function () { /* буфер недоступен */ }); break;
    case 'copyCode': if (navigator.clipboard && T && T.model().code) navigator.clipboard.writeText(T.model().code).then(function () { app.copied = true; render(); setTimeout(function () { app.copied = false; render(); }, 2000); }, function () { /* без буфера */ }); break;
    case 'shareLink': shareLink(); break;
    case 'startGame': if (T && T.start) T.start(); break;
    case 'rules': app.rules = true; app.menu = false; render(); break;
    case 'closeRules': app.rules = false; render(); break;
    case 'menu': app.menu = !app.menu; render(); break;
    case 'closeMenu': app.menu = false; render(); break;
    case 'combos': app.combos = true; app.menu = false; render(); break;
    case 'closeCombos': app.combos = false; render(); break;
    case 'leaveAsk': app.menu = false; if (T && T.inHand()) app.modal = 'leave'; else leaveTable(); render(); break;
    case 'leave': app.modal = null; leaveTable(); break;
    case 'closeModal': app.modal = null; render(); break;
    case 'fold': app.modal = 'fold'; render(); break;
    case 'doFold': app.modal = null; T.act('fold'); break;
    case 'check': T.act('check'); break;
    case 'call': T.act('call'); break;
    case 'raise': app.sheet = 'raise'; app.bet = []; render(); break;
    case 'chip': chipAdd(Number(v)); render(); break;
    case 'popBet': app.bet.pop(); render(); break;
    case 'resetBet': app.bet = []; render(); break;
    case 'cancelRaise': app.sheet = null; app.bet = []; render(); break;
    case 'confirmRaise': app.sheet = null; T.act('raise', { amount: betSum() }); app.bet = []; break;
    case 'allin': app.modal = 'allin'; render(); break;
    case 'doAllin': app.modal = null; app.sheet = null; T.act('allin'); break;
    case 'back': T.back(); break;
    case 'here': T.here(); break;
    case 'ackAuto': T.ackAuto(); break;
  }
}
function shareLink() {
  var m = T && T.model(); if (!m || !m.code) return;
  var url = location.origin + location.pathname + '#' + m.code;
  if (navigator.share) navigator.share({ url: url }).then(null, function () { /* отменено */ });
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { app.copied = true; render(); setTimeout(function () { app.copied = false; render(); }, 2000); }, function () { /* без буфера */ });
}
appEl.addEventListener('click', onClick);
appEl.addEventListener('input', function (e) {
  if (e.target.id === 'code') { app.code = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); app.codeBad = false; render(); }
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (app.modal) app.modal = null; else if (app.combos) app.combos = false; else if (app.rules) app.rules = false; else if (app.menu) app.menu = false; else if (app.sheet) { app.sheet = null; app.bet = []; } else return;
  render();
});
window.addEventListener('pagehide', function () { if (T) { try { T.leave(); } catch (e) { /* закрываем страницу */ } } });
window.PlatformTheme.onChange(function () { render(); });
window.PlatformWallet.onChange(function () { render(); });
Cloud.onChange(function () { consumeInvite(); if (app.screen === 'start') render(); });
window.addEventListener('resize', function () { if (app.screen !== 'start') render(); });
setInterval(function () { if (T) { T.tick(); render(); } }, 1000);
(function () { var h = String(location.hash || '').replace('#', '').toUpperCase(); if (/^[A-Z0-9]{5}$/.test(h)) { app.invite = h; app.mode = 'online'; } })();
render();
