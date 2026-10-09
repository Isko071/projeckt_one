// Боты покера: три характера, ходят по оценке силы руки (случайные раздачи) и шансам банка. Видят только свои карты и общие.
// Работают с любым вариантом игры (классический и простой): решение принимается только из допустимых действий Poker.legalActions.
// Зависит от logic.js (глобальный объект Poker), без обращений к window и document.
//   PokerBots.makeBot(n)                 → описание места для Poker.init / действия join: { id, name, kind: 'bot', style }
//   PokerBots.equity(hole, board, opponents, rng, samples) → шанс выиграть против случайных рук (0..1, ничья считается за половину)
//   PokerBots.botAction(state, seat, rng) → { type, seat, amount? } для места-бота (всегда допустимое действие) или null
//   PokerBots.nextBotAction(state, rng)  → действие бота, чей сейчас ход, или null
(function (root) {
  var P = root.Poker;
  // Характеры. Пороги даны в «силе» s от -1 до 1: 0 — средняя рука за этим столом, 1 — выигрыш наверняка (s = (шанс − 1/игроков) / (1 − 1/игроков)):
  //   strong — рука для повышения; medium — рука для ставки по желанию; must — рука для обязательной ставки; bluff — шанс блефа; size — доля банка в ставке;
  //   margin — запас к шансам банка при уравнивании (чем больше, тем реже уравнивает), stack — доля стека, при которой бот идёт ва-банк с сильной рукой
  var STYLES = {
    careful: { name: 'Бот Оскар', strong: 0.55, medium: 0.3, must: 0.1, bluff: 0.03, size: 0.5, margin: 0.07, stack: 0.35 },
    average: { name: 'Бот Макс', strong: 0.45, medium: 0.2, must: 0.0, bluff: 0.07, size: 0.7, margin: 0.03, stack: 0.5 },
    risky:   { name: 'Бот Рико', strong: 0.35, medium: 0.1, must: -0.12, bluff: 0.16, size: 1.0, margin: -0.02, stack: 0.7 }
  };
  var ORDER = ['average', 'risky', 'careful'];

  function makeBot(n) {
    var style = ORDER[(Math.max(1, n) - 1) % ORDER.length];
    return { id: 'bot-' + n, name: STYLES[style].name, kind: 'bot', style: style };
  }

  // Шанс выиграть против opponents случайных рук: розыгрыш недостающих карт много раз
  function equity(hole, board, opponents, rng, samples) {
    rng = rng || Math.random;
    samples = samples || 120;
    var known = hole.concat(board), rest = P.buildDeck().filter(function (c) { return known.indexOf(c) < 0; });
    var need = 5 - board.length, take = need + 2 * opponents, score = 0;
    for (var s = 0; s < samples; s++) {
      for (var i = 0; i < take; i++) { var j = i + Math.floor(rng() * (rest.length - i)), t = rest[i]; rest[i] = rest[j]; rest[j] = t; }
      var full = board.concat(rest.slice(0, need));
      var mine = P.evaluate(hole.concat(full)).score, best = 0, ties = 0;
      for (var o = 0; o < opponents; o++) {
        var theirs = P.evaluate([rest[need + 2 * o], rest[need + 2 * o + 1]].concat(full)).score, c = P.compareScores(mine, theirs);
        if (c < 0) { best = -1; break; }
        if (c === 0) ties++;
      }
      if (best === 0) score += ties ? 1 / (ties + 1) : 1;
    }
    return score / samples;
  }

  function round(n, step) { return Math.max(step, Math.round(n / step) * step); }

  function botAction(st, seat, rng) {
    rng = rng || Math.random;
    var s = st.seats[seat], la = P.legalActions(st, seat);
    if (!s || s.kind !== 'bot' || !la) return null;
    var style = STYLES[s.style] || STYLES.average;
    var opponents = Math.max(1, st.seats.filter(function (o) { return o.inHand && !o.folded && o.index !== seat; }).length);
    var eq = equity(s.cards, st.board, opponents, rng, st.board.length ? 100 : 80);
    var base = 1 / (opponents + 1), strength = (eq - base) / (1 - base), toCall = Math.max(0, st.currentBet - s.bet), pot = Math.max(st.pot, st.minBet);
    var step = Math.max(1, Math.floor(st.minBet / 2) || 1);
    function act(type, amount) { var a = { type: type, seat: seat }; if (amount !== undefined) a.amount = amount; return a; }
    function raiseTo(frac) {
      if (!la.raise) return null;
      var want = st.currentBet + round(pot * frac, step), to = Math.max(la.raise.min, Math.min(la.raise.max, want));
      return to >= la.raise.max && la.allin ? act('allin') : act('raise', to);
    }
    var bluff = rng() < style.bluff;

    if (toCall === 0) {                                              // ставки нет
      if (la.mustBet) {                                               // обязательный круг: чекать нельзя, надо ставить или сбрасывать
        if (strength >= style.must || bluff) return raiseTo(strength >= style.strong ? style.size * 1.2 : style.size * 0.6) || act('fold');
        return act('fold');
      }
      if (strength >= style.strong) return raiseTo(style.size * 1.1) || act('check');
      if (strength >= style.medium || bluff) return raiseTo(style.size * 0.6) || act('check');
      return act('check');
    }
    var odds = toCall / (pot + toCall);                                // нужен шанс не ниже доли вклада в банк
    var cheap = toCall <= st.minBet && eq >= odds * 0.6;               // совсем дешёвое уравнивание
    if (strength >= style.strong) {
      var big = s.chips <= st.minBet * 4 || (la.allin && la.allin - s.bet <= s.chips * style.stack && eq > 0.75);
      if (big && la.allin) return act('allin');
      return raiseTo(style.size * 1.1) || (la.call ? act('call') : act('check'));
    }
    if (eq >= odds + style.margin || cheap) {
      if (strength >= style.medium && bluff && la.raise) return raiseTo(style.size * 0.8) || act('call');
      return act('call');
    }
    if (bluff && la.raise && toCall <= pot * 0.5) return raiseTo(style.size) || act('fold');
    return act('fold');
  }

  function nextBotAction(st, rng) {
    if (!st || st.current < 0 || !st.seats[st.current] || st.seats[st.current].kind !== 'bot') return null;
    return botAction(st, st.current, rng);
  }

  root.PokerBots = { STYLES: STYLES, ORDER: ORDER, makeBot: makeBot, equity: equity, botAction: botAction, nextBotAction: nextBotAction };
})(typeof window !== 'undefined' ? window : globalThis);
