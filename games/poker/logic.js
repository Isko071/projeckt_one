// Чистая логика покера (техасский холдем, без лимита): колода, оценка комбинаций, торговля, блайнды, олл-ин, побочные банки.
// Без window и document: тестируется в node. Игра описана как init / reduce / view (см. docs/multiplayer.md): её ведёт
// shared/game-session.js, а позже сервер столов. Скрытые карты прячет view(state, seat).
//
// Карта — строка из двух символов: достоинство (2 3 4 5 6 7 8 9 T J Q K A) и масть (S H D C), например 'AS', 'TH'.
//
// Правила (No-Limit Texas Hold'em, 2–6 мест):
//  • Каждому по две карты, затем общие: флоп (3), тёрн (1), ривер (1); после каждой улицы круг торговли.
//  • Блайнды: малый и большой (CONFIG.smallBlind / bigBlind). Кнопка дилера двигается по кругу. Вдвоём кнопка ставит малый блайнд и ходит первой
//    до флопа, после флопа первой ходит соперник.
//  • Ставка («рейз до») не меньше текущей ставки плюс последнее повышение (минимум большой блайнд). Можно пойти олл-ин на любую сумму.
//    Неполный олл-ин-рейз (меньше минимального повышения) не открывает торговлю заново тем, кто уже ходил: они могут только уравнять или сбросить.
//  • Выигрывает лучшая комбинация из пяти карт (из семи). Банки с разными суммами (побочные) делятся строго по вкладам; ничья делит банк,
//    лишняя фишка достаётся ближайшему слева от кнопки; ставка, которую никто не уравнял, возвращается.
//  • Если все сбросили, кроме одного, он забирает банк без вскрытия.
//
// Действия (поле seat — номер места):
//   { type: 'deal', seat }            начать раздачу (нужно минимум двое с фишками); то же — { type: 'next', seat } после конца раздачи
//   { type: 'fold' | 'check' | 'call' | 'allin', seat }
//   { type: 'raise', seat, amount }   ставка или повышение ДО amount (общая ставка игрока на этой улице)
//   { type: 'sitout', seat, value }   пропускать раздачи (value: false — вернуться)
//   { type: 'join', seat, id, name, chips, kind }  занять свободное место между раздачами (kind: 'human' | 'bot')
//   { type: 'leave', seat }           уйти из-за стола (в раздаче карты сбрасываются)
//   { type: 'timeout', seat }         время хода вышло: чек, если можно, иначе сброс
(function (root) {
  var RANKS = '23456789TJQKA'.split('');
  var SUITS = ['S', 'H', 'D', 'C'];
  var CONFIG = { minSeats: 2, maxSeats: 6, smallBlind: 25, bigBlind: 50 };
  var HAND_NAMES = ['high', 'pair', 'twoPair', 'trips', 'straight', 'flush', 'fullHouse', 'quads', 'straightFlush'];
  var STREETS = ['preflop', 'flop', 'turn', 'river'];

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function rankValue(card) { return RANKS.indexOf(card.charAt(0)) + 2; }
  function suitOf(card) { return card.charAt(1); }

  // ===== Колода =====
  function buildDeck() {
    var d = [];
    SUITS.forEach(function (s) { RANKS.forEach(function (r) { d.push(r + s); }); });
    return d;
  }
  function shuffled(rng) {
    var d = buildDeck();
    for (var i = d.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = d[i]; d[i] = d[j]; d[j] = t; }
    return d;
  }

  // ===== Оценка комбинаций =====
  // Пять карт → { score: [категория, подкатегории...], cat, name, cards }; категории по возрастанию силы: 0 старшая карта … 8 стрит-флеш
  function evaluate5(cards) {
    var vals = cards.map(rankValue).sort(function (a, b) { return b - a; });
    var flush = cards.every(function (c) { return suitOf(c) === suitOf(cards[0]); });
    var counts = {};
    vals.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    var groups = Object.keys(counts).map(function (v) { return { v: Number(v), n: counts[v] }; })
      .sort(function (a, b) { return b.n - a.n || b.v - a.v; });
    var straightHigh = 0;
    if (groups.length === 5) {
      if (vals[0] - vals[4] === 4) straightHigh = vals[0];
      else if (vals[0] === 14 && vals[1] === 5 && vals[4] === 2) straightHigh = 5;      // колесо: туз считается единицей
    }
    var cat, score;
    if (straightHigh && flush) { cat = 8; score = [8, straightHigh]; }
    else if (groups[0].n === 4) { cat = 7; score = [7, groups[0].v, groups[1].v]; }
    else if (groups[0].n === 3 && groups[1].n === 2) { cat = 6; score = [6, groups[0].v, groups[1].v]; }
    else if (flush) { cat = 5; score = [5].concat(vals); }
    else if (straightHigh) { cat = 4; score = [4, straightHigh]; }
    else if (groups[0].n === 3) { cat = 3; score = [3, groups[0].v, groups[1].v, groups[2].v]; }
    else if (groups[0].n === 2 && groups[1].n === 2) { cat = 2; score = [2, groups[0].v, groups[1].v, groups[2].v]; }
    else if (groups[0].n === 2) { cat = 1; score = [1, groups[0].v, groups[1].v, groups[2].v, groups[3].v]; }
    else { cat = 0; score = [0].concat(vals); }
    return { score: score, cat: cat, name: cat === 8 && straightHigh === 14 ? 'royalFlush' : HAND_NAMES[cat], cards: cards.slice() };
  }

  function compareScores(a, b) {
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var x = a[i] || 0, y = b[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  // Лучшая пятёрка из 5–7 карт
  function evaluate(cards) {
    if (cards.length === 5) return evaluate5(cards);
    var best = null, n = cards.length;
    (function pick(start, chosen) {
      if (chosen.length === 5) {
        var h = evaluate5(chosen);
        if (!best || compareScores(h.score, best.score) > 0) best = h;
        return;
      }
      for (var i = start; i < n; i++) { chosen.push(cards[i]); pick(i + 1, chosen); chosen.pop(); }
    })(0, []);
    return best;
  }

  // ===== Состояние =====
  function blankSeat(i) {
    return { index: i, active: false, id: null, name: '', kind: 'human', chips: 0, sitOut: false, inHand: false, folded: false, allIn: false,
      bet: 0, total: 0, cards: [], acted: false, locked: false, net: 0, shown: false, hand: null, last: null };
  }
  function occupy(seat, s) {
    seat.active = true; seat.id = s.id; seat.name = s.name || ''; seat.kind = s.kind === 'bot' ? 'bot' : 'human';
    seat.chips = Math.max(0, Math.floor(Number(s.chips) || 0)); seat.sitOut = false;
  }

  // seats: [{ id, name, chips, kind }]; options: { tableSize, smallBlind, bigBlind }
  function init(seats, options, rng) {
    options = options || {};
    var size = Math.max(CONFIG.minSeats, Math.min(CONFIG.maxSeats, Math.floor(options.tableSize) || seats.length || CONFIG.minSeats));
    var bb = Math.max(2, Math.floor(options.bigBlind) || CONFIG.bigBlind), sb = Math.max(1, Math.floor(options.smallBlind) || Math.floor(bb / 2));
    var st = { round: 0, phase: 'waiting', smallBlind: sb, bigBlind: bb, button: -1, current: -1, currentBet: 0, minRaise: bb, board: [], deck: [], pot: 0, pots: [], result: null, seats: [] };
    for (var i = 0; i < size; i++) st.seats.push(blankSeat(i));
    seats.slice(0, size).forEach(function (s, i) { occupy(st.seats[i], s); });
    return st;
  }

  function canPlay(s) { return s.active && !s.sitOut && s.chips > 0; }
  function canDeal(st) { return (st.phase === 'waiting' || st.phase === 'settled') && st.seats.filter(canPlay).length >= 2; }
  function live(st) { return st.seats.filter(function (s) { return s.inHand && !s.folded; }); }
  function ableToAct(st) { return st.seats.filter(function (s) { return s.inHand && !s.folded && !s.allIn; }); }
  function potOf(st) { return st.seats.reduce(function (n, s) { return n + s.total; }, 0); }

  // Следующее место по кругу после from, подходящее под условие
  function nextSeat(st, from, ok) {
    var n = st.seats.length;
    for (var k = 1; k <= n; k++) { var i = (from + k) % n; if (ok(st.seats[i])) return i; }
    return -1;
  }

  function post(s, amount) {
    var pay = Math.min(s.chips, amount);
    s.chips -= pay; s.bet += pay; s.total += pay;
    if (s.chips === 0) s.allIn = true;
    return pay;
  }

  // ===== Раздача =====
  function startHand(st, rng) {
    st.round++; st.board = []; st.pots = []; st.result = null; st.deck = shuffled(rng);
    st.seats.forEach(function (s) {
      s.inHand = canPlay(s); s.folded = false; s.allIn = false; s.bet = 0; s.total = 0; s.cards = []; s.acted = false; s.locked = false;
      s.net = 0; s.shown = false; s.hand = null; s.last = null;
    });
    st.button = nextSeat(st, st.button, function (s) { return s.inHand; });
    var headsUp = st.seats.filter(function (s) { return s.inHand; }).length === 2;
    var sbSeat = headsUp ? st.button : nextSeat(st, st.button, function (s) { return s.inHand; });
    var bbSeat = nextSeat(st, sbSeat, function (s) { return s.inHand; });
    post(st.seats[sbSeat], st.smallBlind); post(st.seats[bbSeat], st.bigBlind);
    st.currentBet = Math.max(st.seats[sbSeat].bet, st.seats[bbSeat].bet);
    st.minRaise = st.bigBlind;
    st.seats.forEach(function (s) { if (s.inHand) s.cards = [st.deck.pop(), st.deck.pop()]; });
    st.phase = 'preflop';
    st.current = nextSeat(st, bbSeat, function (s) { return s.inHand && !s.folded && !s.allIn; });
    st.pot = potOf(st);
    progress(st);
  }

  // Конец круга торговли?
  function roundDone(st) {
    var able = ableToAct(st);
    if (live(st).length <= 1) return true;
    if (able.length === 0) return true;
    if (able.length === 1) return able[0].bet >= st.currentBet;
    return able.every(function (s) { return s.acted && s.bet === st.currentBet; });
  }

  // Двигает раздачу вперёд: передаёт ход, открывает улицы, подводит итог
  function progress(st) {
    for (var guard = 0; guard < 10; guard++) {
      st.pot = potOf(st);
      if (live(st).length <= 1) { showdown(st); return; }
      if (!roundDone(st)) {
        if (st.current < 0 || !canActNow(st.seats[st.current])) st.current = nextSeat(st, Math.max(st.current, 0), canActNow);
        return;
      }
      if (st.phase === 'river') { showdown(st); return; }
      nextStreet(st);
    }
  }
  function canActNow(s) { return s.inHand && !s.folded && !s.allIn; }

  function nextStreet(st) {
    st.seats.forEach(function (s) { s.bet = 0; s.acted = false; s.locked = false; });
    st.currentBet = 0; st.minRaise = st.bigBlind;
    var idx = STREETS.indexOf(st.phase) + 1;
    st.phase = STREETS[idx];
    var n = idx === 1 ? 3 : 1;
    for (var i = 0; i < n; i++) st.board.push(st.deck.pop());
    st.current = nextSeat(st, st.button, canActNow);
    if (ableToAct(st).length < 2) st.current = -1;     // торговли нет: все (кроме одного) в олл-ине, карты открываются дальше сами
  }

  // Побочные банки: [{ amount, eligible: [места] }]
  function buildPots(st) {
    var totals = st.seats.filter(function (s) { return s.total > 0; }).map(function (s) { return s.total; });
    var levels = totals.filter(function (v, i) { return totals.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    var pots = [], prev = 0;
    levels.forEach(function (level) {
      var amount = 0;
      st.seats.forEach(function (s) { amount += Math.max(0, Math.min(s.total, level) - Math.min(s.total, prev)); });
      var eligible = st.seats.filter(function (s) { return s.inHand && !s.folded && s.total >= level; }).map(function (s) { return s.index; });
      if (!eligible.length && pots.length) pots[pots.length - 1].amount += amount;       // «мёртвые» деньги сбросивших уходят в последний банк
      else pots.push({ amount: amount, eligible: eligible });
      prev = level;
    });
    return pots;
  }

  function showdown(st) {
    var alive = live(st), contested = alive.length > 1;
    if (contested) {
      while (st.board.length < 5) st.board.push(st.deck.pop());
      alive.forEach(function (s) { s.hand = evaluate(s.cards.concat(st.board)); s.shown = true; });
    }
    var pots = buildPots(st), payout = {};
    st.seats.forEach(function (s) { payout[s.index] = 0; });
    pots.forEach(function (pot) {
      var best = null, winners = [];
      pot.eligible.forEach(function (i) {
        var h = contested ? st.seats[i].hand : null;
        if (!h) { winners.push(i); return; }
        var c = best ? compareScores(h.score, best) : 1;
        if (c > 0) { best = h.score; winners = [i]; } else if (c === 0) winners.push(i);
      });
      // порядок получения лишней фишки: от кнопки по кругу
      var n = st.seats.length;
      winners.sort(function (a, b) { return ((a - st.button + n) % n || n) - ((b - st.button + n) % n || n); });
      var share = Math.floor(pot.amount / winners.length), extra = pot.amount - share * winners.length;
      winners.forEach(function (i, k) { payout[i] += share + (k < extra ? 1 : 0); });
      pot.winners = winners;
    });
    st.seats.forEach(function (s) { s.chips += payout[s.index]; s.net = payout[s.index] - s.total; });
    st.pots = pots;
    st.result = { showdown: contested, rows: st.seats.filter(function (s) { return s.inHand; }).map(function (s) { return { seat: s.index, net: s.net, hand: s.hand ? s.hand.name : null }; }) };
    st.pot = potOf(st);
    st.phase = 'settled'; st.current = -1;
  }

  // ===== Допустимые действия =====
  function legalActions(st, seat) {
    var s = st.seats[seat];
    if (!s || st.current !== seat || !canActNow(s) || (st.phase === 'waiting' || st.phase === 'settled')) return null;
    var toCall = Math.max(0, st.currentBet - s.bet), maxTo = s.bet + s.chips;
    var minTo = st.currentBet + st.minRaise, a = { fold: true, check: toCall === 0, call: toCall > 0 ? Math.min(toCall, s.chips) : 0, raise: null, allin: s.chips > 0 && (!s.locked || maxTo <= st.currentBet) ? maxTo : 0 };
    if (!s.locked && maxTo > st.currentBet) a.raise = { min: Math.min(minTo, maxTo), max: maxTo };
    return a;
  }

  function applyRaise(st, s, to) {
    var inc = to - st.currentBet, full = inc >= st.minRaise;
    post(s, to - s.bet);
    st.currentBet = to;
    s.acted = true;
    st.seats.forEach(function (o) {
      if (o === s || !canActNow(o)) return;
      if (full) { o.acted = false; o.locked = false; }
      else if (o.acted) { o.acted = false; o.locked = true; }
    });
    if (full) st.minRaise = inc;
  }

  function fold(st, s) { s.folded = true; s.acted = true; s.last = 'fold'; }

  // Результат: { ok, state, error }
  function reduce(state, action, rng) {
    rng = rng || Math.random;
    var st = clone(state), seat = action && action.seat, s = st.seats[seat];
    function bad(error) { return { ok: false, error: error, state: state }; }
    if (!action || !s) return bad('bad-seat');
    var t = action.type;
    var between = st.phase === 'waiting' || st.phase === 'settled';

    if (t === 'join') {
      if (!between) return bad('hand-in-progress');
      if (s.active) return bad('seat-taken');
      if (!(Math.floor(Number(action.chips)) > 0) || !action.id) return bad('bad-join');
      occupy(s, action);
      return { ok: true, state: st };
    }
    if (t === 'sitout') { if (!s.active) return bad('not-active'); s.sitOut = action.value !== false; return { ok: true, state: st }; }
    if (t === 'leave') {
      if (!s.active) return bad('not-active');
      s.active = false;
      if (!between && s.inHand && !s.folded) {
        fold(st, s);
        if (st.current === seat) st.current = nextSeat(st, seat, canActNow);
        progress(st);
      }
      return { ok: true, state: st };
    }
    if (t === 'deal' || t === 'next') {
      if (!between) return bad('hand-in-progress');
      if (!canDeal(st)) return bad('not-enough-players');
      startHand(st, rng);
      return { ok: true, state: st };
    }

    if (between) return bad('no-hand');
    if (st.current !== seat) return bad('not-your-turn');
    if (t === 'timeout') t = st.currentBet - s.bet === 0 ? 'check' : 'fold';
    var toCall = st.currentBet - s.bet;
    if (t === 'fold') fold(st, s);
    else if (t === 'check') {
      if (toCall !== 0) return bad('cannot-check');
      s.acted = true; s.last = 'check';
    } else if (t === 'call') {
      if (toCall <= 0) return bad('nothing-to-call');
      post(s, toCall); s.acted = true; s.last = 'call';
    } else if (t === 'allin' || t === 'raise') {
      var to = t === 'allin' ? s.bet + s.chips : Math.floor(Number(action.amount));
      if (!(to > 0) || to > s.bet + s.chips) return bad('bad-amount');
      if (s.chips === 0) return bad('no-chips');
      if (to <= st.currentBet) {                         // олл-ин на сумму не больше ставки: это уравнивание
        if (t === 'raise') return bad('bad-amount');
        post(s, to - s.bet); s.acted = true; s.last = 'allin';
      } else {
        if (s.locked) return bad('raise-locked');
        var allInTo = to === s.bet + s.chips;
        if (!allInTo && to < st.currentBet + st.minRaise) return bad('raise-too-small');
        var wasBet = st.currentBet === 0;
        applyRaise(st, s, to);
        s.last = allInTo ? 'allin' : (wasBet ? 'bet' : 'raise');
      }
    } else return bad('bad-action');
    st.current = nextSeat(st, seat, canActNow);
    progress(st);
    return { ok: true, state: st };
  }

  // Что видит место: чужие закрытые карты и колода скрыты (null вместо карты), открытые на вскрытии видны всем
  function view(state, seat) {
    var v = clone(state);
    delete v.deck;
    v.seats.forEach(function (s) {
      if (s.index !== seat && !s.shown) s.cards = s.cards.map(function () { return null; });
    });
    return v;
  }

  // Места, от которых сейчас ждут действие
  function waitingSeats(state) { return state.current >= 0 && STREETS.indexOf(state.phase) >= 0 ? [state.current] : []; }

  root.Poker = {
    CONFIG: CONFIG, HAND_NAMES: HAND_NAMES, STREETS: STREETS, buildDeck: buildDeck, evaluate: evaluate, compareScores: compareScores,
    init: init, reduce: reduce, view: view, legalActions: legalActions, canDeal: canDeal, waitingSeats: waitingSeats
  };
})(typeof window !== 'undefined' ? window : globalThis);
