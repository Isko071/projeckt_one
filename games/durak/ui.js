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

var app = { screen: 'start', mode: 'bot', level: 'medium', variant: 'podkidnoy', deck: 36, players: 2, rules: false, confirm: false, ctrl: null, pick: null, shownMove: -1 };

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
function modeLabel(mode, deck) { var pm = D.parseMode(mode); return tr('mode.label', { v: tr('start.variant.' + pm.variant), d: tr('start.deck.' + (deck || pm.deck)) }); }
function cardHtml(c, cls, attrs) {
  var red = c[1] === 'D' || c[1] === 'H';
  return '<span class="pcard ' + (red ? 'red' : 'blk') + (cls ? ' ' + cls : '') + '"' + (attrs || '') + '><b>' + esc(rankLabel(c)) + '<i>' + SUIT_CHAR[c[1]] + '</i></b><em>' + SUIT_CHAR[c[1]] + '</em></span>';
}
function backHtml(cls) { return '<span class="pcard back' + (cls ? ' ' + cls : '') + '"></span>'; }

// ===== Экран партии =====
function mySeat() { return app.ctrl ? app.ctrl.seat : 0; }
function myTurn(v) { return !!app.ctrl && !v.gameOver && v.actor === mySeat() && !app.ctrl.busy; }
function legalNow(v) { return myTurn(v) ? D.legal(v) : { attack: [], defend: [], transfer: [], take: false, pass: false }; }
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
function opponentsHtml(v) {
  var me = mySeat(), n = v.seats.length, out = '';
  for (var k = 1; k < n; k++) {
    var i = (me + k) % n, s = v.seats[i], cnt = D.size(v, i), tag = seatTag(v, i), fan = '';
    for (var j = 0; j < Math.min(cnt, 8); j++) fan += backHtml();
    out += '<div class="opp' + (v.actor === i && !v.gameOver ? ' turn' : '') + (s.out ? ' out' : '') + (s.active === false ? ' gone' : '') + '">' +
      '<div class="fan" aria-hidden="true">' + fan + '</div>' +
      '<div class="who"><span class="nm">' + esc(nameOf(v, i)) + '</span><span class="cnt">' + esc(tr('cards', { n: cnt })) + '</span></div>' +
      (tag ? '<span class="tag ' + tag + '">' + esc(tr('tag.' + tag)) + '</span>' : '') + '</div>';
  }
  return '<div class="opps n' + (n - 1) + '">' + out + '</div>';
}
function tableHtml(v, lg) {
  var fresh = v.last && v.moves !== app.shownMove ? v.last : null;
  var pick = app.pick, targets = {};
  if (pick) lg.defend.forEach(function (d) { if (d.card === pick) targets[d.target] = true; });
  var pairs = v.table.map(function (p, i) {
    var newA = fresh && (fresh.type === 'attack' || fresh.type === 'transfer') && fresh.card === p.a, newD = fresh && fresh.type === 'defend' && fresh.card === p.d;
    var a = cardHtml(p.a, 'a' + (newA ? ' fresh' : '')), d = p.d ? cardHtml(p.d, 'd' + (newD ? ' fresh' : '')) : '';
    var label = cardName(p.a) + (p.d ? ' — ' + cardName(p.d) : '');
    return targets[i] ? '<button class="pair target" data-target="' + i + '" aria-label="' + esc(label) + '">' + a + d + '</button>' : '<div class="pair" aria-label="' + esc(label) + '">' + a + d + '</div>';
  }).join('');
  var deck = v.deckCount, trump = '<div class="deck" aria-label="' + esc(tr('trump') + ': ' + cardName(v.trumpCard) + '. ' + (deck ? tr('deck', { n: deck }) : tr('deck.empty'))) + '">' +
    (deck ? cardHtml(v.trumpCard, 'trumpcard') + (deck > 1 ? backHtml('top') : '') + '<span class="dn">' + deck + '</span>' : '') +
    '<span class="ts' + (v.trump === 'D' || v.trump === 'H' ? ' red' : '') + '" title="' + esc(tr('trump')) + '">' + SUIT_CHAR[v.trump] + '</span></div>';
  var bito = '<div class="bito">' + (v.discard ? backHtml('pile') + '<span>' + esc(tr('discard', { n: v.discard })) + '</span>' : '') + '</div>';
  var info = !v.table.length && v.last && (v.last.type === 'bito' || v.last.type === 'took') && v.moves !== app.shownMove ? '<div class="flash">' + esc(v.last.type === 'bito' ? tr('last.bito') : tr('last.took', { name: nameOf(v, v.last.seat) })) + '</div>' : '';
  return '<div class="felt">' + trump + '<div class="table' + (v.taking ? ' taking' : '') + '" role="group" aria-label="' + esc(tr('table.label')) + '">' + (pairs || info || '<span class="empty">' + esc(tr('table.empty')) + '</span>') + '</div>' + bito + '</div>';
}
function handHtml(v, lg) {
  var me = v.seats[mySeat()], hand = D.sortHand(me.hand || [], v.trump);
  var can = {}, beat = {};
  lg.attack.forEach(function (c) { can[c] = true; });
  lg.transfer.forEach(function (c) { can[c] = true; });
  lg.defend.forEach(function (d) { can[d.card] = true; beat[d.card] = true; });
  var cards = hand.map(function (c) {
    var cls = (can[c] ? 'ok' : (myTurn(v) ? 'no' : '')) + (app.pick === c ? ' sel' : '') + (D.isTrump(c, v.trump) ? ' tr' : '');
    return '<button class="hc" data-card="' + c + '" aria-label="' + esc(cardName(c)) + '"' + (can[c] ? '' : ' aria-disabled="true"') + '>' + cardHtml(c, cls) + '</button>';
  }).join('');
  return '<div class="hand" role="group" aria-label="' + esc(tr('hand.label')) + '">' + cards + '</div>';
}
function noteText(v, lg) {
  var me = mySeat();
  if (v.gameOver) return '';
  if (v.seats[me].out) return tr('note.out');
  if (!myTurn(v)) {
    if (v.taking && v.actor !== v.defender) return tr('note.waitTaking', { name: nameOf(v, v.defender) });
    return tr(v.actor === v.defender ? 'note.waitDefend' : 'note.wait', { name: nameOf(v, v.actor) });
  }
  if (app.pick) return tr('note.defendPick');
  if (v.phase === 'defend') return lg.transfer.length && !lg.defend.length ? tr('note.transfer') : tr('note.defend');
  if (v.phase === 'attack') return tr('note.attack');
  return tr(v.taking ? 'note.throwTaking' : 'note.throw');
}
function gameHtml(v) {
  var lg = legalNow(v);
  if (app.pick && !lg.defend.some(function (d) { return d.card === app.pick; }) && lg.transfer.indexOf(app.pick) < 0) app.pick = null;
  var btns = '';
  if (app.pick) {
    if (lg.transfer.indexOf(app.pick) >= 0) btns += '<button class="btn primary" data-act="transfer">' + esc(tr('act.transfer')) + '</button>';
    btns += '<button class="btn" data-act="unpick">' + esc(tr('act.cancel')) + '</button>';
  } else {
    if (lg.take) btns += '<button class="btn warn" data-act="take">' + esc(tr('act.take')) + '</button>';
    if (lg.pass) btns += '<button class="btn primary" data-act="pass">' + esc(tr(v.taking ? 'act.pass' : 'act.bito')) + '</button>';
  }
  var meTag = seatTag(v, mySeat());
  return '<div class="game"><div class="o-head"><button class="theme-btn" data-act="exit" aria-label="' + esc(tr('exit')) + '">←</button><h2>' + esc(tr('title')) + '<small>' + esc(modeLabel(v.mode, v.deckSize)) + '</small></h2>' +
      (app.ctrl.online ? window.DurakOnline.chatButtonHtml() : '') + '<button class="theme-btn" data-act="rules" aria-label="' + esc(tr('rules.button')) + '">?</button>' + themeButtonHtml('theme-btn') + '</div>' +
    opponentsHtml(v) + tableHtml(v, lg) +
    '<div class="me' + (myTurn(v) ? ' turn' : '') + '"><span class="nm">' + esc(tr('you')) + '</span>' + (meTag ? '<span class="tag ' + meTag + '">' + esc(tr('tag.' + meTag)) + '</span>' : '') + '</div>' +
    '<div class="note" role="status">' + esc(noteText(v, lg)) + '</div>' +
    handHtml(v, lg) +
    '<div class="actions">' + btns + '</div></div>';
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
  var out = '', v = app.ctrl && app.screen === 'game' ? app.ctrl.view() : null;
  if (v && v.gameOver) {
    var res = v.loser < 0 ? 'draw' : (v.loser === mySeat() ? 'lose' : 'win');
    out += '<div class="scrim"><div class="modal over ' + res + '" role="alertdialog" aria-modal="true"><h2>' + esc(tr('over.' + res)) + '</h2><p>' + esc(tr('over.' + res + '.' + v.reason, { name: v.loser >= 0 ? nameOf(v, v.loser) : '' })) + '</p>' + rewardHtml(v) +
      '<button class="btn primary full" data-act="again">' + esc(tr(app.ctrl.online ? 'o.over.again' : 'over.again')) + '</button><button class="btn full" data-act="menu">' + esc(tr('over.menu')) + '</button></div></div>';
  }
  if (app.ctrl && app.ctrl.online && app.screen === 'game') out += window.DurakOnline.askHtml();
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
var LOGO = '<div class="logo-dk" aria-hidden="true">' + cardHtml('6S') + cardHtml('AH') + cardHtml('KD') + '</div>';
function segHtml(act, items, sel, prefix) {
  return '<div class="modes seg">' + items.map(function (it) { return '<button class="mode-btn" data-act="' + act + '" data-v="' + it + '" aria-pressed="' + (String(sel) === String(it)) + '">' + esc(tr((prefix || 'start.' + act) + '.' + it)) + '</button>'; }).join('') + '</div>';
}
function startHtml() {
  return '<div class="start"><div class="brand-row"><div class="brand">' + LOGO + '<h1>' + esc(tr('title')) + '</h1></div>' +
    '<div class="top-actions">' + catalogLinkHtml() + themeButtonHtml('theme-btn') + '</div></div>' +
    '<div class="muted-text">' + esc(tr('sub')) + '</div>' +
    '<div class="field"><div class="field-title">' + esc(tr('start.mode')) + '</div><div class="modes duo">' +
      ['bot', 'online'].map(function (m) { return '<button class="mode-btn" data-act="mode" data-v="' + m + '" aria-pressed="' + (app.mode === m) + '">' + esc(tr('start.' + m)) + '<small>' + esc(tr('start.' + m + 'Sub')) + '</small></button>'; }).join('') + '</div></div>' +
    (app.mode === 'bot'
      ? '<div class="field"><div class="field-title">' + esc(tr('start.variant')) + '</div>' + segHtml('variant', D.CONFIG.variants, app.variant) + '</div>' +
        '<div class="field"><div class="field-title">' + esc(tr('start.deck')) + '</div>' + segHtml('deck', D.CONFIG.decks, app.deck) + '</div>' +
        '<div class="field"><div class="field-title">' + esc(tr('start.players')) + '</div>' + segHtml('players', [2, 3, 4, 5, 6], app.players) + '</div>' +
        '<div class="field"><div class="field-title">' + esc(tr('start.level')) + '</div>' + segHtml('level', D.CONFIG.botLevels, app.level) + '</div>'
      : '') +
    '<div class="start-actions"><button class="btn-play" data-act="play">' + esc(tr('start.play')) + '</button><button class="btn-secondary wide" data-act="rules">' + esc(tr('rules.button')) + '</button></div></div>';
}

// ===== Партия против ботов: идёт в браузере, награда — если не остался дураком =====
function botController(level, variant, deck, players) {
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
    st = D.init(seats, { mode: variant + (deck === 52 ? '-52' : '') });
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
    }, BOT_MS[level]);
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

// ===== Отрисовка и нажатия =====
function render() {
  var html, v = null;
  if (app.screen === 'game' && app.ctrl) {
    v = app.ctrl.view();
    html = gameHtml(v);
    if (app.ctrl.online) html = window.DurakOnline.bannerHtml() + html;
  } else if (app.screen === 'online') html = window.DurakOnline.html();
  else html = startHtml();
  var ai = document.activeElement, keep = ai && ai.tagName === 'INPUT' && ai.id && appEl.contains(ai) ? { id: ai.id, a: ai.selectionStart, b: ai.selectionEnd } : null;
  appEl.innerHTML = '<div class="screen">' + html + '</div>' + modalHtml() + (window.DurakOnline ? window.DurakOnline.overlayHtml() : '');
  if (keep) { var ni = document.getElementById(keep.id); if (ni) { try { ni.focus({ preventScroll: true }); if (keep.a !== null) ni.setSelectionRange(keep.a, keep.b); } catch (e) { /* без фокуса */ } } }
  if (v) app.shownMove = v.moves;
  if (window.DurakOnline) window.DurakOnline.afterRender();
}
function startGame(ctrl) {
  app.ctrl = ctrl; app.screen = 'game'; app.pick = null; app.confirm = false; app.shownMove = -1;
  ctrl.subscribe(function () { if (app.ctrl === ctrl) render(); });
  render();
}
function toMenu() {
  if (app.ctrl) app.ctrl.leave();
  app.ctrl = null; app.screen = 'start'; app.confirm = false; app.pick = null; render();
}
// Нажали карту в руке: ход или подкидывание сразу; при отбое — сразу, если бить можно только одну карту, иначе выбор карты на столе
function onCard(c) {
  var v = app.ctrl.view(), lg = legalNow(v), me = mySeat();
  if (!myTurn(v)) return;
  if (lg.attack.indexOf(c) >= 0) { app.ctrl.send({ type: 'attack', seat: me, card: c }); app.pick = null; render(); return; }
  var ways = lg.defend.filter(function (d) { return d.card === c; }), canTr = lg.transfer.indexOf(c) >= 0;
  if (ways.length === 1 && !canTr) { app.ctrl.send({ type: 'defend', seat: me, card: c, target: ways[0].target }); app.pick = null; render(); return; }
  if (!ways.length && canTr) { app.ctrl.send({ type: 'transfer', seat: me, card: c }); app.pick = null; render(); return; }
  app.pick = ways.length || canTr ? (app.pick === c ? null : c) : null;
  render();
}
appEl.addEventListener('click', function (e) {
  var hc = e.target.closest('[data-card]');
  if (hc && app.ctrl && app.screen === 'game') { onCard(hc.getAttribute('data-card')); return; }
  var tg = e.target.closest('[data-target]');
  if (tg && app.ctrl && app.pick) { app.ctrl.send({ type: 'defend', seat: mySeat(), card: app.pick, target: Number(tg.getAttribute('data-target')) }); app.pick = null; render(); return; }
  var el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (window.DurakOnline && window.DurakOnline.click(el)) return;
  var act = el.getAttribute('data-act'), ctrl = app.ctrl, val = el.getAttribute('data-v');
  switch (act) {
    case 'theme': window.PlatformTheme.toggle(); break;
    case 'rules': app.rules = true; render(); break;
    case 'closeRules': app.rules = false; render(); break;
    case 'play': startGame(botController(app.level, app.variant, app.deck, app.players)); break;
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
    case 'again': app.pick = null; app.shownMove = -1; ctrl.again(); render(); break;
  }
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (app.rules) app.rules = false; else if (app.confirm) app.confirm = false; else if (app.pick) app.pick = null; else return;
  render();
});
window.PlatformTheme.onChange(function () { render(); });
render();
