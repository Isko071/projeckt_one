// ===== Интерфейс игры «Ятзи» =====
// Все надписи берутся из словаря (games/yahtzee/ru.js) по ключам games.yahtzee.*.
// Тема и имя игрока приходят из общих модулей платформы (shared/theme.js, shared/profile.js).
var CATALOG_URL = '../../index.html';
var tr = function (key, params) { return window.I18n.t('games.yahtzee.' + key, params); };
var label = function (cat) { return tr('cat.' + cat); };
var SUBS = { threeKind: '3+', fourKind: '4+', fullHouse: '25', smallStraight: '30', largeStraight: '40', yahtzee: '50' };
var PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

var game = null;
var app = {
  screen: 'start', mode: 'cpu', level: 'hard',
  thinking: false, rolling: false, display: null, modal: null
};
var gameToken = 0; // увеличивается при выходе из партии, чтобы остановить ход компьютера и анимацию
var appEl = document.getElementById('app');

// ===== Тема: общий модуль платформы (shared/theme.js), выбор общий для каталога и всех игр =====
function isDarkTheme() { return window.PlatformTheme.isDark(); }
function toggleTheme() { window.PlatformTheme.toggle(); }

// Ссылка на каталог платформы (значок-сетка)
function catalogLinkHtml() {
  return '<a class="theme-btn" href="' + CATALOG_URL + '" aria-label="' + esc(tr('toCatalog')) + '" title="' + esc(tr('toCatalog')) + '">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/>' +
    '<rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg></a>';
}

function themeButtonHtml() {
  var dark = isDarkTheme();
  var icon = dark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 13.2A8.5 8.5 0 1 1 10.8 3a6.7 6.7 0 0 0 10.2 10.2z"/></svg>';
  return '<button class="theme-btn" data-act="theme" data-key="theme" aria-label="' +
    window.I18n.t(dark ? 'theme.toLight' : 'theme.toDark') + '">' + icon + '</button>';
}

function isHumanTurn() {
  return !(app.mode === 'cpu' && game.current === 1);
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function startGame() {
  var first = (window.PlatformProfile.getProfile().name || '').trim() || tr('player1');       // ник берётся из профиля
  var second = app.mode === 'cpu' ? tr('computer') : tr('player2');
  gameToken++;
  app.thinking = false;
  app.rolling = false;
  app.display = null;
  app.modal = null;
  game = createGame([first, second]);
  app.reward = null;
  app.screen = 'game';
  window.PlatformWallet.markPlayed(); // партия начата: серия дней и бонус дня
  window.PlatformWallet.countPlay('yahtzee');
}

function toMenu() {
  gameToken++;
  app.thinking = false;
  app.rolling = false;
  app.display = null;
  app.modal = null;
  app.screen = 'start';
}

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

// Бросок с анимацией: итог уже в состоянии, на экране кубики недолго «крутятся»
async function rollAnimated() {
  var token = gameToken;
  if (app.rolling || !roll(game)) return;
  if (!prefersReducedMotion()) {
    var finalDice = game.dice.slice();
    var held = game.held.slice();
    app.rolling = true;
    // Кубики «замедляются»: интервалы между сменами граней растут
    var pauses = [60, 70, 80, 95, 115, 140, 170];
    for (var t = 0; t < pauses.length; t++) {
      app.display = finalDice.map(function (v, i) { return held[i] ? v : 1 + Math.floor(Math.random() * 6); });
      render();
      await sleep(pauses[t]);
      if (token !== gameToken) return;
    }
  }
  app.rolling = false;
  app.display = null;
  render();
}

// Ход компьютера: бросок, до двух добросов с лучшим выбором кубиков, запись в лучшую по ценности клетку
async function cpuTurn() {
  var token = gameToken;
  var alive = function () { return token === gameToken; };
  app.thinking = true;
  render();
  await sleep(800); if (!alive()) return;
  await rollAnimated(); if (!alive()) return;
  for (var k = 0; k < 2; k++) {
    await sleep(700); if (!alive()) return;
    var hold = cpuChooseHold(game.players[game.current], game.dice, rollsLeft(game), app.level);
    game.held = hold; render();
    if (hold.every(Boolean)) break; // все кубики оставлены — добрасывать невыгодно
    await sleep(1000); if (!alive()) return;
    await rollAnimated(); if (!alive()) return;
  }
  await sleep(900); if (!alive()) return;
  var cat = cpuChooseCategory(game.players[game.current], game.dice, app.level);
  app.thinking = false;
  scoreCategory(game, cat);
  render();
  continueIfCpu();
}

function continueIfCpu() {
  if (app.mode === 'cpu' && !app.thinking && !game.gameOver && game.current === 1) cpuTurn();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function statusText() {
  if (game.gameOver) return '';
  if (app.thinking) return tr('status.thinking');
  if (app.rolling) return tr('status.rolling');
  if (game.rollsUsed === 0) return tr('status.first');
  if (game.rollsUsed >= MAX_ROLLS) return tr('status.pick');
  return tr('status.holdOrRoll');
}

function rollLabel() {
  if (app.thinking) return tr('roll.cpuTurn');
  if (app.rolling) return tr('status.rolling');
  if (game.rollsUsed === 0) return tr('roll.first');
  if (game.rollsUsed < MAX_ROLLS) return tr('roll.more', { n: rollsLeft(game) });
  return tr('roll.none');
}

function diceHtml() {
  var fresh = game.rollsUsed === 0 && !app.rolling;
  var canToggle = isHumanTurn() && !app.rolling && !game.gameOver && game.rollsUsed > 0 && game.rollsUsed < MAX_ROLLS;
  var shown = app.display || game.dice;
  return shown.map(function (v, i) {
    var held = game.held[i];
    var spinning = app.rolling && !held;
    var dieLabel = fresh ? tr('die.fresh', { n: i + 1 }) : tr(held ? 'die.held' : 'die.value', { n: i + 1, v: v });
    var pips = '';
    for (var k = 0; k < 9; k++) {
      var cls = !fresh && PIPS[v].indexOf(k) >= 0 ? 'on' : (fresh && k === 4 ? 'ph' : '');
      pips += '<span><i class="' + cls + '"></i></span>';
    }
    return '<button class="die-btn" data-key="die-' + i + '" data-die="' + i + '" aria-pressed="' + held +
      '" aria-label="' + esc(dieLabel) + '"' + (canToggle ? '' : ' disabled') + '>' +
      '<span class="die' + (fresh ? ' fresh' : '') + (held ? ' held' : '') + (spinning ? ' rolling' : '') + '">' + pips + '</span>' +
      '<span class="die-tag">' + (held ? esc(tr('die.tag')) : '') + '</span></button>';
  }).join('');
}

// Ячейка таблицы: игрок pi, категория cat
function catCellHtml(pi, cat, hints) {
  var player = game.players[pi];
  var value = player.scores[cat];
  var name = label(cat);
  if (value !== null) {
    return '<button class="cell filled' + (value === 0 ? ' zero' : '') + '" disabled aria-label="' + esc(tr('cell.filled', { name: name, v: value })) + '">' + value + '</button>';
  }
  if (pi === game.current && hints) {
    if (hints.allowed.indexOf(cat) >= 0) {
      var pts = possibleScore(player, cat, game.dice);
      var best = cat === hints.best;
      return '<button class="cell hint' + (best ? ' best' : '') + '" data-key="cat-' + cat + '" data-cat="' + cat +
        '" aria-label="' + esc(tr('cell.write', { name: name, v: pts })) + '">' + pts + '</button>';
    }
    return '<button class="cell blocked" disabled aria-label="' + esc(tr('cell.blocked', { name: name })) + '">—</button>';
  }
  return '<button class="cell" disabled aria-label="' + esc(tr('cell.empty', { name: name })) + '"></button>';
}

function getHints() {
  if (game.gameOver || game.rollsUsed === 0 || app.rolling || !isHumanTurn()) return null;
  var player = game.players[game.current];
  var allowed = allowedCategories(player, game.dice);
  var best = null, bestPts = 0;
  allowed.forEach(function (c) {
    var p = possibleScore(player, c, game.dice);
    if (p > bestPts) { bestPts = p; best = c; }
  });
  return { allowed: allowed, best: best };
}

function rowHtml(cls, label, sub, cells) {
  return '<div class="grid row ' + cls + '"><span class="label">' + label +
    (sub ? '<small>' + sub + '</small>' : '') + '</span>' + cells + '</div>';
}

function infoCells(fn) {
  return game.players.map(function (p) { return fn(p); }).join('');
}

function plainCell(text, cls) {
  return '<span class="cell ' + (cls || '') + '">' + text + '</span>';
}

function sheetHeadHtml() {
  return '<div class="grid sheet-head"><span></span>' + game.players.map(function (p, i) {
    return '<span class="head-name' + (i === game.current && !game.gameOver ? ' current' : '') + '">' + esc(p.name) + '</span>';
  }).join('') + '</div>';
}

function upperSheetHtml(hints) {
  var html = sheetHeadHtml() + rowHtml('section', esc(tr('sheet.upper')), '', '<span></span><span></span>');
  UPPER.forEach(function (cat) {
    html += rowHtml('', esc(label(cat)), SUBS[cat], game.players.map(function (p, pi) { return catCellHtml(pi, cat, hints); }).join(''));
  });
  html += rowHtml('info', esc(tr('sheet.sum')), '', infoCells(function (p) { return plainCell(upperSum(p), 'muted'); }));
  html += rowHtml('info', esc(tr('sheet.bonus')), '', infoCells(function (p) {
    var u = upperSum(p);
    return u >= UPPER_BONUS_THRESHOLD ? plainCell('+' + UPPER_BONUS, 'accent') : plainCell(u + '/' + UPPER_BONUS_THRESHOLD, 'muted');
  }));
  return html;
}

function lowerSheetHtml(hints) {
  var html = sheetHeadHtml() + rowHtml('section', esc(tr('sheet.lower')), '', '<span></span><span></span>');
  LOWER.forEach(function (cat) {
    html += rowHtml('', esc(label(cat)), SUBS[cat], game.players.map(function (p, pi) { return catCellHtml(pi, cat, hints); }).join(''));
  });
  html += rowHtml('info top-line', esc(tr('sheet.yahtzeeBonus')), '', infoCells(function (p) {
    return p.yahtzeeBonuses ? plainCell('+' + p.yahtzeeBonuses * YAHTZEE_BONUS, 'accent') : plainCell('—', 'muted');
  }));
  html += rowHtml('total', esc(tr('sheet.total')), '', infoCells(function (p) { return plainCell(totalScore(p)); }));
  return html;
}

function gameOverHtml() {
  var totals = game.players.map(totalScore);
  var max = Math.max.apply(null, totals);
  var winners = totals.filter(function (t) { return t === max; }).length;
  var title = winners > 1 ? esc(tr('over.draw')) : esc(tr('over.winner', { name: game.players[totals.indexOf(max)].name }));
  var rows = game.players.map(function (p, i) {
    return '<div class="result' + (winners === 1 && totals[i] === max ? ' win' : '') + '"><span>' + esc(p.name) + '</span><b>' + totals[i] + '</b></div>';
  }).join('');
  return '<div class="overlay" role="dialog" aria-label="' + esc(tr('over.aria')) + '"><div class="dialog">' +
    '<div><small>' + esc(tr('over.title')) + '</small><h2>' + title + '</h2></div>' +
    '<div class="results">' + rows + '</div>' + rewardHtml() +
    '<div class="dialog-actions"><button class="btn-secondary" id="menu" data-key="menu">' + esc(tr('over.toMenu')) + '</button>' +
    '<button class="btn-primary" id="again" data-key="again">' + esc(tr('over.again')) + '</button></div></div></div>';
}

function rulesHtml() {
  function block(name) {
    return '<div class="rule"><b>' + esc(tr('rules.' + name + '.title')) + '</b><span>' + esc(tr('rules.' + name + '.text')) + '</span></div>';
  }
  return '<div class="overlay sheet-overlay" role="dialog" aria-modal="true" aria-label="' + esc(tr('rules.title')) + '"><div class="dialog rules">' +
    '<div class="rules-head"><h2>' + esc(tr('rules.title')) + '</h2><button class="btn-secondary small" data-act="close" data-autofocus data-key="close">' + esc(tr('close')) + '</button></div>' +
    block('turn') + block('upper') + block('lower') + block('joker') + block('total') + (window.YahtzeeOnlineUI && app.screen === 'online' ? block('online') : '') +
    '</div></div>';
}

function confirmHtml() {
  return '<div class="overlay" role="alertdialog" aria-modal="true" aria-label="' + esc(tr('confirm.aria')) + '"><div class="dialog">' +
    '<h2>' + esc(tr('confirm.title')) + '</h2><span class="muted-text">' + esc(tr('confirm.text')) + '</span>' +
    '<div class="dialog-actions"><button class="btn-secondary" data-act="close" data-autofocus data-key="cancel">' + esc(tr('cancel')) + '</button>' +
    '<button class="btn-primary" data-act="restart" data-key="restart">' + esc(tr('confirm.ok')) + '</button></div></div></div>';
}

// Выход в меню игры из незаконченной партии: подтверждение, «Выйти» возвращает на стартовый экран
function exitHtml() {
  return '<div class="overlay" role="alertdialog" aria-modal="true" aria-label="' + esc(tr('exit.aria')) + '"><div class="dialog">' +
    '<h2>' + esc(tr('exit.title')) + '</h2><span class="muted-text">' + esc(tr('confirm.text')) + '</span>' +
    '<div class="dialog-actions"><button class="btn-secondary" data-act="close" data-autofocus data-key="cancel">' + esc(tr('exit.stay')) + '</button>' +
    '<button class="btn-primary" data-act="menu" data-key="exit-ok">' + esc(tr('exit.ok')) + '</button></div></div></div>';
}

function modalHtml() {
  if (app.screen === 'online' && window.YahtzeeOnlineUI) return window.YahtzeeOnlineUI.modalHtml();
  if (app.modal === 'rules') return rulesHtml();
  if (app.modal === 'confirm') return confirmHtml();
  if (app.modal === 'exit') return exitHtml();
  return '';
}

function startHtml() {
  var logo = [5, 3, 6].map(function (v, i) {
    var pips = '';
    for (var k = 0; k < 9; k++) pips += '<span><i class="' + (PIPS[v].indexOf(k) >= 0 ? 'on' : '') + '"></i></span>';
    return '<div class="die-mini" style="transform:rotate(' + [-8, 4, -3][i] + 'deg)">' + pips + '</div>';
  }).join('');
  var cpu = app.mode === 'cpu', online = app.mode === 'online';
  return '<div class="start">' +
    '<div class="brand-row"><div class="brand"><div class="logo">' + logo + '</div><h1>' + esc(tr('title')) + '</h1></div>' +
      '<div class="top-actions">' + catalogLinkHtml() + themeButtonHtml() + '</div></div>' +
    '<div class="field"><div class="field-title">' + esc(tr('start.mode')) + '</div><div class="modes">' +
      '<button class="mode-btn" data-key="mode-cpu" data-mode="cpu" aria-pressed="' + cpu + '">' + esc(tr('start.modeCpu')) + '</button>' +
      '<button class="mode-btn" data-key="mode-hot" data-mode="hot" aria-pressed="' + (app.mode === 'hot') + '">' + esc(tr('start.modeHot')) + '</button>' +
      (window.YahtzeeOnlineUI ? '<button class="mode-btn" data-key="mode-online" data-mode="online" aria-pressed="' + online + '">' + esc(tr('start.modeOnline')) + '</button>' : '') +
    '</div></div>' +
    (cpu ? '<div class="field"><div class="field-title">' + esc(tr('start.level')) + '</div><div class="levels">' +
      '<button class="mode-btn" data-key="level-easy" data-level="easy" aria-pressed="' + (app.level === 'easy') + '">' + esc(tr('start.levelEasy')) + '</button>' +
      '<button class="mode-btn" data-key="level-hard" data-level="hard" aria-pressed="' + (app.level === 'hard') + '">' + esc(tr('start.levelHard')) + '</button>' +
    '</div></div>' : '') +
    (online ? '<div class="muted-text">' + esc(tr('start.onlineSub')) + '</div>' : '') +
    '<div class="start-actions"><button class="btn-play" id="play" data-key="play">' + esc(tr('start.play')) + '</button>' +
      '<button class="btn-secondary wide" data-act="rules" data-key="rules">' + esc(tr('rules.button')) + '</button></div></div>';
}

function gameHtml() {
  var hints = getHints();
  var dots = '';
  for (var i = 0; i < MAX_ROLLS; i++) dots += '<i class="' + (i < rollsLeft(game) ? 'on' : '') + '"></i>';
  var canRoll = isHumanTurn() && !app.thinking && !app.rolling && !game.gameOver && game.rollsUsed < MAX_ROLLS;

  return '<div class="topbar"><div class="topbar-head"><div class="turn"><small>' + esc(tr('turn')) + '</small><strong>' +
      (game.gameOver ? esc(tr('over.title')) : esc(game.players[game.current].name)) + '</strong></div>' + themeButtonHtml() + '</div>' +
      '<div class="topbar-actions"><button class="btn-secondary small" data-act="rules" data-key="rules">' + esc(tr('rules.button')) + '</button>' +
      '<button class="btn-secondary small" data-act="confirm" data-key="new">' + esc(tr('newGame')) + '</button>' +
      '<button class="btn-secondary small" data-act="' + (game.gameOver ? 'menu' : 'exit') + '" data-key="exit">' + esc(tr('over.toMenu')) + '</button></div></div>' +
    '<div class="layout">' +
      '<section class="card play">' +
        '<div class="status-row"><span class="status" aria-live="polite">' + statusText() + '</span>' +
          '<span class="roll-dots" role="img" aria-label="' + esc(tr('rollsLeft', { n: rollsLeft(game) })) + '">' + dots + '</span></div>' +
        '<div class="dice">' + diceHtml() + '</div>' +
        '<button class="roll-btn" id="roll" data-key="roll"' + (canRoll ? '' : ' disabled') + '>' + rollLabel() + '</button>' +
      '</section>' +
      '<section class="card sheet">' + upperSheetHtml(hints) + '</section>' +
      '<section class="card sheet">' + lowerSheetHtml(hints) + '</section>' +
    '</div>' +
    (game.gameOver ? gameOverHtml() : '');
}

// Обновляет существующие узлы по новой разметке: элементы сохраняются, поэтому работают CSS-переходы и фокус
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

// Награда за победу над компьютером: один раз за партию, размер зависит от уровня
function settleReward() {
  var totals = game.players.map(totalScore);
  var won = app.mode === 'cpu' && totals[0] > totals[1];
  var base = won ? window.PlatformWallet.CONFIG.rewards.yahtzee[app.level] : 0;
  var res = base ? window.PlatformWallet.earn('yahtzee', base) : { granted: 0, capped: false };
  app.reward = { won: won, granted: res.granted, capped: res.capped };
}

function rewardHtml() {
  var r = app.reward;
  if (!r || !r.won) return '';
  if (r.granted > 0) return '<div class="reward">' + esc(tr('reward.earned', { n: r.granted.toLocaleString('ru-RU'), unit: window.I18n.plural(r.granted, 'wallet.unit') })) + '</div>';
  return '<div class="reward muted">' + esc(tr('reward.limit')) + '</div>';
}

function render() {
  if (game && game.gameOver && !app.reward) settleReward();
  var tpl = document.createElement('template');
  tpl.innerHTML = '<div class="screen" data-morph-key="' + app.screen + '">' +
    (app.screen === 'start' ? startHtml() : (app.screen === 'online' && window.YahtzeeOnlineUI ? window.YahtzeeOnlineUI.html() : gameHtml())) + '</div>' + (window.YahtzeeOnlineUI ? window.YahtzeeOnlineUI.overlayHtml() : '') + modalHtml();
  morph(appEl, tpl.content);
  if (window.YahtzeeOnlineUI) window.YahtzeeOnlineUI.afterRender();
  if (app.modal) {
    var auto = appEl.querySelector('[data-autofocus]');
    if (auto && !auto.closest('.overlay').contains(document.activeElement)) auto.focus();
  }
}

// Закрытие окна с плавным исчезновением
function closeModal() {
  var overlay = appEl.querySelector('.overlay');
  if (!overlay || prefersReducedMotion()) { app.modal = null; render(); return; }
  overlay.classList.add('closing');
  setTimeout(function () { app.modal = null; render(); }, 180);
}

appEl.addEventListener('click', function (e) {
  var btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  if (app.screen === 'online' && window.YahtzeeOnlineUI && window.YahtzeeOnlineUI.click(btn)) return;
  var act = btn.getAttribute('data-act');
  if (act === 'rules' || act === 'confirm' || act === 'exit') app.modal = act;
  else if (act === 'menu') toMenu();
  else if (act === 'theme') toggleTheme();
  else if (act === 'close') { closeModal(); return; }
  else if (act === 'restart') startGame();
  else if (btn.hasAttribute('data-mode')) { app.mode = btn.getAttribute('data-mode'); if (app.mode === 'online' && window.GAME_SERVER_URL && window.PlatformRoomsWS) window.PlatformRoomsWS.warm(window.GAME_SERVER_URL); }
  else if (btn.hasAttribute('data-level')) app.level = btn.getAttribute('data-level');
  else if (btn.id === 'play' && app.mode === 'online' && window.YahtzeeOnlineUI) { window.YahtzeeOnlineUI.enter(); return; }
  else if (btn.id === 'play' || btn.id === 'again') startGame();
  else if (btn.id === 'menu') toMenu();
  else if (btn.id === 'roll') { rollAnimated(); return; }
  else if (btn.hasAttribute('data-die')) toggleHold(game, Number(btn.getAttribute('data-die')));
  else if (btn.hasAttribute('data-cat')) scoreCategory(game, btn.getAttribute('data-cat'));
  render();
  if (app.screen === 'game') continueIfCpu();
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && app.modal) closeModal();
});

window.PlatformTheme.onChange(render); // тему можно сменить и в системе, и кнопкой
document.title = tr('title');

render();
