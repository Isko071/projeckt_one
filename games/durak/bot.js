// Бот для «Дурака» (games/durak/logic.js): одно действие за раз — то, что сделал бы игрок на его месте.
//   DurakBot.choose(state, seat, level, rng) → действие { type, seat, card?, target? }; state — полное состояние (бот видит только свои карты)
// Уровни:
//   easy   — ходит и отбивается как попало, часто забирает и редко подкидывает;
//   medium — бережёт козыри и старшие карты: ходит младшими, кроет самой дешёвой подходящей, сбрасывает мелочь, когда соперник забирает;
//   expert — то же, но считает колоду: в конце игры, когда колода кончилась, давит козырями и подкидывает всё, что можно; переводит выгодно;
//            решает, отбиваться или забрать, по тому, сколько стоит отбой.
(function (root) {
  var D = root.Durak;

  // «Цена» карты: чем выше, тем жальче отдавать. Козыри дороже любых некозырей
  function cost(c, trump) { return D.rank(c) + (D.suit(c) === trump ? 10 : 0); }
  function cheapest(cards, trump) { return cards.slice().sort(function (a, b) { return cost(a, trump) - cost(b, trump); })[0]; }

  // Самый дешёвый способ покрыть все непобитые карты (жадно, от самой дорогой к дешёвой); null — покрыть нельзя
  function coverPlan(st, seat) {
    var hand = st.seats[seat].hand.slice(), trump = st.trump, plan = [];
    var targets = st.table.map(function (p, i) { return p.d ? -1 : i; }).filter(function (i) { return i >= 0; })
      .sort(function (a, b) { return cost(st.table[b].a, trump) - cost(st.table[a].a, trump); });
    for (var k = 0; k < targets.length; k++) {
      var t = targets[k], ok = hand.filter(function (c) { return D.beats(c, st.table[t].a, trump); });
      if (!ok.length) return null;
      var c = cheapest(ok, trump);
      hand.splice(hand.indexOf(c), 1);
      plan.push({ card: c, target: t });
    }
    return plan;
  }

  function choose(st, seat, level, rng) {
    rng = rng || Math.random; level = level || 'medium';
    var L = D.legal(st), trump = st.trump, act = function (o) { o.seat = seat; return o; };
    var deck = st.deck ? st.deck.length : (st.deckCount || 0), endgame = deck === 0;
    var defHand = st.defender >= 0 ? st.seats[st.defender].hand.length : 6;

    // ---- отбиваемся ----
    if (L.defend.length || L.take) {
      if (level === 'easy') {
        if (L.defend.length && rng() < 0.75) { var d0 = L.defend[Math.floor(rng() * L.defend.length)]; return act({ type: 'defend', card: d0.card, target: d0.target }); }
        return act({ type: 'take' });
      }
      // перевод дешёвой картой выгоднее отбоя
      if (L.transfer.length) {
        var tr = cheapest(L.transfer, trump);
        if (D.suit(tr) !== trump || (level === 'expert' && endgame)) return act({ type: 'transfer', card: tr });
      }
      var plan = coverPlan(st, seat);
      if (!plan) return act({ type: 'take' });
      // сколько стоит отбой: козыри и тузы жалко отдавать, пока колода большая (потом их не вернуть)
      var spend = plan.reduce(function (a, p) { return a + Math.max(0, cost(p.card, trump) - 6); }, 0);
      var onTable = st.table.length;
      var limit = level === 'expert' ? (endgame ? 99 : deck > 12 ? 9 : 14) : (deck > 12 ? 12 : 20);
      if (spend > limit && onTable <= 2 && st.seats[seat].hand.length <= 8) return act({ type: 'take' });
      return act({ type: 'defend', card: plan[0].card, target: plan[0].target });
    }

    // ---- ходим или подкидываем ----
    var cards = L.attack;
    if (!cards.length) return act({ type: 'pass' });
    if (level === 'easy') {
      if (L.pass && rng() < 0.6) return act({ type: 'pass' });
      return act({ type: 'attack', card: cards[Math.floor(rng() * cards.length)] });
    }
    var hand = st.seats[seat].hand;
    if (st.phase === 'attack') {
      // первая карта захода: младшая некозырная, лучше та, которой есть пара (её потом можно подкинуть)
      var plain = cards.filter(function (c) { return D.suit(c) !== trump; });
      var pool = plain.length ? plain : cards;
      if (level === 'expert') {
        var pairs = pool.filter(function (c) { return hand.filter(function (x) { return x[0] === c[0]; }).length > 1; });
        if (pairs.length && cost(cheapest(pairs, trump), trump) <= cost(cheapest(pool, trump), trump) + 2) pool = pairs;
      }
      return act({ type: 'attack', card: cheapest(pool, trump) });
    }
    // подкидываем: когда соперник забирает — сбрасываем мелочь; когда отбивается — подкидываем дешёвое, в конце игры давим всем
    var c = cheapest(cards, trump), price = cost(c, trump);
    if (st.taking) return price < (endgame ? 99 : 10) ? act({ type: 'attack', card: c }) : act({ type: 'pass' });
    if (level === 'expert' && (endgame || defHand <= 2)) return act({ type: 'attack', card: c });
    if (price <= (deck > 6 ? 5 : 8)) return act({ type: 'attack', card: c });
    return act({ type: 'pass' });
  }

  root.DurakBot = { choose: choose, cost: cost, coverPlan: coverPlan, LEVELS: ['easy', 'medium', 'expert'] };
})(typeof window !== 'undefined' ? window : globalThis);
