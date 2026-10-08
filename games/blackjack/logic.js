// Чистая логика блэкджека: колода, подсчёт, правила хода, выплаты, подсказка по базовой стратегии.
// Без window и document: тестируется в node. Игра описана как init / reduce / view (см. docs/multiplayer.md),
// поэтому её можно вести через shared/game-session.js, а позже и по сети (скрытая карта дилера прячется в view).
//
// Правила (как в обычном казино, один игрок против дилера, до нескольких мест за столом):
//  • 6 колод, колода тасуется заново, когда остаётся меньше четверти карт (перед следующей раздачей).
//  • Блэкджек (туз и десятка в первых двух картах) платит 3:2 (выплата округляется вниз), обычный выигрыш 1:1, ничья возвращает ставку.
//  • Дилер берёт до 17 и останавливается на любых 17, в том числе «мягких». Если у дилера туз или десятка, он сразу проверяет вторую карту.
//  • Игрок может взять карту, остановиться, удвоить (на первых двух картах, одна карта и остановка) и разделить пару одинаковых карт (один раз).
//  • После деления тузов к каждому туз дают по одной карте. 21 после деления не считается блэкджеком (платит 1:1). Удвоение после деления разрешено, кроме тузов.
//  • Страховки и сдачи нет.
//  • Боты за столом играют случайно, у каждого свой характер (средний, рискованный, осторожный), см. BOT_STYLES.
//  • Упрощённый режим (options.simple): только «взять» и «стоп», без удвоения и деления; подсказка тоже советует только эти два действия.
//
// Карта — строка из двух символов: достоинство (A 2 3 4 5 6 7 8 9 T J Q K) и масть (S H D C), например 'AS', 'TH'.
//
// Действия (поле seat — номер места):
//   { type: 'bet', seat, amount }  ставка (0 — убрать ставку); можно менять, пока раздача не началась
//   { type: 'deal', seat }         раздать карты (нужна хотя бы одна ставка)
//   { type: 'hit' | 'stand' | 'double' | 'split', seat }
//   { type: 'next', seat }         новая раздача после окончания прежней
//   { type: 'sitout', seat, value } пропустить раздачу (value: false — вернуться)
//   { type: 'join', seat, id, name, chips, kind } занять свободное место между раздачами (kind: 'human' | 'bot')
//   { type: 'leave', seat }        уйти из-за стола; во время раздачи рука остаётся с тем, что есть, место освободится после неё
//   { type: 'timeout', seat }      время хода или ставки вышло: ставка — пропуск раздачи, ход — «стоп»
// За столом до CONFIG.maxSeats мест (5). Боты (kind: 'bot') ходят по базовой стратегии: см. botAction / nextBotAction.
(function (root) {
  var RANKS = 'A23456789TJQK'.split('');
  var SUITS = ['S', 'H', 'D', 'C'];
  var CONFIG = { decks: 6, minBet: 25, maxBet: 2500, step: 25, reshuffleBelow: 0.25, startChips: 5000, maxSeats: 5, botBet: 100 };
  // Боты за столом (не дилер: дилер всегда компьютер). Ходят случайно, у каждого свой характер:
  //  • average — средний игрок: по базовой стратегии, но в каждом пятом ходе ошибается, ставит 100;
  //  • risky — рискованный: берёт карты до 18 и часто идёт дальше (на 18 с шансом 50 %, на 19 — 25 %, на 20 — 5 %), ставит 250;
  //  • careful — осторожный: останавливается около 18 (порог 17, 18 или 19 случайно), ставит 50.
  var BOT_STYLES = { average: { name: 'Бот Макс', bet: 100 }, risky: { name: 'Бот Рико', bet: 250 }, careful: { name: 'Бот Оскар', bet: 50 } };
  var BOT_ORDER = ['average', 'risky', 'careful'];
  var MISTAKE_RATE = 0.22;

  // ===== Карты и подсчёт =====
  function rankOf(card) { return card.charAt(0); }
  function suitOf(card) { return card.charAt(1); }
  function cardValue(card) {
    var r = rankOf(card);
    if (r === 'A') return 11;
    if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
    return Number(r);
  }
  function isTenValue(card) { return cardValue(card) === 10; }

  // total — лучшая сумма; soft — туз считается за 11
  function handValue(cards) {
    var total = 0, aces = 0;
    cards.forEach(function (c) { total += cardValue(c); if (rankOf(c) === 'A') aces++; });
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return { total: total, soft: aces > 0 };
  }

  function isNatural(hand) {
    return hand.cards.length === 2 && !hand.fromSplit && handValue(hand.cards).total === 21;
  }
  function isBust(hand) { return handValue(hand.cards).total > 21; }

  function buildShoe(decks, rng) {
    var shoe = [];
    for (var d = 0; d < decks; d++) SUITS.forEach(function (s) { RANKS.forEach(function (r) { shoe.push(r + s); }); });
    for (var i = shoe.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1)), t = shoe[i]; shoe[i] = shoe[j]; shoe[j] = t;
    }
    return shoe;
  }

  // ===== Состояние =====
  function emptyHand() { return { cards: [], bet: 0, done: false, doubled: false, fromSplit: false, splitAces: false, outcome: null, payout: 0 }; }

  function tableSeats(list, size) {
    list = (list && list.length ? list : [{}]).slice(0, CONFIG.maxSeats);
    var count = Math.max(list.length, Math.min(CONFIG.maxSeats, Math.floor(size) || 0));
    var out = [];
    for (var i = 0; i < count; i++) {
      var s = list[i];
      out.push(s ? occupy({}, i, s) : { id: 'seat' + i, name: '', kind: 'human', style: 'human', active: false, chips: 0, bet: 0, hands: [], wagered: 0, net: 0, sitOut: false, leaving: false });
    }
    return out;
  }
  function occupy(seat, i, s) {
    seat.id = s.id !== undefined ? String(s.id) : 'seat' + i;
    seat.name = s.name ? String(s.name).slice(0, 20) : '';
    seat.kind = s.kind === 'bot' ? 'bot' : 'human';
    seat.style = seat.kind === 'bot' && BOT_STYLES[s.style] ? s.style : (seat.kind === 'bot' ? 'average' : 'human');
    seat.active = true;
    seat.chips = typeof s.chips === 'number' && s.chips >= 0 ? Math.floor(s.chips) : CONFIG.startChips;
    seat.bet = 0; seat.hands = []; seat.wagered = 0; seat.net = 0; seat.sitOut = false; seat.leaving = false;
    return seat;
  }

  // seats: [{ id, name, chips, kind }]; options: { decks, simple, tableSize, stack }
// tableSize — число мест за столом (до maxSeats); места сверх переданных остаются свободными для join.
// stack — карты в порядке выдачи, для тестов
  function init(seats, options, rng) {
    options = options || {};
    rng = rng || Math.random;
    var decks = options.decks || CONFIG.decks;
    var shoe = options.stack ? options.stack.slice().reverse() : buildShoe(decks, rng);
    return {
      v: 1, decks: decks, simple: !!options.simple, shoe: shoe, fixed: !!options.stack, round: 0, phase: 'betting',
      seats: tableSeats(seats, options.tableSize),
      current: -1, hand: 0, dealer: { cards: [], hidden: true }
    };
  }

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function draw(state, rng) {
    if (!state.shoe.length) {
      if (state.fixed) throw new Error('shoe-empty');
      state.shoe = buildShoe(state.decks, rng || Math.random);
    }
    return state.shoe.pop();
  }

  function dealerHasNatural(state) {
    var c = state.dealer.cards;
    return c.length === 2 && handValue(c).total === 21;
  }

  // ===== Правила: что можно сделать =====
  function activeHand(state) {
    if (state.phase !== 'playing' || state.current < 0) return null;
    return state.seats[state.current].hands[state.hand] || null;
  }

  function canDouble(state, seat) {
    var h = activeHand(state), s = state.seats[seat];
    return !state.simple && !!h && state.current === seat && h.cards.length === 2 && !h.splitAces && s.chips >= h.bet;
  }
  function canSplit(state, seat) {
    var h = activeHand(state), s = state.seats[seat];
    return !state.simple && !!h && state.current === seat && s.hands.length === 1 && h.cards.length === 2 &&
      rankOf(h.cards[0]) === rankOf(h.cards[1]) && s.chips >= h.bet;
  }
  function canHit(state, seat) {
    var h = activeHand(state);
    return !!h && state.current === seat && !h.splitAces && handValue(h.cards).total < 21;
  }
  function availableActions(state, seat) {
    if (!state.seats[seat] || !state.seats[seat].active) return state.phase === 'betting' ? ['join'] : [];
    if (state.phase === 'betting') return ['bet', 'deal', 'sitout', 'leave'];
    if (state.phase === 'settled') return ['next'];
    var out = [];
    if (canHit(state, seat)) out.push('hit');
    if (activeHand(state) && state.current === seat) out.push('stand');
    if (canDouble(state, seat)) out.push('double');
    if (canSplit(state, seat)) out.push('split');
    return out;
  }

  // ===== Ход игры =====
  function nextTurn(state) {
    // ищем следующую незавершённую руку: сначала остальные руки этого места, потом следующие места
    for (var s = Math.max(state.current, 0); s < state.seats.length; s++) {
      var hands = state.seats[s].hands;
      for (var h = (s === state.current ? state.hand + 1 : 0); h < hands.length; h++) {
        if (!hands[h].done) { state.current = s; state.hand = h; return true; }
      }
    }
    return false;
  }

  function dealerPlay(state, rng, events) {
    state.dealer.hidden = false;
    events.push({ type: 'reveal', card: state.dealer.cards[1] });
    var needs = state.seats.some(function (s) { return s.hands.some(function (h) { return !isBust(h) && !isNatural(h); }); });
    while (needs && handValue(state.dealer.cards).total < 17) {
      var c = draw(state, rng);
      state.dealer.cards.push(c);
      events.push({ type: 'deal', seat: 'dealer', card: c });
    }
  }

  // Подсчёт выплат: payout — сколько возвращается игроку вместе со ставкой
  function settle(state, events) {
    var dealer = handValue(state.dealer.cards).total, dealerNatural = dealerHasNatural(state);
    state.seats.forEach(function (seat, si) {
      var total = 0;
      seat.hands.forEach(function (h) {
        var v = handValue(h.cards).total, outcome, payout;
        if (v > 21) { outcome = 'bust'; payout = 0; }
        else if (isNatural(h)) {
          if (dealerNatural) { outcome = 'push'; payout = h.bet; } else { outcome = 'blackjack'; payout = h.bet + Math.floor(h.bet * 3 / 2); }
        } else if (dealerNatural) { outcome = 'lose'; payout = 0; }
        else if (dealer > 21 || v > dealer) { outcome = 'win'; payout = h.bet * 2; }
        else if (v === dealer) { outcome = 'push'; payout = h.bet; }
        else { outcome = 'lose'; payout = 0; }
        h.outcome = outcome; h.payout = payout; total += payout;
      });
      seat.chips += total;
      seat.net = total - seat.wagered;
      if (seat.hands.length) events.push({ type: 'settled', seat: si, net: seat.net, outcomes: seat.hands.map(function (h) { return h.outcome; }) });
    });
    state.phase = 'settled';
    state.current = -1;
  }

  // Завершает раздачу, когда рук для игры больше нет
  function finishRound(state, rng, events) {
    state.phase = 'dealer';
    dealerPlay(state, rng, events);
    settle(state, events);
  }

  function advance(state, rng, events) {
    if (!nextTurn(state)) finishRound(state, rng, events);
  }

  function dealRound(state, rng, events) {
    var order = [];
    state.seats.forEach(function (s, i) { if (s.bet > 0) order.push(i); });
    order.forEach(function (i) { var h = emptyHand(); h.bet = state.seats[i].bet; state.seats[i].hands = [h]; state.seats[i].wagered = h.bet; });
    for (var pass = 0; pass < 2; pass++) {
      order.forEach(function (i) {
        var c = draw(state, rng); state.seats[i].hands[0].cards.push(c);
        events.push({ type: 'deal', seat: i, hand: 0, card: c });
      });
      var dc = draw(state, rng);
      state.dealer.cards.push(dc);
      events.push({ type: 'deal', seat: 'dealer', card: dc, hidden: pass === 1 });
    }
    state.phase = 'playing';
    state.current = -1; state.hand = -1;
    order.forEach(function (i) { var h = state.seats[i].hands[0]; if (isNatural(h)) { h.done = true; events.push({ type: 'blackjack', seat: i }); } });
    var up = state.dealer.cards[0];
    // дилер заглядывает во вторую карту, если открыт туз или десятка
    if ((rankOf(up) === 'A' || isTenValue(up)) && dealerHasNatural(state)) {
      state.dealer.hidden = false;
      events.push({ type: 'reveal', card: state.dealer.cards[1], natural: true });
      order.forEach(function (i) { state.seats[i].hands[0].done = true; });
      settle(state, events);
      return;
    }
    state.current = 0; state.hand = -1;
    advance(state, rng, events);
  }

  function reduce(state, action, rng) {
    if (!state || !action || typeof action.type !== 'string') return { ok: false, error: 'bad-action' };
    rng = rng || Math.random;
    var seat = action.seat, s = state.seats[seat];
    if (!s) return { ok: false, error: 'bad-seat' };
    var next = clone(state), events = [], ns = next.seats[seat];

    if (action.type === 'join') {
      if (state.phase !== 'betting') return { ok: false, error: 'wrong-phase' };
      if (s.active) return { ok: false, error: 'seat-taken' };
      if (action.chips !== undefined && (!Number.isInteger(action.chips) || action.chips < 0)) return { ok: false, error: 'bad-chips' };
      if (state.seats.some(function (x) { return x.active && action.id !== undefined && x.id === String(action.id); })) return { ok: false, error: 'already-seated' };
      occupy(ns, seat, action);
      events.push({ type: 'join', seat: seat });
      return { ok: true, state: next, events: events };
    }
    if (!s.active) return { ok: false, error: 'seat-empty' };

    if (action.type === 'leave') {
      if (state.phase === 'playing' || state.phase === 'dealer') {
        if (!s.hands.length) { ns.chips += ns.bet; ns.bet = 0; ns.active = false; }       // сидел без ставки: уходит сразу
        else {
          ns.leaving = true;
          ns.hands.forEach(function (h) { h.done = true; });                              // рука остаётся с тем, что есть
          if (next.current === seat) advance(next, rng, events);
        }
      } else { ns.chips += ns.bet; ns.bet = 0; ns.hands = []; ns.active = false; ns.sitOut = false; }
      events.push({ type: 'leave', seat: seat });
      return { ok: true, state: next, events: events };
    }

    if (action.type === 'sitout') {
      if (state.phase !== 'betting') return { ok: false, error: 'wrong-phase' };
      var on = action.value !== false;
      if (on) { ns.chips += ns.bet; ns.bet = 0; }
      ns.sitOut = on;
      events.push({ type: 'sitout', seat: seat, value: on });
      return { ok: true, state: next, events: events };
    }

    if (action.type === 'timeout') {
      if (state.phase === 'betting') { ns.chips += ns.bet; ns.bet = 0; ns.sitOut = true; events.push({ type: 'sitout', seat: seat, value: true }); return { ok: true, state: next, events: events }; }
      if (state.phase === 'playing' && state.current === seat) {
        ns.hands[next.hand].done = true; advance(next, rng, events);
        events.push({ type: 'timeout', seat: seat });
        return { ok: true, state: next, events: events };
      }
      return { ok: false, error: 'wrong-phase' };
    }

    if (action.type === 'bet') {
      if (state.phase !== 'betting') return { ok: false, error: 'wrong-phase' };
      var a = action.amount;
      if (!Number.isInteger(a) || a < 0) return { ok: false, error: 'bad-amount' };
      if (a > 0 && (a < CONFIG.minBet || a > CONFIG.maxBet || a % CONFIG.step !== 0)) return { ok: false, error: 'bad-amount' };
      if (ns.chips + ns.bet < a) return { ok: false, error: 'not-enough-chips' };
      ns.chips += ns.bet - a; ns.bet = a;
      if (a > 0) ns.sitOut = false;
      events.push({ type: 'bet', seat: seat, amount: a });
      return { ok: true, state: next, events: events };
    }

    if (action.type === 'deal') {
      if (state.phase !== 'betting') return { ok: false, error: 'wrong-phase' };
      if (!(ns.bet > 0)) return { ok: false, error: 'no-bet' };
      if (!readyToDeal(state)) return { ok: false, error: 'waiting-for-bets' };
      try { dealRound(next, rng, events); } catch (e) { return { ok: false, error: e.message }; }
      return { ok: true, state: next, events: events };
    }

    if (action.type === 'next') {
      if (state.phase !== 'settled') return { ok: false, error: 'wrong-phase' };
      next.round++; next.phase = 'betting'; next.current = -1; next.hand = 0;
      next.dealer = { cards: [], hidden: true };
      next.seats.forEach(function (x) {
        x.bet = 0; x.hands = []; x.wagered = 0; x.net = 0; x.sitOut = false;
        if (x.leaving) { x.active = false; x.leaving = false; }
      });
      if (!next.fixed && next.shoe.length < CONFIG.reshuffleBelow * 52 * next.decks) {
        next.shoe = buildShoe(next.decks, rng);
        events.push({ type: 'shuffle' });
      }
      return { ok: true, state: next, events: events };
    }

    if (action.type === 'hit' || action.type === 'stand' || action.type === 'double' || action.type === 'split') {
      if (state.phase !== 'playing') return { ok: false, error: 'wrong-phase' };
      if (state.current !== seat) return { ok: false, error: 'not-your-turn' };
      var hand = ns.hands[next.hand];
      if (action.type === 'hit') {
        if (!canHit(state, seat)) return { ok: false, error: 'cannot-hit' };
        var c = draw(next, rng); hand.cards.push(c);
        events.push({ type: 'deal', seat: seat, hand: next.hand, card: c });
        if (handValue(hand.cards).total >= 21) { hand.done = true; advance(next, rng, events); }
      } else if (action.type === 'stand') {
        hand.done = true; advance(next, rng, events);
      } else if (action.type === 'double') {
        if (!canDouble(state, seat)) return { ok: false, error: 'cannot-double' };
        ns.chips -= hand.bet; ns.wagered += hand.bet; hand.bet *= 2; hand.doubled = true;
        var d = draw(next, rng); hand.cards.push(d);
        events.push({ type: 'deal', seat: seat, hand: next.hand, card: d });
        hand.done = true; advance(next, rng, events);
      } else { // split
        if (!canSplit(state, seat)) return { ok: false, error: 'cannot-split' };
        var second = emptyHand();
        second.cards.push(hand.cards.pop());
        second.bet = hand.bet; ns.chips -= hand.bet; ns.wagered += hand.bet;
        var aces = rankOf(hand.cards[0]) === 'A';
        hand.fromSplit = second.fromSplit = true; hand.splitAces = second.splitAces = aces;
        ns.hands.push(second);
        [hand, second].forEach(function (h, i) {
          var cc = draw(next, rng); h.cards.push(cc);
          events.push({ type: 'deal', seat: seat, hand: i, card: cc });
          if (aces || handValue(h.cards).total >= 21) h.done = true; // тузы получают по одной карте; 21 останавливает руку
        });
        events.push({ type: 'split', seat: seat });
        next.hand = -1; // следующая рука берётся по порядку: первая незавершённая у этого места
        if (!nextTurnFrom(next, seat)) advance(next, rng, events);
      }
      return { ok: true, state: next, events: events };
    }
    return { ok: false, error: 'unknown-action' };
  }

  // после деления ищем первую незавершённую руку у того же места
  function nextTurnFrom(state, seat) {
    var hands = state.seats[seat].hands;
    for (var h = 0; h < hands.length; h++) if (!hands[h].done) { state.current = seat; state.hand = h; return true; }
    return false;
  }

  // Место определилось с раздачей: поставило, пропускает или не может поставить
  function decided(s) { return !s.active || s.sitOut || s.bet > 0 || s.chips < CONFIG.minBet; }

  // Можно раздавать: все решили, и есть хотя бы одна ставка
  function readyToDeal(state) {
    return state.phase === 'betting' && state.seats.every(decided) && state.seats.some(function (s) { return s.active && s.bet > 0; });
  }

  // ===== Боты =====
  // Бот по порядку: характер и имя (4-й бот снова «средний» и т. д.)
  function makeBot(n) {
    var style = BOT_ORDER[n % BOT_ORDER.length], lap = Math.floor(n / BOT_ORDER.length);
    return { kind: 'bot', style: style, name: BOT_STYLES[style].name + (lap ? ' ' + (lap + 1) : '') };
  }

  // Ход бота в игре: 'hit' или 'stand'
  function botMove(state, seat, rng) {
    var s = state.seats[seat], h = s.hands[state.hand], total = handValue(h.cards).total, style = s.style || 'average';
    if (!canHit(state, seat) || total >= 21) return 'stand';
    var r = rng();
    if (style === 'risky') {
      if (total < 18) return 'hit';
      var chance = total === 18 ? 0.5 : (total === 19 ? 0.25 : (total === 20 ? 0.05 : 0));
      return r < chance ? 'hit' : 'stand';
    }
    if (style === 'careful') {
      var limit = 17 + Math.floor(rng() * 3);               // 17, 18 или 19
      return total < limit ? 'hit' : 'stand';
    }
    var best = hint(state, seat) === 'stand' ? 'stand' : 'hit';
    if (r < MISTAKE_RATE && total > 11 && total < 19) return best === 'hit' ? 'stand' : 'hit';   // «средний игрок» иногда ошибается
    return best;
  }

  // Что должен сделать бот на этом месте сейчас (или null).
  function botAction(state, seat, rng) {
    var s = state.seats[seat];
    rng = rng || Math.random;
    if (!s || !s.active || s.kind !== 'bot') return null;
    if (state.phase === 'betting') {
      if (decided(s)) return null;
      var want = (BOT_STYLES[s.style] || BOT_STYLES.average).bet;
      var amount = Math.min(want, Math.floor((s.chips) / CONFIG.step) * CONFIG.step);
      return amount >= CONFIG.minBet ? { type: 'bet', seat: seat, amount: amount } : { type: 'sitout', seat: seat };
    }
    if (state.phase === 'playing' && state.current === seat) return { type: botMove(state, seat, rng), seat: seat };
    return null;
  }

  // Первое действие, которое ждёт от какого-нибудь бота (для ведущего: цикл «пока есть действие бота»)
  function nextBotAction(state, rng) {
    for (var i = 0; i < state.seats.length; i++) {
      var a = botAction(state, i, rng);
      if (a) return a;
    }
    return null;
  }

  // Места-люди, которых сейчас ждёт стол (для таймеров): на ставке — не решившие, в игре — чей ход
  function waitingSeats(state) {
    var out = [];
    state.seats.forEach(function (s, i) {
      if (!s.active || s.kind === 'bot') return;
      if (state.phase === 'betting' && !decided(s)) out.push(i);
      if (state.phase === 'playing' && state.current === i) out.push(i);
    });
    return out;
  }

  // Что видит место за столом: закрытая карта дилера и колода спрятаны
  function view(state) {
    var v = clone(state);
    v.shoeCount = v.shoe.length;
    delete v.shoe;
    if (v.dealer.hidden && v.dealer.cards.length > 1) v.dealer.cards[1] = '??';
    return v;
  }

  // ===== Подсказка: базовая стратегия (6 колод, дилер стоит на мягких 17, удвоение после деления) =====
  // Возвращает 'hit' | 'stand' | 'double' | 'split' среди доступных действий
  function hint(state, seat) {
    var h = activeHand(state);
    if (!h || state.current !== seat) return null;
    var up = cardValue(state.dealer.cards[0]);          // 2..11
    var v = handValue(h.cards), total = v.total;
    var can = { double: canDouble(state, seat), split: canSplit(state, seat), hit: canHit(state, seat) };
    var action;

    if (can.split) {
      var r = rankOf(h.cards[0]), pv = cardValue(h.cards[0]);
      if (r === 'A' || r === '8') action = 'split';
      else if (pv === 10) action = null;                      // десятки не делим
      else if (r === '9') action = up <= 9 && up !== 7 ? 'split' : null;
      else if (r === '7') action = up <= 7 ? 'split' : null;
      else if (r === '6') action = up <= 6 ? 'split' : null;
      else if (r === '5') action = null;                      // пятёрки считаем как 10
      else if (r === '4') action = (up === 5 || up === 6) ? 'split' : null;
      else if (r === '3' || r === '2') action = up <= 7 ? 'split' : null;
      if (action === 'split') return 'split';
    }

    if (v.soft && total <= 21) {
      if (total >= 19) return 'stand';
      if (total === 18) {
        if (up >= 3 && up <= 6) return can.double ? 'double' : 'stand';
        return up === 2 || up === 7 || up === 8 ? 'stand' : 'hit';
      }
      if (total === 17) return up >= 3 && up <= 6 && can.double ? 'double' : 'hit';
      if (total === 15 || total === 16) return up >= 4 && up <= 6 && can.double ? 'double' : 'hit';
      return up >= 5 && up <= 6 && can.double ? 'double' : 'hit'; // A2, A3
    }
    if (total >= 17) return 'stand';
    if (total >= 13) return up <= 6 ? 'stand' : 'hit';
    if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
    if (total === 11) return can.double && up <= 10 ? 'double' : 'hit';
    if (total === 10) return can.double && up <= 9 ? 'double' : 'hit';
    if (total === 9) return can.double && up >= 3 && up <= 6 ? 'double' : 'hit';
    return 'hit';
  }

  root.Blackjack = {
    CONFIG: CONFIG, RANKS: RANKS, SUITS: SUITS,
    rankOf: rankOf, suitOf: suitOf, cardValue: cardValue, handValue: handValue, isNatural: isNatural, isBust: isBust,
    buildShoe: buildShoe, init: init, reduce: reduce, view: view, hint: hint, availableActions: availableActions,
    activeHand: activeHand, canDouble: canDouble, canSplit: canSplit, canHit: canHit,
    readyToDeal: readyToDeal, botAction: botAction, nextBotAction: nextBotAction, makeBot: makeBot, BOT_STYLES: BOT_STYLES, waitingSeats: waitingSeats
  };
})(typeof window !== 'undefined' ? window : globalThis);
