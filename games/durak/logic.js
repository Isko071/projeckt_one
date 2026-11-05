// Чистая логика «Дурака» (подкидной и переводной) на 2–6 игроков. Форма та же, что у других игр с сервером столов: init / reduce / view, без DOM и window.
// Колода 36 карт (6–туз) или 52 (2–туз), каждому по 6, козырь — последняя карта колоды (лежит открытой). Первым ходит тот, у кого младший козырь.
// Ход идёт по очереди одним действием за раз (так проще телефону, ботам и серверу):
//   attack  — ходящий кладёт карту (первую — любую, дальше — того же достоинства, что уже есть на столе);
//   defend  — отбивающийся кроет непобитую карту: старшей той же масти или козырем (козырь — только старшим козырем);
//   transfer — только в переводном: пока ни одна карта не побита, отбивающийся кладёт карту того же достоинства, и отбиваться уже следующему;
//   take    — отбивающийся забирает; остальные ещё могут подкинуть;
//   pass    — подкидывающий больше не кладёт («Бито» / «Пас»).
// Подкидывают по очереди: сначала ходивший, потом остальные по кругу. Все спасовали: всё побито — «бито» (карты уходят), иначе отбивающийся забирает стол.
// На столе за один заход не больше 6 карт и не больше, чем было карт у отбивающегося в начале захода.
// Добор до 6: сначала ходивший, потом остальные подкидывавшие, отбивающийся последним. Кто остался без карт при пустой колоде — вышел.
// Последний с картами — дурак (gameOver, reason 'finished', loser). Вышли все одновременно — ничья (loser −1).
// Выход из-за стола (leave) или сдача (concede): этот игрок — дурак, партия окончена.
//
// Карта — строка «достоинство + масть»: достоинства 2 3 4 5 6 7 8 9 T J Q K A, масти S C D H (пики, трефы, бубны, черви). Например 'TH' — десятка червей.
//   Durak.init(seats, options, rng) → состояние; seats: [{ id, name, bot? }]; options.mode: 'podkidnoy' | 'perevodnoy'
//   Durak.reduce(state, action) → { ok, state, events } | { ok: false, error }; действие: { type, seat, card?, target? }
//   Durak.view(state) → стол без чужих карт и колоды (у каждого только число карт); Durak.secrets(state) → { id игрока: его карты }
//   Durak.legal(state) → что может сделать тот, чья очередь: { seat, attack: [карты], defend: [{ card, target }], transfer: [карты], take, pass }
(function (root) {
  // Режим стола (mode) — вариант и колода: 'podkidnoy' | 'perevodnoy', с '-52' — колода 52 карты (от двойки до туза), иначе 36
  var CONFIG = { minSeats: 2, maxSeats: 6, hand: 6, modes: ['podkidnoy', 'perevodnoy', 'podkidnoy-52', 'perevodnoy-52'], variants: ['podkidnoy', 'perevodnoy'], decks: [36, 52], botLevels: ['easy', 'medium', 'expert'] };
  // Имена ботов за онлайн-столом (их видят все игроки; сервер без словаря, поэтому имена здесь)
  var BOT_NAMES = ['Бот Саша', 'Бот Миша', 'Бот Женя', 'Бот Оля', 'Бот Дима'];
  var PLAYER_ACTIONS = ['attack', 'defend', 'transfer', 'take', 'pass', 'concede'];
  // Достоинства по старшинству (в колоде на 36 — от шестёрки)
  var RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'], SUITS = ['S', 'C', 'D', 'H'];

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function bad(error) { return { ok: false, error: error }; }
  function rank(c) { return RANKS.indexOf(c[0]); }
  function suit(c) { return c[1]; }
  function isTrump(c, trump) { return suit(c) === trump; }
  function valid(c) { return typeof c === 'string' && c.length === 2 && rank(c) >= 0 && SUITS.indexOf(c[1]) >= 0; }
  // Бьёт ли карта b карту a при козыре trump
  function beats(b, a, trump) {
    if (suit(b) === suit(a)) return rank(b) > rank(a);
    return suit(b) === trump && suit(a) !== trump;
  }
  function fullDeck(n) {
    var d = [], from = n === 52 ? 0 : RANKS.indexOf('6');
    SUITS.forEach(function (s) { RANKS.slice(from).forEach(function (r) { d.push(r + s); }); });
    return d;
  }
  function parseMode(m) { m = CONFIG.modes.indexOf(m) >= 0 ? m : 'podkidnoy'; return { variant: m.split('-')[0], deck: /-52$/.test(m) ? 52 : 36 }; }
  function shuffle(a, rng) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  // Сортировка руки для показа: некозыри по масти и достоинству, козыри в конце
  function sortHand(hand, trump) {
    return hand.slice().sort(function (a, b) {
      var ta = suit(a) === trump ? 1 : 0, tb = suit(b) === trump ? 1 : 0;
      if (ta !== tb) return ta - tb;
      if (suit(a) !== suit(b)) return SUITS.indexOf(suit(a)) - SUITS.indexOf(suit(b));
      return rank(a) - rank(b);
    });
  }

  // Сколько карт у игрока: в полном состоянии — его рука, в виде стола у чужих есть только число (count)
  function size(st, i) { var s = st.seats[i]; return s.hand ? s.hand.length : (s.count || 0); }
  function alive(st) { return st.seats.map(function (s, i) { return s.out ? -1 : i; }).filter(function (i) { return i >= 0; }); }
  function nextAlive(st, from) { var n = st.seats.length; for (var k = 1; k <= n; k++) { var i = (from + k) % n; if (!st.seats[i].out) return i; } return -1; }

  function init(seats, options, rng) {
    options = options || {}; rng = rng || Math.random;
    var pm = parseMode(options.mode), mode = pm.variant;
    var list = (seats || []).slice(0, CONFIG.maxSeats).map(function (s) { return { id: s.id, name: s.name || '', bot: !!s.bot, level: s.level || '', active: true, out: false, hand: [] }; });
    var deck = shuffle(fullDeck(pm.deck), rng);
    // козырь — нижняя карта колоды, её возьмут последней
    list.forEach(function (s) { s.hand = deck.splice(0, CONFIG.hand); });
    // 36 карт на шестерых — колоды после раздачи не остаётся: козырь — последняя розданная карта (её все видят)
    var trumpCard = deck.length ? deck[deck.length - 1] : list[list.length - 1].hand[CONFIG.hand - 1];
    var trump = suit(trumpCard);
    // Первым ходит младший козырь; козырей ни у кого нет — случайный игрок
    var first = -1, low = 99;
    list.forEach(function (s, i) { s.hand.forEach(function (c) { if (suit(c) === trump && rank(c) < low) { low = rank(c); first = i; } }); });
    if (first < 0) first = Math.floor(rng() * list.length);
    var st = { v: 1, mode: mode, deckSize: pm.deck, deck: deck, trump: trump, trumpCard: trumpCard, seats: list, discard: 0, table: [], attacker: first, defender: -1, phase: 'attack', actor: first,
      passed: [], taking: false, limit: 6, moves: 0, bout: 1, out: [], gameOver: false, reason: '', loser: -1, last: null, firstLow: low < 99 ? RANKS[low] + trump : null };
    st.defender = nextAlive(st, first);
    st.limit = Math.min(CONFIG.hand, st.seats[st.defender].hand.length);
    return st;
  }

  function ranksOnTable(st) { var o = {}; st.table.forEach(function (p) { o[p.a[0]] = true; if (p.d) o[p.d[0]] = true; }); return o; }
  function unbeaten(st) { return st.table.map(function (p, i) { return p.d ? -1 : i; }).filter(function (i) { return i >= 0; }); }
  // Порядок подкидывающих: ходивший, потом остальные по кругу (без отбивающегося)
  function throwers(st) {
    var out = [], n = st.seats.length;
    for (var k = 0; k < n; k++) { var i = (st.attacker + k) % n; if (!st.seats[i].out && i !== st.defender) out.push(i); }
    return out;
  }
  function canThrow(st, seat) {
    if (st.table.length >= st.limit) return [];
    var hand = st.seats[seat].hand;
    if (!st.table.length) return seat === st.attacker ? hand.slice() : [];
    var rs = ranksOnTable(st);
    // подкинуть можно, только если у отбивающегося хватит карт покрыть всё непобитое
    if (unbeaten(st).length >= size(st, st.defender) && !st.taking) return [];
    return hand.filter(function (c) { return rs[c[0]]; });
  }
  function canTransfer(st) {
    if (st.mode !== 'perevodnoy' || st.taking || !st.table.length || st.table.some(function (p) { return p.d; })) return [];
    var r0 = st.table[0].a[0];
    if (!st.table.every(function (p) { return p.a[0] === r0; })) return [];
    var next = nextAlive(st, st.defender);                    // вдвоём перевод уходит обратно ходившему — так и по правилам
    if (next < 0) return [];
    if (size(st, next) < st.table.length + 1 || st.table.length + 1 > CONFIG.hand) return [];
    return st.seats[st.defender].hand.filter(function (c) { return c[0] === r0; });
  }

  // Что может сделать тот, чья очередь
  function legal(st) {
    var out = { seat: st.actor, attack: [], defend: [], transfer: [], take: false, pass: false };
    if (st.gameOver || st.actor < 0) return out;
    if (st.phase === 'defend' && st.actor === st.defender) {
      var hand = st.seats[st.defender].hand;
      unbeaten(st).forEach(function (t) { hand.forEach(function (c) { if (beats(c, st.table[t].a, st.trump)) out.defend.push({ card: c, target: t }); }); });
      out.transfer = canTransfer(st);
      out.take = true;
    } else if (st.phase === 'attack' || st.phase === 'throw') {
      out.attack = canThrow(st, st.actor);
      out.pass = st.phase === 'throw';                // первую карту захода класть обязательно
    }
    return out;
  }

  // Следующий подкидывающий, у которого есть что подкинуть; никого — заход окончен
  function nextThrower(st) {
    var order = throwers(st);
    for (var k = 0; k < order.length; k++) {
      var s = order[k];
      if (st.passed.indexOf(s) >= 0) continue;
      if (canThrow(st, s).length) return s;
      st.passed.push(s);                              // подкинуть нечего — пасует сам
    }
    return -1;
  }
  function toThrow(st, events) {
    st.phase = 'throw';
    var s = nextThrower(st);
    if (s >= 0) { st.actor = s; return; }
    endBout(st, events);
  }

  function draw(st) {
    var order = [st.attacker].concat(throwers(st).filter(function (s) { return s !== st.attacker; }));
    if (st.defender >= 0 && !st.seats[st.defender].out) order.push(st.defender);
    order.forEach(function (s) { var h = st.seats[s].hand; while (h.length < CONFIG.hand && st.deck.length) h.push(st.deck.shift()); });
  }
  function endBout(st, events) {
    var took = st.taking, def = st.defender;
    if (took) st.table.forEach(function (p) { st.seats[def].hand.push(p.a); if (p.d) st.seats[def].hand.push(p.d); });
    else st.discard += st.table.reduce(function (a, p) { return a + (p.d ? 2 : 1); }, 0);
    events.push({ type: took ? 'took' : 'bito', seat: def, cards: st.table.length });
    st.last = { type: took ? 'took' : 'bito', seat: def };
    st.table = []; st.passed = []; st.taking = false;
    draw(st);
    // кто остался без карт при пустой колоде — вышел
    if (!st.deck.length) st.seats.forEach(function (s, i) { if (!s.out && !s.hand.length) { s.out = true; st.out.push(i); events.push({ type: 'out', seat: i }); } });
    var left = alive(st);
    if (left.length <= 1) { finish(st, left.length ? left[0] : -1, 'finished', events); return; }
    // следующий заход: отбился — ходит он; забрал — ходит следующий за ним
    var att = took ? nextAlive(st, def) : (st.seats[def].out ? nextAlive(st, def) : def);
    st.attacker = att; st.defender = nextAlive(st, att);
    st.phase = 'attack'; st.actor = att; st.bout++;
    st.limit = Math.min(CONFIG.hand, st.seats[st.defender].hand.length);
  }
  function finish(st, loser, reason, events) {
    st.gameOver = true; st.loser = loser; st.reason = reason; st.actor = -1; st.phase = 'over';
    events.push({ type: 'over', loser: loser, reason: reason });
  }
  function take(hand, card) { var i = hand.indexOf(card); if (i < 0) return false; hand.splice(i, 1); return true; }

  function reduce(state, action) {
    if (!action || typeof action !== 'object') return bad('bad-action');
    var seat = action.seat;
    if (typeof seat !== 'number' || !state.seats[seat]) return bad('bad-seat');
    if (state.gameOver) {
      if (action.type !== 'leave' || !state.seats[seat].active) return bad('game-over');
      var gone = clone(state); gone.seats[seat].active = false;
      return { ok: true, state: gone, events: [] };
    }
    var st = clone(state), events = [];
    if (action.type === 'concede' || action.type === 'leave') {
      if (action.type === 'leave') st.seats[seat].active = false;
      if (st.seats[seat].out) { if (action.type === 'leave') return { ok: true, state: st, events: events }; return bad('already-out'); }     // вышедший без карт уже не дурак
      finish(st, seat, action.type === 'leave' ? 'left' : 'concede', events);
      return { ok: true, state: st, events: events };
    }
    if (seat !== st.actor) return bad('not-your-turn');
    var lg = legal(st), card = action.card, me = st.seats[seat];
    st.moves++;
    if (action.type === 'attack') {
      if (!valid(card) || lg.attack.indexOf(card) < 0) return bad('illegal');
      take(me.hand, card);
      st.table.push({ a: card, d: null });
      st.last = { type: 'attack', seat: seat, card: card };
      events.push({ type: 'attack', seat: seat, card: card });
      st.passed = [];
      if (st.taking) { toThrow(st, events); }                       // отбивающийся уже забирает: можно подкидывать дальше
      else { st.phase = 'defend'; st.actor = st.defender; }
    } else if (action.type === 'defend') {
      var t = Math.floor(Number(action.target));
      if (!valid(card) || !lg.defend.some(function (d) { return d.card === card && d.target === t; })) return bad('illegal');
      take(me.hand, card);
      st.table[t].d = card;
      st.last = { type: 'defend', seat: seat, card: card, target: t };
      events.push({ type: 'defend', seat: seat, card: card, target: t });
      if (!unbeaten(st).length) { st.passed = []; toThrow(st, events); }
    } else if (action.type === 'transfer') {
      if (!valid(card) || lg.transfer.indexOf(card) < 0) return bad('illegal');
      take(me.hand, card);
      st.table.push({ a: card, d: null });
      events.push({ type: 'transfer', seat: seat, card: card });
      st.last = { type: 'transfer', seat: seat, card: card };
      st.attacker = seat; st.defender = nextAlive(st, seat);
      st.limit = Math.max(st.table.length, Math.min(CONFIG.hand, st.seats[st.defender].hand.length));   // карт на столе не больше, чем новому отбивающемуся есть чем крыть
      st.actor = st.defender; st.phase = 'defend'; st.passed = [];
    } else if (action.type === 'take') {
      if (!lg.take) return bad('illegal');
      st.taking = true; st.passed = [];
      st.last = { type: 'take', seat: seat };
      events.push({ type: 'take', seat: seat });
      toThrow(st, events);
    } else if (action.type === 'pass') {
      if (!lg.pass) return bad('illegal');
      st.passed.push(seat);
      st.last = { type: 'pass', seat: seat };
      events.push({ type: 'pass', seat: seat });
      toThrow(st, events);
    } else return bad('unknown-action');
    return { ok: true, state: st, events: events };
  }

  // Вид стола для всех: чужие карты и колода скрыты (только число), козырь виден
  function view(st) {
    var v = clone(st);
    v.deckCount = st.deck.length; delete v.deck;
    v.seats = st.seats.map(function (s) { var o = clone(s); o.count = s.hand.length; delete o.hand; return o; });
    return v;
  }
  function secrets(st) { var o = {}; st.seats.forEach(function (s) { o[s.id] = s.hand.slice(); }); return o; }
  function waitingSeats(st) { return st.gameOver || st.actor < 0 ? [] : [st.actor]; }
  function progressKey(st, seat) { return st.moves + ':' + st.actor; }
  function deckTotal(st) { return st.deckSize || 36; }
  function cleanAction(p) {
    var out = { type: p.type };
    if (typeof p.card === 'string') out.card = p.card.slice(0, 2);
    if (typeof p.target === 'number') out.target = Math.floor(p.target);
    return out;
  }

  root.Durak = {
    CONFIG: CONFIG, PLAYER_ACTIONS: PLAYER_ACTIONS, RANKS: RANKS, SUITS: SUITS,
    init: init, reduce: reduce, view: view, secrets: secrets, legal: legal, size: size, isTrump: isTrump, parseMode: parseMode, deckTotal: deckTotal, beats: beats, rank: rank, suit: suit, sortHand: sortHand, nextAlive: nextAlive, alive: alive,
    waitingSeats: waitingSeats, progressKey: progressKey, cleanAction: cleanAction, botNames: BOT_NAMES,
    // Ход бота за онлайн-столом (shared/rooms-turns.js): нужен games/durak/bot.js
    botAction: function (st, seat, rng) { return root.DurakBot ? root.DurakBot.choose(st, seat, st.seats[seat].level || 'medium', rng) : null; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
