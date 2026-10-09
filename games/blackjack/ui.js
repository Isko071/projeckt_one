// ===== Интерфейс игры «Блэкджек» =====
// Все надписи берутся из словаря (games/blackjack/ru.js) по ключам games.blackjack.*.
// Два режима: «С ботом» (локально, на logic.js) и «Онлайн» (комнаты в Firestore, shared/rooms.js).
var CATALOG_URL = '../../index.html';
var tr = function (key, params) { return window.I18n.t('games.blackjack.' + key, params); };
var BJ = window.Blackjack, W = window.PlatformWallet, P = window.PlatformProfile, Cloud = window.PlatformCloud;
var appEl = document.getElementById('app');
var MIN_BET = BJ.CONFIG.minBet;
// Ставок нет: движок играет с условной ставкой, а игрок получает только награду (кошелёк не списывается)
var FLAT_BET = MIN_BET, VIRTUAL_CHIPS = 100000, REWARD = { win: 250, blackjack: 400 };
var ROOM_CFG = window.PlatformRooms ? window.PlatformRooms.DEFAULTS : { idleMs: 30000, askMs: 7000, extendMs: 15000, nextDelayMs: 10000 };

var app = {
  screen: 'start', startMode: 'bot', modal: null, size: 4, fillBots: true, private: false,
  code: '', codeError: null, tableError: null, rooms: null, busy: false, loginError: null, copied: false,
  notice: null, noticeUntil: 0, resultAt: 0, pending: false, banner: null, seen: {}, settledAt: 0, closedReason: null, askShown: false
};
var G = null;            // текущая игра: { mode: 'bot' | 'online', ... }
var gameToken = 0;       // растёт при выходе из игры: отменяет отложенные действия бота
var hostTimer = null, pollTimer = null, roomsTimer = null, clockTimer = null;
var roomsApi = null, wsApi = null;

// Чат стола (shared/chat-ui.js): только в онлайн-режиме
var chat = window.PlatformChatUI.create({
  root: appEl,
  getView: function () { return G && G.mode === 'online' ? G.view : null; },
  myUid: function () { var u = Cloud.getState().user; return u ? u.uid : null; },
  send: function (text, cid) { return G && G.mode === 'online' ? G.ctrl.send({ type: 'chat', text: text, cid: cid }) : false; },
  render: function () { render(); }
});
function chatMode(v) { return v && v.status === 'playing' ? 'game' : 'lobby'; }
function chatOverlayHtml() {
  if (!G || G.mode !== 'online' || app.screen !== 'game') return '';
  var D = describe(), myTurn = !!(D && D.me !== null && D.vs.phase === 'playing' && D.vs.current === D.me);
  return chat.panelHtml({ mode: 'game', myTurn: myTurn }) + chat.extraHtml();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function unit(n) { return window.I18n.plural(n, 'wallet.unit'); }
function now() { return Date.now(); }
function viewport() { return (document.documentElement.clientWidth || window.innerWidth) - (typeof chat !== 'undefined' && chat ? chat.sideWidth() : 0); }

// ===== Тема и значки =====
function themeButtonHtml(cls) {
  var dark = window.PlatformTheme.isDark();
  var icon = dark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 13.2A8.5 8.5 0 1 1 10.8 3a6.7 6.7 0 0 0 10.2 10.2z"/></svg>';
  return '<button class="icon-btn ' + (cls || '') + '" data-act="theme" data-key="theme" aria-label="' + esc(window.I18n.t(dark ? 'theme.toLight' : 'theme.toDark')) + '">' + icon + '</button>';
}
var GRID_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/>' +
  '<rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg>';
function catalogLinkHtml(cls) {
  return '<a class="icon-btn ' + (cls || '') + '" href="' + CATALOG_URL + '" data-key="catalog" aria-label="' + esc(tr('toCatalog')) + '" title="' + esc(tr('toCatalog')) + '">' + GRID_SVG + '</a>';
}
function catalogButtonHtml() {
  return '<button class="icon-btn" data-act="exit" data-key="catalog" aria-label="' + esc(tr('toCatalog')) + '" title="' + esc(tr('toCatalog')) + '">' + GRID_SVG + '</button>';
}

// ===== Карты и фишки (по макету) =====
var GLYPH = { s: '♠', c: '♣', h: '♥', d: '♦' };
function cardParts(code) {
  if (!code || code === '??') return { down: true };
  var r = code.charAt(0);
  return { down: false, rank: r === 'T' ? '10' : r, suit: code.charAt(1).toLowerCase() };
}
var PIP_L = 0.31, PIP_C = 0.5, PIP_R = 0.69;
var PIPS = {
  2: [[PIP_C, 0], [PIP_C, 1]], 3: [[PIP_C, 0], [PIP_C, .5], [PIP_C, 1]],
  4: [[PIP_L, 0], [PIP_R, 0], [PIP_L, 1], [PIP_R, 1]],
  5: [[PIP_L, 0], [PIP_R, 0], [PIP_C, .5], [PIP_L, 1], [PIP_R, 1]],
  6: [[PIP_L, 0], [PIP_R, 0], [PIP_L, .5], [PIP_R, .5], [PIP_L, 1], [PIP_R, 1]],
  7: [[PIP_L, 0], [PIP_R, 0], [PIP_C, .25], [PIP_L, .5], [PIP_R, .5], [PIP_L, 1], [PIP_R, 1]],
  8: [[PIP_L, 0], [PIP_R, 0], [PIP_C, .25], [PIP_L, .5], [PIP_R, .5], [PIP_C, .75], [PIP_L, 1], [PIP_R, 1]],
  9: [[PIP_L, 0], [PIP_R, 0], [PIP_L, 1 / 3], [PIP_R, 1 / 3], [PIP_C, .5], [PIP_L, 2 / 3], [PIP_R, 2 / 3], [PIP_L, 1], [PIP_R, 1]],
  10: [[PIP_L, 0], [PIP_R, 0], [PIP_C, 1 / 6], [PIP_L, 1 / 3], [PIP_R, 1 / 3], [PIP_L, 2 / 3], [PIP_R, 2 / 3], [PIP_C, 5 / 6], [PIP_L, 1], [PIP_R, 1]]
};
function cardHtml(code, w, extra) {
  var c = cardParts(code), h = w * 1.4, cls = 'pcard' + (extra && extra.cls ? ' ' + extra.cls : '');
  var style = 'width:' + w + 'px;height:' + h + 'px;border-radius:' + (w * 0.08) + 'px;' + (extra && extra.delay ? 'animation-delay:' + extra.delay + 'ms;' : '');
  if (c.down) {
    return '<div class="' + cls + '" style="' + style + '" role="img" aria-label="' + esc(tr('card.down')) + '"><div class="back" style="inset:' + (w * 0.07) + 'px;border-radius:' + (w * 0.05) + 'px;background-size:' + (w * 0.2) + 'px ' + (w * 0.2) + 'px"></div></div>';
  }
  var glyph = GLYPH[c.suit] + '︎', col = (c.suit === 'h' || c.suit === 'd') ? 'var(--suit-red)' : 'var(--suit-black)';
  var idx = 'font-size:' + (w * 0.2) + 'px;min-width:' + (w * 0.2) + 'px;color:' + col + ';' + (c.rank === '10' ? 'letter-spacing:' + (-w * 0.015) + 'px;' : '');
  var sub = 'font-size:' + (w * 0.18) + 'px;margin-top:' + (w * 0.01) + 'px';
  var out = '<div class="' + cls + '" style="' + style + 'color:' + col + '" role="img" aria-label="' + esc(tr('card.name', { rank: c.rank, suit: tr('suit.' + c.suit) })) + '">' +
    '<div class="idx" style="' + idx + 'left:' + (w * 0.06) + 'px;top:' + (w * 0.04) + 'px"><div>' + c.rank + '</div><div style="' + sub + '">' + glyph + '</div></div>' +
    '<div class="idx" style="' + idx + 'right:' + (w * 0.06) + 'px;bottom:' + (w * 0.04) + 'px;transform:rotate(180deg)"><div>' + c.rank + '</div><div style="' + sub + '">' + glyph + '</div></div>';
  var pos = c.rank === 'A' ? [[PIP_C, 0.5]] : (PIPS[parseInt(c.rank, 10)] || []);
  var fs = c.rank === 'A' ? w * 0.55 : w * 0.22;
  pos.forEach(function (p) {
    out += '<div class="pip" style="left:' + (p[0] * w) + 'px;top:' + (h * 0.2 + p[1] * h * 0.6) + 'px;transform:translate(-50%,-50%)' + (p[1] > 0.5 && c.rank !== 'A' ? ' rotate(180deg)' : '') + ';font-size:' + fs + 'px;color:' + col + '">' + glyph + '</div>';
  });
  if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') {
    out += '<div class="face" style="left:' + (w * 0.27) + 'px;right:' + (w * 0.27) + 'px;top:' + (h * 0.17) + 'px;bottom:' + (h * 0.17) + 'px;border:1.5px solid ' + col + ';border-radius:' + (w * 0.05) + 'px;font-size:' + (w * 0.42) + 'px">' + c.rank + '</div>' +
      '<div class="pip" style="left:' + (w * 0.3) + 'px;top:' + (h * 0.18) + 'px;font-size:' + (w * 0.15) + 'px;color:' + col + '">' + glyph + '</div>' +
      '<div class="pip" style="right:' + (w * 0.3) + 'px;bottom:' + (h * 0.18) + 'px;font-size:' + (w * 0.15) + 'px;color:' + col + ';transform:rotate(180deg)">' + glyph + '</div>';
  }
  return out + '</div>';
}
var CHIP_COLOR = { 25: 'oklch(0.48 0.04 260)', 50: 'oklch(0.5 0.15 250)', 100: 'oklch(0.32 0.03 260)', 250: 'oklch(0.52 0.14 45)', 500: 'oklch(0.46 0.16 315)', 1000: 'oklch(0.45 0.12 150)', 2000: 'oklch(0.42 0.15 20)' };

// Ряд карт внахлёст. fresh-карты (ещё не показанные) выезжают по очереди.
var renderPass = { fresh: 0, keys: [] };
function cardsRow(zone, codes, w, avail, maxStep) {
  var n = codes.length, step = n > 1 ? Math.min(maxStep || w * 0.7, (avail - w) / (n - 1)) : 0, out = '';
  codes.forEach(function (code, i) {
    var key = zone + ':' + i + ':' + code, extra = {};
    if (!app.seen[key]) {
      var flip = code !== '??' && app.seen[zone + ':' + i + ':??'];
      extra = { cls: flip ? 'flip' : 'fresh', delay: Math.min(renderPass.fresh * (flip ? 400 : 120), 1200) };
      renderPass.fresh++;
    }
    renderPass.keys.push(key);
    out += '<div style="flex:none;margin-left:' + (i ? step - w : 0) + 'px">' + cardHtml(code, w, extra) + '</div>';
  });
  return out;
}

// ===== Размеры стола =====
function layout(nOthers) {
  var vw = viewport(), desk = vw >= 700, narrow = vw < 360;
  var Wf = Math.min(vw - 20, 760), F = (desk ? 520 : (narrow ? 440 : 500)) + (!desk && nOthers >= 3 ? 50 : 0); // на телефоне 4 соседних места требуют стол повыше
  return { vw: vw, desk: desk, narrow: narrow, Wf: Wf, F: F, Wi: Wf - 10, Fi: F - 10, PW: desk ? 120 : (narrow ? 66 : 76) };
}
var ANG = { 1: [190], 2: [170, 10], 3: [165, 300, 15], 4: [165, 215, 325, 15] };
function platePos(L, i, n) {
  var a = (ANG[n] || ANG[4])[i] * Math.PI / 180, rx = L.Wi / 2 - L.PW / 2 - 6, ry = L.Fi / 2 - (L.desk ? 80 : 70);
  return 'width:' + L.PW + 'px;left:' + (L.Wi / 2 + rx * Math.cos(a)) + 'px;top:' + (L.Fi / 2 + ry * Math.sin(a)) + 'px';
}

// ===== Данные для отрисовки =====
// Единый взгляд на игру: состояние стола (без колоды), номер своего места, таймеры и участники.
function describe() {
  if (!G) return null;
  if (G.mode === 'bot') {
    var vs = BJ.view(G.state);
    vs.seats[0].name = P.getProfile().name;
    return { mode: 'bot', vs: vs, me: 0, timers: [], members: [], online: false };
  }
  var v = G.view;
  if (!v || !v.state) return null;
  return { mode: 'online', vs: v.state, me: v.seat === undefined ? null : v.seat, timers: v.timers || [], received: v.receivedAt || now(), members: v.members || [], online: true, view: v };
}
function timerFor(D, seat) {
  var t = D.timers.filter(function (x) { return x.seat === seat; })[0];
  if (!t) return null;
  var left = Math.max(0, t.ms - (D.mode === 'online' ? now() - D.received : 0));
  var total = t.stage === 'idle' ? ROOM_CFG.idleMs : (t.stage === 'asking' ? ROOM_CFG.askMs : ROOM_CFG.extendMs);
  return { stage: t.stage, left: left, total: total, sec: Math.ceil(left / 1000) };
}
function memberOf(D, seat) {
  return D.members.filter(function (m) { return m.seat === seat; })[0] || null;
}
function seatHand(seat) { return seat && seat.hands && seat.hands[0] ? seat.hands[0] : null; }
function sumOf(codes) { return BJ.handValue(codes).total; }
function seatSumText(seat, mine) {
  var h = seatHand(seat);
  if (!h || !h.cards.length) return '';
  var v = BJ.handValue(h.cards);
  if (BJ.isBust(h)) return mine ? tr('sum.bust', { n: v.total }) : String(v.total);
  if (BJ.isNatural(h)) return mine ? tr('sum.bj') : String(v.total);
  if (mine && v.soft && v.total < 21) return tr('sum.soft', { n: v.total });
  return String(v.total);
}
// Подпись состояния места: [текст, тон]
function seatStatus(D, idx) {
  var vs = D.vs, s = vs.seats[idx], h = seatHand(s), tm = timerFor(D, idx);
  if (!s.active) return [tr('st.left'), ''];
  if (vs.phase === 'betting') {
    return [s.sitOut ? tr('st.skips') : tr('st.deals'), ''];
  }
  if (vs.phase === 'settled' && h) {
    var oc = h.outcome, win = oc === 'win' || oc === 'blackjack';
    return [tr('res.' + (oc === 'blackjack' ? 'bj' : (oc === 'win' || oc === 'push' || oc === 'bust' ? oc : 'lose'))), win ? 'good' : (oc === 'push' ? '' : 'bad')];
  }
  if (!h) return [s.sitOut ? tr('st.skips') : '', ''];
  if (BJ.isBust(h)) return [tr('st.bust'), 'bad'];
  if (BJ.isNatural(h)) return [tr('st.bj'), 'good'];
  if (vs.phase === 'playing' && vs.current === idx) {
    if (tm && tm.stage === 'asking') return [tr('st.silent'), 'bad'];
    return [tm && tm.stage === 'idle' ? tr('st.thinksSec', { n: tm.sec }) : tr('st.thinks'), ''];
  }
  if (h.done) return [tr('st.stand'), ''];
  return [tr('st.waits'), ''];
}
function activeSeat(D, idx) {
  var vs = D.vs;
  if (vs.phase === 'playing') return vs.current === idx;
  if (vs.phase === 'betting') return !!timerFor(D, idx);
  return false;
}
function myOutcome(D) {
  var s = D.vs.seats[D.me], h = seatHand(s);
  if (!h) return null;
  var dealerBj = BJ.handValue(D.vs.dealer.cards).total === 21 && D.vs.dealer.cards.length === 2;
  var key = h.outcome === 'blackjack' ? 'bj' : (h.outcome === 'bust' ? 'bust' : (h.outcome === 'push' ? 'push' : (h.outcome === 'win' ? 'win' : (dealerBj ? 'dealerBj' : 'lose'))));
  var me = sumOf(h.cards), dl = sumOf(D.vs.dealer.cards);
  var rw = G && G.rw && G.rw.round === D.vs.round ? G.rw : null, got = rw ? rw.granted : 0, capped = !!(rw && rw.capped && !rw.granted);
  var sub = { win: tr('res.subWin'), bj: tr('res.subBj'), push: tr('res.subPush'), lose: tr('res.subLose', { a: me, b: dl }), bust: tr('res.subBust'), dealerBj: tr('res.subDealerBj') }[key];
  if (capped) sub = tr('cap.reached');
  var delta = got > 0 ? tr('res.delta.plus', { n: fmt(got), unit: unit(got) }) : tr('res.delta.zero');
  return { key: key, title: tr('res.' + key), sub: sub, delta: delta, tone: got > 0 || key === 'win' || key === 'bj' ? 'good' : (key === 'push' ? '' : 'bad'), net: got };
}
// ===== Уведомления =====
function notify(text, ms) { app.notice = text; app.noticeUntil = now() + (ms || 4000); }
function activeNotice() {
  if (app.notice && now() > app.noticeUntil) app.notice = null;
  return app.notice;
}

// ===== Плавное вскрытие =====
// Раздача заканчивается мгновенно (перебор, 21), но на экране всё идёт по шагам: пауза, чтобы осмыслить свою руку,
// переворот закрытой карты дилера, карты дилера по одной и только потом итог.
var SEQ = { pause: 1100, flip: 550, gap: 850, after: 900 };
function scheduleSeq(st) {
  var r = reduced(), t0 = now();
  var seq = { round: st.round, revealAt: t0 + (r ? 0 : SEQ.pause), times: {}, end: 0 };
  var t = seq.revealAt + (r ? 0 : SEQ.flip);
  for (var i = 2; i < st.dealer.cards.length; i++) { t += r ? 0 : SEQ.gap; seq.times[i] = t; }
  seq.end = t + (r ? 0 : SEQ.after);
  app.seq = seq; app.resultAt = seq.end;
  if (!r) [seq.revealAt].concat(Object.keys(seq.times).map(function (k) { return seq.times[k]; }), [seq.end]).forEach(function (ts) { setTimeout(render, Math.max(0, ts - now()) + 20); });
}

// ===== Сессия «С ботом» =====
// Награда за раздачу: победа 250, блэкджек 400, ничья и проигрыш без награды; за день не больше предела (W.rewardStatus)
function rewardOf(outcome) { return REWARD[outcome] || 0; }
function grantReward(outcome) {
  var want = rewardOf(outcome), r = want ? W.reward('blackjack', want, now()) : { granted: 0, capped: false, left: W.rewardStatus('blackjack', now()).left };
  G.rw = { round: G.state.round, want: want, granted: r.granted, capped: r.capped, left: r.left };
  if (want) W.countWin('blackjack');
  if (r.capped) notify(tr(r.granted > 0 ? 'cap.cut' : 'cap.reached', { n: fmt(r.granted) }), 6000);
}

function startLocal() {
  gameToken++; chat.reset();
  stopOnline();
  var st = BJ.init([{ id: 'me', name: P.getProfile().name, chips: VIRTUAL_CHIPS, kind: 'human' }], { simple: true });
  G = { mode: 'bot', state: st, settledRound: -1 };
  app.screen = 'game'; app.modal = null; app.resultAt = 0; app.seq = null; app.seen = {}; app.pending = false;
  render();
  localDeal();
}
function lDispatch(action) {
  var before = G.state.phase, r = BJ.reduce(G.state, action);
  if (!r.ok) return false;
  G.state = r.state;
  var st = G.state;
  if (before === 'betting' && st.phase !== 'betting') { W.markPlayed(); W.countPlay('blackjack'); }
  if (st.phase === 'settled' && G.settledRound !== st.round) {
    G.settledRound = st.round;
    var mine = seatHand(st.seats[0]);
    G.rw = null;
    if (mine) grantReward(mine.outcome);
    scheduleSeq(st);
  }
  return true;
}
function runBots() {
  var token = gameToken;
  (function step() {
    if (token !== gameToken || !G || G.mode !== 'bot') return;
    var a = BJ.nextBotAction(G.state);
    if (!a) return;
    lDispatch(a); render();
    setTimeout(step, reduced() ? 0 : 700);
  })();
}
// Своя ставка, ставка бота и раздача
function localDeal() {
  if (!lDispatch({ type: 'bet', seat: 0, amount: FLAT_BET })) return;
  var a;
  while ((a = BJ.nextBotAction(G.state)) && G.state.phase === 'betting') lDispatch(a);
  lDispatch({ type: 'deal', seat: 0 });
  app.seen = {};
  render();
  runBots();
}
function localNext() {
  if (!lDispatch({ type: 'next', seat: 0 })) return;
  G.state.seats[0].chips = VIRTUAL_CHIPS;
  app.seen = {}; app.resultAt = 0; app.seq = null;
  render();
  localDeal();
}

// ===== Сессия «Онлайн» =====
function stopOnline() {
  [hostTimer, pollTimer, roomsTimer].forEach(function (t) { if (t) clearInterval(t); });
  hostTimer = pollTimer = roomsTimer = null;
}
// Создатель стола: при игре через сервер это игрок, на которого указывает вид стола; без сервера — хост в браузере
function isOwner() {
  if (!G || G.mode !== 'online') return false;
  if (G.role === 'host') return true;
  var u = Cloud.getState().user;
  return !!(G.ctrl && G.ctrl.server && G.view && u && G.view.owner === u.uid);
}
function serverStatus(s) {
  if (!(G && G.mode === 'online') && !app.busy) return;
  if (s === 'open') { if (app.banner === 'server') app.banner = 'back'; } else if (app.banner !== 'relogin') app.banner = 'server';
  render();
}
function getRooms() {
  var st = Cloud.getState();
  if (!st.user) return null;
  if (window.GAME_SERVER_URL && window.PlatformRoomsWS) {
    if (!wsApi || wsApi.uid !== st.user.uid) {
      if (wsApi) wsApi.shutdown();
      wsApi = window.PlatformRoomsWS.create({ url: window.GAME_SERVER_URL, getToken: function () { return Cloud.getToken(); }, uid: st.user.uid, engine: window.PlatformRooms, engineEnv: { game: BJ, gameOptions: { simple: true } }, game: 'blackjack' });
      wsApi.uid = st.user.uid; wsApi.onStatus(serverStatus);
    }
    roomsApi = wsApi;
    return roomsApi;
  }
  roomsApi = window.PlatformRooms.create({
    fetch: function (u, i) { return window.fetch(u, i); }, getToken: function () { return Cloud.getToken(); }, uid: st.user.uid,
    projectId: window.FIREBASE_CONFIG.projectId, db: window.FIREBASE_DATABASE, game: BJ, gameOptions: { simple: true }
  });
  return roomsApi;
}
function errorKey(e) {
  var c = e && e.code;
  if (c === 'not-found') return 'notFound';
  if (c === 'full') return 'full';
  if (c === 'closed') return 'closed';
  if (c === 'denied') return 'denied';
  if (c === 'missing') return 'missing';
  if (!c || c === 'network' || /^http-/.test(c)) return 'network';
  return 'other';
}
function loadRooms() {
  var api = getRooms();
  if (!api) return;
  api.listRooms().then(function (list) { app.rooms = list; app.banner = null; if (app.screen === 'tables') render(); }, function (e) { app.rooms = app.rooms || []; if (e && (e.code === 'missing' || e.code === 'denied')) app.tableError = errorKey(e); if (app.screen === 'tables') render(); });
}
function openTables() {
  app.screen = 'tables'; app.tableError = null; app.codeError = null; app.rooms = null; app.modal = null;
  render();
  loadRooms();
  roomsTimer = setInterval(function () { if (app.screen === 'tables') loadRooms(); }, 5000);
}
function backOnline() {
  app.banner = 'back'; render();
  setTimeout(function () { if (app.banner === 'back') { app.banner = null; render(); } }, 3000);
}
function onView(v) {
  if (!G || G.mode !== 'online') return;
  G.view = v;
  chat.update(v, chatMode(v));
  app.pending = false;
  if (v.closed || v.hostGone) { handleClosed(v); return; }
  var st = v.state;
  if (v.status === 'playing' && st) {
    if (app.screen === 'lobby') { app.screen = 'game'; app.seen = {}; app.banner = null; if (isOwner() && !G.ctrl.server) notify(tr('notice.creator'), 6000); }
    var me = v.seat;
    if (me === null || me === undefined || !st.seats[me] || !st.seats[me].active) {
      if (!G.left) { G.left = true; handleLeft(); }
      return;
    }
    var seat = st.seats[me];
    // уведомления о таймере: ответили «играю» или ход поставлен автоматически
    var mineTimer = (v.timers || []).filter(function (t) { return t.seat === me; })[0], stage = mineTimer ? mineTimer.stage : null;
    if (G.prevStage === 'asking' && stage === 'extended') notify(tr('notice.extended'), 5000);
    else if ((G.prevStage === 'asking' || G.prevStage === 'extended') && !stage && now() - (G.lastAction || 0) > 2000) notify(tr('notice.auto'), 5000);
    G.prevStage = stage;
    if (st.phase === 'settled' && G.settledRound !== st.round) {
      G.settledRound = st.round; app.settledAt = now();
      var h = seatHand(seat);
      G.rw = null;
      if (h) grantReward(h.outcome);
      scheduleSeq(st);
    }
    // Ставок нет: в начале раздачи отправляем условную ставку сами
    if (st.phase === 'betting' && G.betRound !== st.round) { G.betRound = st.round; app.seen = {}; if (!seat.sitOut && !(seat.bet > 0)) onlineSend({ type: 'bet', amount: FLAT_BET }); }
    if (st.phase === 'playing' && G.playedRound !== st.round) { G.playedRound = st.round; W.markPlayed(); W.countPlay('blackjack'); }
  }
  render();
}
function handleClosed(v) {
  stopOnline(); chat.reset();
  app.closedReason = v.hostGone ? 'hostGone' : 'closed';
  G = null; app.screen = 'closed'; app.modal = null;
  render();
}
function handleLeft() {
  stopOnline(); chat.reset();
  var ctrl = G && G.ctrl;
  if (ctrl && G.role === 'player') ctrl.stop();
  G = null; app.screen = 'out'; app.modal = null;
  render();
}
function onlineProfile() { var p = P.getProfile(); return { name: p.name, avatar: p.avatar, chips: VIRTUAL_CHIPS }; }
function createTable() {
  var api = getRooms();
  if (!api || app.busy) return;
  app.busy = true; render();
  var prof = onlineProfile();
  api.createRoom({ size: app.size, fillBots: app.fillBots, private: app.private, name: prof.name, avatar: prof.avatar, chips: prof.chips }).then(function (res) {
    stopOnline();
    var host = res.host;
    chat.reset();
    G = { mode: 'online', role: host.server ? 'player' : 'host', ctrl: host, view: host.getView(), code: res.code, settledRound: -1 };
    chat.update(G.view, 'lobby');
    host.onChange(onView);
    var failing = 0;
    if (host.server) {
      pollTimer = setInterval(function () { host.poll().then(function () { if (failing) { failing = 0; backOnline(); } }, function () { if (++failing >= 3) { app.banner = 'offline'; render(); } }); }, 1000);
    } else hostTimer = setInterval(function () {
      host.tick().then(function () { if (failing) { failing = 0; backOnline(); } }, function () { if (++failing >= 3) { app.banner = 'offline'; render(); } });
    }, 1000);
    app.busy = false; app.screen = 'lobby'; app.modal = null; app.copied = false; app.banner = null;
    render();
  }, function (e) { app.busy = false; app.tableError = errorKey(e); app.screen = 'tables'; render(); });
}
function joinTable(code) {
  code = String(code || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{5}$/.test(code)) { app.codeError = 'shortCode'; render(); return; }
  var api = getRooms();
  if (!api || app.busy) return;
  app.busy = true; app.codeError = null; render();
  var prof = onlineProfile();
  api.joinRoom(code, prof).then(function (ctrl) {
    stopOnline();
    chat.reset();
    G = { mode: 'online', role: 'player', ctrl: ctrl, view: null, code: code, settledRound: -1 };
    ctrl.onChange(onView);
    var failing = 0;
    var poll = function () { ctrl.poll().then(function () { if (failing) { failing = 0; backOnline(); } }, function () { if (++failing >= 3) { app.banner = 'offline'; render(); } }); };
    pollTimer = setInterval(poll, 1000); poll();
    app.busy = false; app.screen = 'lobby'; app.modal = null; app.banner = null; app.tableError = null;
    render();
  }, function (e) { app.busy = false; app.tableError = errorKey(e); render(); });
}
// Отправка своего действия за онлайн-столом
function onlineSend(action) {
  if (!G || G.mode !== 'online') return;
  G.lastAction = now();
  if (G.role === 'host') { G.ctrl.send(action); G.ctrl.tick().catch(function () { /* повторит таймер */ }); render(); return; }
  app.pending = true; render();
  G.ctrl.send(action).catch(function () { app.pending = false; app.banner = 'offline'; render(); });
}
function leaveGame(toScreen) {
  gameToken++; chat.reset();
  var g = G;
  stopOnline();
  G = null;
  if (g && g.mode === 'online') {
    if (g.role === 'host') g.ctrl.close(); else g.ctrl.leave();
  }
  app.modal = null; app.banner = null; app.pending = false;
  if (toScreen === 'tables') openTables(); else { app.screen = 'start'; render(); }
}

// ===== Вёрстка экранов =====
function topbarHtml() {
  var L = layout(), bal = W.getBalance();
  var balText = L.narrow ? tr('balanceShort', { n: fmt(bal) }) : tr('balanceFull', { n: fmt(bal), unit: unit(bal) });
  return '<div class="topbar">' + catalogButtonHtml() +
    '<div class="title">' + (L.narrow ? '' : esc(window.I18n.t('games.blackjack.title'))) + '</div>' +
    '<button class="icon-btn" data-act="rules" data-key="rules" aria-label="' + esc(tr('rulesBtn')) + '">?</button>' +
    (G && G.mode === 'online' && app.screen === 'game' ? chat.buttonHtml() : '') + themeButtonHtml('') + '<div class="bal-chip" data-key="bal">' + esc(balText) + '</div></div>';
}

var LOGO = '<div class="logo" aria-hidden="true"><div class="lc"><span>A</span><i>♠</i></div><div class="lc red"><span>10</span><i>♥</i></div></div>';
function startHtml() {
  var bal = W.getBalance(), online = app.startMode === 'online';
  var modes = '<div class="field"><div class="field-title">' + esc(tr('start.mode')) + '</div><div class="modes">' +
    '<button class="mode-btn" data-act="pickMode" data-v="bot" data-key="bot" aria-pressed="' + !online + '">' + esc(tr('modeBot')) + '<small>' + esc(tr('modeBotSub')) + '</small></button>' +
    '<button class="mode-btn" data-act="pickMode" data-v="online" data-key="online" aria-pressed="' + online + '">' + esc(tr('modeOnline')) + '<small>' + esc(tr('modeOnlineSub')) + '</small></button></div></div>';
  return '<div class="start" data-key="start"><div class="brand-row"><div class="brand">' + LOGO + '<h1>' + esc(window.I18n.t('games.blackjack.title')) + '</h1></div>' +
    '<div class="top-actions">' + catalogLinkHtml('theme-btn') + themeButtonHtml('theme-btn') + '</div></div>' +
    '<div class="muted-text">' + esc(tr('tagline')) + '</div>' + modes +
    '<div class="start-actions"><button class="btn-play" data-act="play" data-key="play">' + esc(tr('start.play')) + '</button>' +
    '<button class="btn-secondary wide" data-act="rules" data-key="rules">' + esc(tr('rules')) + '</button></div>' +
    '<div class="bal-line">' + esc(tr('balance', { n: fmt(bal), unit: unit(bal) })) + '</div></div>';
}

function loginHtml() {
  var st = Cloud.getState(), busy = app.busy;
  var msg = '';
  if (st.status === 'unsupported') msg = tr('login.unsupported');
  else if (app.loginError) msg = tr('login.' + app.loginError);
  return '<div class="page"><div class="page-head"><button class="icon-btn" data-act="toStart" data-key="back" aria-label="' + esc(tr('back')) + '">←</button><h2>' + esc(tr('login.title')) + '</h2>' + themeButtonHtml('') + '</div>' +
    '<div class="card-box"><p style="margin:0 0 12px;font-size:16px">' + esc(tr('login.text')) + '</p>' +
    '<button class="btn accent big" style="width:100%" data-act="signin" data-key="signin"' + (busy || st.status === 'unsupported' ? ' disabled' : '') + '>' + esc(tr(busy ? 'login.busy' : (app.loginError === 'error' ? 'login.retry' : 'login.btn'))) + '</button>' +
    (msg ? '<p class="field-err" role="alert">' + esc(msg) + '</p>' : '') +
    '<button class="btn ghost" style="width:100%;margin-top:10px" data-act="toStart" data-key="loginBack">' + esc(tr('back')) + '</button></div></div>';
}

function tableErrorHtml() {
  var k = app.tableError;
  if (!k) return '';
  return '<div class="msg bad" role="alert"><b>' + esc(tr('err.' + k)) + '</b><span>' + esc(tr('err.' + k + 'Text')) + '</span></div>';
}

function tablesHtml() {
  var user = Cloud.getState().user, rooms = app.rooms;
  var list;
  if (rooms === null) list = '<div class="card-box table-list" role="status" aria-label="' + esc(tr('tables.loading')) + '"><h3>' + esc(tr('tables.open')) + '</h3>' + [1, 2, 3].map(function (k) { return '<div class="row skel" data-key="sk' + k + '"><div class="avatar"></div><div class="who"><i></i><i class="s"></i></div></div>'; }).join('') + '</div>';
  else if (!rooms.length) list = '<div class="dashed">' + esc(tr('tables.empty')) + '</div>';
  else list = '<div class="card-box table-list"><h3>' + esc(tr('tables.open')) + '</h3>' + rooms.map(function (r) {
    return '<div class="row" data-key="room-' + esc(r.code) + '"><div class="avatar">' + esc(P.initial(r.hostName)) + '</div><div class="who"><b>' + esc(r.hostName || r.code) + '</b><span>' + esc(tr('tables.of', { n: r.players, m: r.size })) + '</span></div>' + (r.bots ? '<span class="tag-bots">' + esc(tr('tables.bots')) + '</span>' : '') +
      '<button class="btn outline" data-act="joinRoom" data-v="' + esc(r.code) + '">' + esc(tr('tables.join')) + '</button></div>';
  }).join('') + '</div>';
  var cur = app.code;
  return '<div class="page"><div class="page-head"><button class="icon-btn" data-act="toStart" data-key="back" aria-label="' + esc(tr('back')) + '">←</button><h2 style="flex:1">' + esc(tr('tables.title')) + '</h2>' +
      (user ? '<div class="you-chip"><span class="avatar" style="width:32px;height:32px;background:' + P.avatarColor(P.getProfile().avatar) + '">' + esc(P.initial(P.getProfile().name)) + '</span>' + esc(tr('tables.you', { name: P.getProfile().name })) + '</div>' : '') + themeButtonHtml('') + '</div>' +
    tableErrorHtml() +
    '<button class="btn accent big" data-act="toCreate" data-key="create">' + esc(tr('tables.create')) + '</button>' +
    '<div class="card-box"><h3>' + esc(tr('tables.codeTitle')) + '</h3><div class="code-row">' +
      '<input class="code-input" id="code" data-key="code" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="5" value="' + esc(cur) + '" aria-label="' + esc(tr('tables.codeLabel')) + '" placeholder="•••••">' +
      '<button class="btn ghost" data-act="paste" data-key="paste">' + esc(tr('tables.paste')) + '</button></div>' +
      (app.codeError ? '<p class="field-err">' + esc(app.codeError === 'shortCode' ? tr('err.shortCode') : tr('err.notFound')) + '</p>' : '') +
      '<button class="btn outline big" style="margin-top:12px;width:100%;min-height:48px;background:var(--accent-soft)" data-act="joinCode" data-key="joinCode"' + (app.busy ? ' disabled' : '') + '>' + esc(tr('tables.join')) + '</button></div>' +
    list + '</div>';
}

function createPreviewHtml() {
  var n = app.size, parts = '';
  for (var i = 0; i < n; i++) {
    var a = (90 + i * 360 / n) * Math.PI / 180, me = i === 0, bt = app.fillBots && !me;
    parts += '<div class="pv-seat' + (me ? ' me' : (bt ? ' bot' : '')) + '" style="left:' + (85 + 62 * Math.cos(a) - 17).toFixed(1) + 'px;top:' + (75 + 52 * Math.sin(a) - 17).toFixed(1) + 'px">' + esc(me ? tr('create.you') : (bt ? tr('st.bot').charAt(0) : '?')) + '</div>';
  }
  var k = n - 1, w = window.I18n.plural(k, 'games.blackjack.create.seatWord');
  return '<div class="preview"><div class="pv-table" aria-hidden="true"><span class="pv-dealer">' + esc(tr('create.dealer')) + '</span>' + parts + '</div><div class="muted" style="font-size:14px">' + esc(tr(app.fillBots ? 'create.previewBots' : 'create.previewFree', { n: k, w: w })) + '</div></div>';
}
function createHtml() {
  return '<div class="page"><div class="page-head"><button class="icon-btn" data-act="toTables" data-key="back" aria-label="' + esc(tr('back')) + '">←</button><h2>' + esc(tr('create.title')) + '</h2>' + themeButtonHtml('') + '</div>' +
    createPreviewHtml() +
    '<div><div style="font-weight:700;margin-bottom:8px">' + esc(tr('create.seats')) + '</div><div class="seg" role="group" aria-label="' + esc(tr('create.seats')) + '">' +
      [2, 3, 4, 5].map(function (n) { return '<button data-act="size" data-v="' + n + '" data-key="size' + n + '" aria-pressed="' + (app.size === n) + '">' + n + '</button>'; }).join('') + '</div></div>' +
    '<button class="switch-row" data-act="bots" data-key="bots" aria-pressed="' + app.fillBots + '"><span class="t"><b>' + esc(tr('create.bots')) + '</b><span class="s">' + esc(tr(app.fillBots ? 'create.botsSub' : 'create.botsOff')) + '</span></span><span class="knob"><i>' + (app.fillBots ? '✓' : '') + '</i></span></button>' +
    '<button class="switch-row" data-act="private" data-key="private" aria-pressed="' + app.private + '"><span class="t"><b>' + esc(tr('create.private')) + '</b><span class="s">' + esc(tr(app.private ? 'create.privateSub' : 'create.privateOff')) + '</span></span><span class="knob"><i>' + (app.private ? '✓' : '') + '</i></span></button>' +
    tableErrorHtml() +
    '<button class="btn accent big" data-act="create" data-key="createGo"' + (app.busy ? ' disabled' : '') + '>' + esc(tr(app.busy ? 'create.busy' : 'create.btn')) + '</button><button class="btn ghost" data-act="toTables" data-key="createBack">' + esc(tr('back')) + '</button></div>';
}

function lobbyHtml() {
  var v = G && G.view, host = isOwner(), myUid = Cloud.getState().user && Cloud.getState().user.uid;
  var members = v ? v.members : [], size = v ? v.size : app.size, bots = v ? v.fillBots !== false : app.fillBots;
  var seats = members.map(function (m) {
    var me = m.uid === myUid, tags = [];
    if (v && v.owner ? m.uid === v.owner : m.seat === 0) tags.push(tr('lobby.creator'));
    return '<div class="seat" data-key="m-' + esc(m.uid) + '"><div class="avatar" style="background:' + P.avatarColor(m.avatar) + '">' + esc(P.initial(m.name)) + '</div><div class="nm">' + esc(m.name || tr('you')) + '</div><div class="tg">' + esc(tags.join(' · ')) + '</div></div>';
  });
  for (var i = members.length; i < size; i++) {
    seats.push('<div class="seat empty" data-key="e-' + i + '"><div class="avatar" style="background:transparent;border:1px dashed var(--muted)">·</div><div class="nm">' + esc(bots ? tr('lobby.bot') : tr('lobby.waiting')) + '</div><div class="tg">' + (bots ? esc(tr('lobby.bot')) : '') + '</div></div>');
  }
  var startLeft = v && v.startIn >= 0 ? Math.max(0, v.startIn - (now() - (v.receivedAt || now()))) : -1;
  var canStart = bots || (members.length >= 2 && startLeft === 0);   // с ботами можно сразу, без ботов: 2 человека и 20 секунд после последнего входа
  var autoHtml = startLeft > 0 ? '<div class="wait-text" role="status">' + esc(tr('lobby.startIn', { n: Math.ceil(startLeft / 1000) })) + '</div>' : '';
  var code = G ? G.code : '';
  return '<div class="page"><div class="page-head"><button class="icon-btn" data-act="' + (host ? 'closeTable' : 'leaveLobby') + '" data-key="exit" aria-label="' + esc(tr('lobby.leave')) + '">←</button><h2>' + esc(tr('lobby.title')) + '</h2>' + themeButtonHtml('') + '</div>' +
    '<div class="card-box code-big"><small>' + esc(tr('lobby.code')) + '</small><div class="code" data-key="codeBig">' + esc(code) + '</div>' + (v && v.private ? '<div class="muted" style="font-size:14px;font-weight:700">' + esc(tr('lobby.private')) + '</div>' : '') + '<div class="btns">' +
      '<button class="btn ghost" data-act="copyCode" data-key="copy">' + esc(tr(app.copied ? 'lobby.copied' : 'lobby.copy')) + '</button>' +
      '<button class="btn ghost" data-act="shareLink" data-key="share">' + esc(tr('lobby.share')) + '</button></div></div>' +
    '<div class="seats">' + seats.join('') + '</div>' + autoHtml + chat.panelHtml({ mode: 'lobby' }) +
    bannerHtml() +
    (host
      ? '<div class="row-btns"><button class="btn accent big" data-act="start" data-key="start"' + (canStart ? '' : ' disabled') + '>' + esc(tr('lobby.start')) + '</button><button class="btn big" data-act="closeTable" data-key="closeTable">' + esc(tr(G.ctrl.server ? 'lobby.leave' : 'lobby.close')) + '</button></div>' +
        (members.length >= 2 || bots ? '' : '<div class="muted" style="font-size:14px">' + esc(tr('lobby.needMore')) + '</div>') + (G.ctrl.server ? '' : '<div class="muted" style="font-size:14px">' + esc(tr('lobby.hostHint')) + '</div>')
      : '<div style="font-weight:700;font-size:16px;text-align:center">' + esc(tr(members.length >= size ? 'lobby.full' : 'lobby.waitHost')) + '</div><button class="btn big" data-act="leaveLobby" data-key="leaveLobby">' + esc(tr('lobby.leave')) + '</button>') +
    '</div>';
}

function outHtml() {
  return '<div class="page"><div class="msg bad" role="alert"><b>' + esc(tr('out.title')) + '</b><span>' + esc(tr('out.text')) + '</span><button class="btn accent big" data-act="toTables" data-key="outBtn">' + esc(tr('out.btn')) + '</button></div></div>';
}
function closedHtml() {
  var k = app.closedReason === 'hostGone' ? 'hostGone' : 'hostGone';
  return '<div class="page"><div class="msg bad" role="alert"><b>' + esc(tr('err.' + k)) + '</b><button class="btn accent" data-act="toTables" data-key="toTables">' + esc(tr('err.toTables')) + '</button></div></div>';
}

// Табличка соседнего места
function plateHtml(D, L, idx, pos, n, withCards) {
  var vs = D.vs, s = vs.seats[idx], st = seatStatus(D, idx), active = activeSeat(D, idx), tm = timerFor(D, idx);
  var m = memberOf(D, idx), bg = m ? P.avatarColor(m.avatar) : 'var(--accent-soft)';
  var deg = tm && active ? Math.round(360 * tm.left / tm.total) : 360;
  var ring = active ? 'background:conic-gradient(var(--accent) ' + deg + 'deg, var(--line) 0)' : '';
  var h = seatHand(s), cards = '';
  if (withCards && h && h.cards.length) cards = '<div class="row-cards" style="padding-top:2px">' + cardsRow('p' + idx, h.cards, L.desk ? 40 : 26, 200, L.desk ? 20 : 12) + '</div>';
  var sm = withCards ? seatSumText(s, false) : '';
  return '<div class="plate' + (active ? ' active' : '') + '" style="' + platePos(L, pos, n) + '" data-key="pl' + idx + '"><div class="ring" style="' + ring + '"><div class="av" style="background:' + bg + '">' + esc(P.initial(s.name)) + '</div></div>' +
    '<div class="nm">' + esc(s.name || tr('st.bot')) + '</div>' + cards + (sm ? '<div class="sm">' + esc(sm) + '</div>' : '') +
    '<div class="stt ' + st[1] + '">' + esc(st[0]) + '</div></div>';
}
function othersOf(D) {
  var vs = D.vs, me = D.me, n = vs.seats.length, out = [];
  for (var k = 1; k < n; k++) { var i = (me + k) % n; if (vs.seats[i].active) out.push(i); }
  return out;
}
function feltStyle(L) { return 'width:' + L.Wf + 'px;height:' + L.F + 'px;border-radius:' + (Math.min(L.Wf, L.F) / 2) + 'px'; }

function playHtml(D) {
  var vs = D.vs, me = D.me, seat = vs.seats[me], hand = seatHand(seat);
  var others = othersOf(D), L = layout(others.length);
  var showResult = vs.phase === 'settled' && now() >= app.resultAt;
  var myTurn = vs.phase === 'playing' && vs.current === me && !app.pending;
  var tm = timerFor(D, me);
  var plates = others.map(function (idx, i) { return plateHtml(D, L, idx, i, others.length, true); }).join('');
  // дилер
  var dl = vs.dealer.cards, hidden = vs.dealer.hidden && dl.length > 1;
  var seq = app.seq && app.seq.round === vs.round && vs.phase === 'settled' && now() < app.seq.end ? app.seq : null;
  if (seq) {
    dl = dl.filter(function (c, i) { return i < 2 || now() >= seq.times[i]; });
    hidden = now() < seq.revealAt;
    if (hidden) dl = [dl[0], '??'];
  }
  var dw = L.desk ? 76 : (L.narrow ? 50 : 58);
  var dsum = hidden ? String(BJ.cardValue(dl[0]) === 11 ? 11 : BJ.cardValue(dl[0])) : (dl.length === 2 && BJ.handValue(dl).total === 21 ? tr('sum.bj') : (BJ.handValue(dl).total > 21 ? tr('st.bust') + ' ' + BJ.handValue(dl).total : String(BJ.handValue(dl).total)));
  var dealerBox = '<div class="dealer-box"><div class="lbl">' + esc(tr('dealer')) + ' <span class="pill">' + esc(dsum) + '</span></div><div class="row-cards">' + cardsRow('dealer', dl, dw, 400, dw * 1.1) + '</div></div>';
  // я
  var pw = (hand && hand.cards.length > 4) ? (L.desk ? 84 : 54) : (L.desk ? 84 : (L.narrow ? 54 : 64));
  var mine = hand ? cardsRow('me', hand.cards, pw, L.vw - (L.desk ? 200 : 110), pw * 0.55) : '';
  var sumText = seatSumText(seat, true);
  if (hand && vs.phase === 'playing' && hand.done && !BJ.isBust(hand) && !BJ.isNatural(hand)) sumText += ' · ' + tr('st.stand');
  var label = myTurn ? tr(tm && tm.stage === 'idle' ? 'turn.youSec' : 'turn.you', { n: tm ? tm.sec : 0 }) : (showResult || vs.phase === 'settled' ? '' : tr('you'));
  var betCol = '';
  var meBox = '<div class="me-box"><div class="me-col"><div class="me-top">' + (label ? '<span class="me-label' + (myTurn ? ' turn' : '') + '">' + esc(label) + '</span>' : '') +
    '<span class="pill" style="padding:2px 10px">' + esc(sumText) + '</span></div><div class="me-ring' + (myTurn ? ' turn' : '') + '">' + mine + '</div></div>' + betCol + '</div>';
  var res = showResult ? myOutcome(D) : null;
  var botMode = D.mode === 'bot';
  var center = res && !botMode ? '<div class="center-res ' + res.tone + '" style="width:' + (L.desk ? 200 : (L.narrow ? 124 : 150)) + 'px"><div class="t">' + esc(res.title) + '</div><div class="t">' + esc(res.delta) + '</div><div class="s">' + esc(res.sub) + '</div></div>' : '';
  // Итог игры с ботом: отдельное окошко над своими картами
  var pop = '';
  if (res && botMode) {
    pop = '<div class="result-pop ' + res.tone + '" style="bottom:' + Math.round(pw * 1.4 + 64) + 'px" role="status"><div class="t">' + esc(res.title) + '</div><div class="t">' + esc(res.delta) + '</div><div class="s">' + esc(res.sub) + '</div>' +
      (G.rw ? '<div class="cap">' + esc(tr('cap.left', { n: fmt(G.rw.left) })) + '</div>' : '') +
      '<div class="pop-btns">' + '<button class="btn accent" data-act="newBet" data-key="newBet">' + esc(tr('res.newBet')) + '</button>' +
      '<button class="btn" data-act="backMenu" data-key="backMenu">' + esc(tr('res.back')) + '</button></div></div>';
  }
  var felt = '<div class="felt" style="' + feltStyle(L) + '">' + dealerBox + plates + center + meBox + pop + '</div>';

  var notice = activeNotice();
  var noticeHtml = notice ? '<div class="notice" role="status">' + esc(notice) + '</div>' : '';
  var panel = '';
  if (!showResult) {
    var cur = vs.current >= 0 ? vs.seats[vs.current] : null;
    var waitText = !myTurn && vs.phase === 'playing' && cur && vs.current !== me ? tr('turn.other', { name: cur.name || tr('st.bot') }) : (vs.phase === 'betting' ? tr('wait.dealing') : '');
    if (D.online && app.pending) waitText = tr('wait.sent'); else if (D.online && app.banner === 'offline') waitText = tr('wait.offline');
    var dis = !myTurn;
    panel = '<div class="actions">' + (waitText ? '<div class="wait-text">' + esc(waitText) + '</div>' : '') +
      '<div class="act-row"><button class="act" data-act="stand" data-key="stand"' + (dis ? ' disabled' : '') + '><span>' + esc(tr('act.stand')) + '</span><small>' + esc(tr('key.stand')) + '</small></button>' +
      '<button class="act take" data-act="hit" data-key="hit"' + (dis ? ' disabled' : '') + '><span>' + esc(tr(app.pending ? 'act.sending' : 'act.hit')) + '</span><small>' + esc(tr('key.hit')) + '</small></button></div></div>';
  } else if (showResult) {
    var bits = '';
    if (D.online) {
      var left = Math.max(0, ROOM_CFG.nextDelayMs - (now() - app.settledAt)), pct = Math.round(100 * left / ROOM_CFG.nextDelayMs);
      bits += '<div><div style="font-size:14px;font-weight:700;margin-bottom:4px" role="status">' + esc(tr('res.nextIn', { n: Math.ceil(left / 1000) })) + '</div><div class="next-bar"><i style="width:' + pct + '%"></i></div></div>' +
        '<button class="btn" data-act="exit" data-key="leaveTable">' + esc(tr('res.leave')) + '</button>';
    }
    panel = bits ? '<div class="result-panel">' + bits + '</div>' : '';
  }
  return '<div class="game">' + felt + noticeHtml + panel + '</div>';
}

function bannerHtml() {
  var online = G && G.mode === 'online';
  if (online && app.screen === 'game' && Cloud.getState().status !== 'signedIn' && Cloud.getState().status !== 'unsupported' && !Cloud.getState().user) {
    return '<div class="banner bad flex" role="alert"><span>' + esc(tr('banner.relogin')) + '</span><button class="btn accent" data-act="relogin" data-key="relogin">' + esc(tr('banner.reloginBtn')) + '</button></div>';
  }
  if (app.banner === 'server') return '<div class="banner flex" role="status"><span>' + esc(tr('banner.server')) + '</span></div>';
  if (app.banner === 'offline') return '<div class="banner flex" role="status"><span>' + esc(tr('banner.offline')) + '</span></div>';
  if (app.banner === 'back') return '<div class="banner flex" role="status"><span>' + esc(tr('banner.back')) + '</span></div>';
  return '';
}
function gameHtml() {
  var D = describe();
  if (!D) return '<div class="page"><div class="dashed">…</div></div>';
  if (D.me === null) return '<div class="page"><div class="dashed">…</div></div>';
  return topbarHtml() + bannerHtml() + playHtml(D);
}

// ===== Окна =====
function rulesModalHtml() {
  var blocks = ['goal', 'cards', 'turn', 'pay', 'dealer'].map(function (k) { return '<div class="rule"><b>' + esc(tr('rules.' + k + '.title')) + '</b><span>' + esc(tr('rules.' + k + '.text')) + '</span></div>'; }).join('');
  return '<div class="overlay" role="dialog" aria-modal="true" aria-label="' + esc(tr('rules.title')) + '"><div class="sheet"><div class="head"><h2>' + esc(tr('rules.title')) + '</h2>' +
    '<button class="icon-btn" data-act="close" data-key="close" data-autofocus aria-label="' + esc(tr('close')) + '">✕</button></div>' + blocks +
    '<button class="btn accent" style="margin-top:10px;width:100%;min-height:48px" data-act="close" data-key="ok">' + esc(tr('rules.ok')) + '</button></div></div>';
}
function confirmHtml(kind) {
  var map = { exitCatalog: ['confirmCatalog', 'catalog'], leaveTable: ['confirmTable', 'table'], closeTable: ['confirmClose', 'closeTable'] }[kind];
  var okLabel = kind === 'closeTable' ? tr('confirm.closeTable') : tr('confirm.leave');
  return '<div class="overlay" role="alertdialog" aria-modal="true" aria-label="' + esc(tr(map[0] + '.title')) + '"><div class="sheet"><h2>' + esc(tr(map[0] + '.title')) + '</h2><p class="t">' + esc(tr(map[0] + '.text')) + '</p>' +
    '<div class="stack"><button class="btn accent big" data-act="close" data-autofocus data-key="stay">' + esc(tr('confirm.stay')) + '</button>' +
    '<button class="btn big" data-act="confirmLeave" data-v="' + map[1] + '" data-key="ok">' + esc(okLabel) + '</button></div></div></div>';
}
function askHtml(D) {
  var tm = timerFor(D, D.me);
  if (!tm) return '';
  var betting = D.vs.phase === 'betting', pct = Math.round(100 * tm.left / tm.total);
  return '<div class="overlay" role="alertdialog" aria-modal="true" aria-label="' + esc(tr('ask.title')) + '"><div class="sheet"><h2>' + esc(tr('ask.title')) + '</h2>' +
    '<div class="ask-num"><b role="timer">' + tm.sec + '</b><span>' + esc(tr(betting ? 'ask.secsBet' : 'ask.secs')) + '</span></div><div class="ask-bar"><i style="width:' + pct + '%"></i></div>' +
    '<div class="stack" style="margin-top:0"><button class="btn accent big" data-act="here" data-autofocus data-key="here">' + esc(tr('ask.yes')) + '</button>' +
    '<button class="btn" data-act="exit" data-key="askLeave">' + esc(tr('ask.leave')) + '</button></div></div></div>';
}
function modalHtml() {
  if (app.modal === 'rules') return rulesModalHtml();
  if (app.modal === 'exitCatalog' || app.modal === 'leaveTable' || app.modal === 'closeTable') return confirmHtml(app.modal);
  if (G && G.mode === 'online' && app.screen === 'game') {
    var D = describe();
    if (D && D.me !== null) { var tm = timerFor(D, D.me); if (tm && tm.stage === 'asking') return askHtml(D); }
  }
  return '';
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
  switch (app.screen) {
    case 'start': return startHtml();
    case 'login': return loginHtml();
    case 'tables': return '<div class="topbar" style="justify-content:flex-end">' + themeButtonHtml('') + '</div>' + tablesHtml();
    case 'create': return createHtml();
    case 'lobby': return lobbyHtml();
    case 'closed': return closedHtml();
    case 'out': return outHtml();
    case 'game': return gameHtml();
  }
  return '';
}

function render() {
  renderPass = { fresh: 0, keys: [] };
  var tpl = document.createElement('template');
  tpl.innerHTML = '<div class="screen" data-key="' + app.screen + '">' + screenHtml() + '</div>' + chatOverlayHtml() + modalHtml();
  morph(appEl, tpl.content);
  chat.afterRender();
  renderPass.keys.forEach(function (k) { app.seen[k] = true; });
  if (app.modal || appEl.querySelector('.overlay')) {
    var auto = appEl.querySelector('[data-autofocus]');
    var ov = auto && auto.closest('.overlay');
    if (auto && ov && !ov.contains(document.activeElement)) auto.focus();
  }
  scheduleClock();
}
// Секундная перерисовка нужна, пока идёт обратный отсчёт (таймер хода, вопрос «играете?», следующая раздача)
function scheduleClock() {
  var need = false;
  if (G && G.mode === 'online' && app.screen === 'game') {
    var D = describe();
    if (D && D.me !== null) {
      need = D.timers.length > 0 || (D.vs.phase === 'settled') || (D.vs.phase === 'betting' && false);
    }
  }
  if (activeNotice()) need = true;
  if (app.screen === 'lobby' && G && G.view && G.view.startIn > 0) need = true;   // отсчёт до возможности начать
  if (need && !clockTimer) clockTimer = setInterval(render, 500);
  else if (!need && clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}

// ===== События =====
function closeModal() {
  var ov = appEl.querySelector('.overlay');
  if (!ov || reduced()) { app.modal = null; render(); return; }
  ov.classList.add('closing');
  setTimeout(function () { app.modal = null; render(); }, 180);
}
function playing() { return G && G.mode === 'bot' && G.state && G.state.phase === 'playing'; }

// Ссылка-приглашение вида …/blackjack/#K7M4Q: после входа сразу заходим за стол, адрес очищается
function consumeInvite() {
  var code = app.invite;
  if (!code || !Cloud.getState().user) return;
  app.invite = null;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* адрес не обязателен */ }
  app.code = code; joinTable(code);
}
function onSignIn() {
  if (app.busy) return;
  app.busy = true; app.loginError = null; render();
  Cloud.signIn().then(function (r) {
    app.busy = false;
    if (r && r.cancelled) { render(); return; }
    openTables(); consumeInvite();
  }, function (e) {
    app.busy = false;
    var c = e && e.code;
    app.loginError = c === 'auth/unauthorized-domain' ? 'domain' : (c === 'auth/popup-blocked' ? 'popup' : (c === 'unsupported' ? 'unsupported' : 'error'));
    render();
  });
}

function openOnlineFlow() {
  if (window.GAME_SERVER_URL && window.PlatformRoomsWS) window.PlatformRoomsWS.warm(window.GAME_SERVER_URL);
  if (Cloud.getState().status === 'signedIn') openTables(); else { app.screen = 'login'; app.loginError = null; render(); }
}
appEl.addEventListener('click', function (e) {
  var el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  var act = el.getAttribute('data-act'), v = el.getAttribute('data-v');
  switch (act) {
    case 'theme': window.PlatformTheme.toggle(); break;
    case 'rules': app.modal = 'rules'; render(); break;
    case 'close': closeModal(); break;
    case 'claim': W.claimDaily(); render(); break;
    case 'toStart': stopOnline(); app.screen = 'start'; app.busy = false; app.tableError = null; render(); break;
    case 'pickMode': app.startMode = v; render(); break;
    case 'play': if (app.startMode === 'online') openOnlineFlow(); else startLocal(); break;
    case 'bot': startLocal(); break;
    case 'online': openOnlineFlow(); break;
    case 'signin': onSignIn(); break;
    case 'relogin': Cloud.signIn().then(function () { render(); }, function () { render(); }); break;
    case 'toTables': stopOnline(); openTables(); break;
    case 'toCreate': app.screen = 'create'; app.tableError = null; render(); break;
    case 'size': app.size = Number(v); render(); break;
    case 'bots': app.fillBots = !app.fillBots; render(); break;
    case 'private': app.private = !app.private; render(); break;
    case 'create': createTable(); break;
    case 'joinRoom': app.code = v; joinTable(v); break;
    case 'joinCode': joinTable(app.code); break;
    case 'paste':
      try { navigator.clipboard.readText().then(function (t) { app.code = String(t || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5); render(); }, function () { /* нет доступа к буферу */ }); } catch (err) { /* нет доступа к буферу */ }
      break;
    case 'copyCode':
      try { navigator.clipboard.writeText(G.code).then(function () { app.copied = true; render(); setTimeout(function () { app.copied = false; render(); }, 2000); }); } catch (err) { /* нет доступа к буферу */ }
      break;
    case 'shareLink':
      try { navigator.clipboard.writeText(location.href.split('#')[0] + '#' + G.code).then(function () { app.copied = true; render(); setTimeout(function () { app.copied = false; render(); }, 2000); }); } catch (err) { /* нет доступа к буферу */ }
      break;
    case 'start': if (isOwner()) G.ctrl.start().then(function () { G.ctrl.tick(); }); break;
    case 'closeTable': leaveGame('tables'); break;
    case 'leaveLobby': leaveGame('tables'); break;
    case 'hit': case 'stand': {
      if (!G) break;
      if (G.mode === 'bot') { if (lDispatch({ type: act, seat: 0 })) { render(); runBots(); } } else onlineSend({ type: act });
      break;
    }
    case 'here': onlineSend({ type: 'here' }); break;
    case 'newBet': localNext(); break;
    case 'backMenu': gameToken++; G = null; app.modal = null; app.seq = null; app.screen = 'start'; render(); break;
    case 'exit':
      if (G && G.mode === 'bot') { if (playing()) { app.modal = 'exitCatalog'; render(); } else window.location.href = CATALOG_URL; }
      else if (G && G.mode === 'online') { app.modal = G.role === 'host' ? 'closeTable' : 'leaveTable'; render(); }
      else window.location.href = CATALOG_URL;
      break;
    case 'confirmLeave':
      if (v === 'catalog') window.location.href = CATALOG_URL;
      else leaveGame(v === 'closeTable' ? 'tables' : 'tables');
      break;
  }
});
appEl.addEventListener('input', function (e) {
  if (e.target.id === 'code') {
    var clean = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5);
    app.code = clean; app.codeError = null;
    if (e.target.value !== clean) e.target.value = clean;
    render();
  }
});
appEl.addEventListener('keydown', function (e) {
  if (e.target.id === 'code' && e.key === 'Enter') { e.preventDefault(); joinTable(app.code); }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && app.modal) { closeModal(); return; }
  if (app.screen !== 'game' || app.modal || e.target.tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return;
  var D = describe();
  if (!D || D.me === null || D.vs.phase !== 'playing' || D.vs.current !== D.me || app.pending) return;
  if (e.code === 'Space' || e.code === 'KeyH') { e.preventDefault(); appEl.querySelector('[data-act="hit"]').click(); }
  else if (e.code === 'KeyS') { e.preventDefault(); appEl.querySelector('[data-act="stand"]').click(); }
});
window.addEventListener('resize', function () { if (app.screen === 'game') render(); });
window.addEventListener('pagehide', function () { if (G && G.mode === 'online') { try { if (G.role === 'host') G.ctrl.close(); else G.ctrl.leave(); } catch (e) { /* закрываем страницу */ } } });

window.PlatformTheme.onChange(render);
W.onChange(function () { if (app.screen === 'start' || app.screen === 'game') render(); });
Cloud.onChange(function () {
  if (app.screen === 'login' && Cloud.getState().status === 'signedIn' && !app.busy) { openTables(); consumeInvite(); }
  else if (app.screen === 'login' || app.screen === 'tables') render();
});

// Ссылка вида …/blackjack/#K7M4Q сразу ведёт на вход в стол
(function () {
  var hash = (location.hash || '').replace('#', '').toUpperCase();
  if (/^[A-Z0-9]{5}$/.test(hash)) { app.code = hash; app.invite = hash; app.screen = 'login'; }
})();
render();
