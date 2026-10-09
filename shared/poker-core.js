// Ход партии в покере без интерфейса: стол «С ботами» (локально) и онлайн-стол (через сервер) отдают экранам одну и ту же модель.
// Зависит от games/poker/logic.js (Poker) и bots.js (PokerBots); без обращений к document.
//   PokerCore.createSolo({ variant, size, ante | bigBlind, name, wallet, source })   → стол против ботов
//   PokerCore.createOnline({ ctrl, wallet, source, uid, variant })                              → онлайн-стол (контроллер из shared/rooms-ws.js)
// Общие методы стола: model(), subscribe(fn), act(type, extra), back(), leave(), tick(); у онлайн-стола ещё here(), start(), chat.
// model() — всё, что нужно нарисовать: места, карты, банк, статусы, панели итога, вопросы, готовность, баннеры.
(function (root) {
  var PK = root.Poker, Bots = root.PokerBots;
  var HOLD_MS = 1000, FLIP_MS = 1100;    // пауза перед открытием карты и время переворота при вскрытии (в тестах сокращаются: cfg.holdMs, cfg.flipMs, cfg.botMs)

  function now() { return Date.now(); }
  function reduced() { try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  // ===== Модель экрана из состояния партии =====
  // Ключи состояния места (k): left, out, win, fold, allin, turn, yourTurn, check, call, raise, wait, ready, skip, '' — экран подставляет свои надписи
  function seatStatus(ctx, s) {
    var st = ctx.st, isMe = s.index === ctx.me;
    if (!s.active) return { k: 'left' };
    if (ctx.stage === 'broke' && isMe) return { k: 'out' };
    if (st.phase === 'settled') {
      if (ctx.ready && ctx.ready[s.id]) return { k: 'ready' };
      if (s.sitOut) return { k: 'skip' };
      if (s.net > 0 && s.inHand) return { k: 'win' };
      return s.folded ? { k: 'fold' } : { k: '' };
    }
    if (st.phase === 'waiting') return { k: s.sitOut ? 'skip' : '' };
    if (!s.inHand) return { k: s.sitOut ? 'skip' : '' };
    if (s.folded) return { k: 'fold' };
    if (s.allIn) return { k: 'allin' };
    if (st.current === s.index && !ctx.holding && !ctx.stage) return { k: isMe ? 'yourTurn' : 'turn' };
    if (s.acted) {
      if (s.last === 'check') return { k: 'check' };
      if (s.last === 'call') return { k: 'call' };
      if (s.last === 'raise' || s.last === 'bet') return { k: 'raise', n: s.bet };
    }
    return { k: 'wait' };
  }
  function winnerCodes(st) {
    var codes = {}, win = {};
    (st.pots || []).forEach(function (p) { (p.winners || []).forEach(function (i) { win[i] = true; }); });
    Object.keys(win).forEach(function (i) { var h = st.seats[i].hand; if (h) h.cards.forEach(function (c) { codes[c] = true; }); });
    return { codes: codes, win: win };
  }
  // Банки с одинаковым составом участников и победителями показываются одной строкой
  function mergedPots(st) {
    var out = [];
    (st.pots || []).forEach(function (p) {
      var key = p.eligible.join(',') + '|' + (p.winners || []).join(','), last = out[out.length - 1];
      if (last && last.key === key) last.amount += p.amount; else out.push({ key: key, amount: p.amount, eligible: p.eligible.slice(), winners: (p.winners || []).slice() });
    });
    return out;
  }
  function summaryOf(st, me) {
    var rows = st.seats.filter(function (s) { return s.inHand; }).sort(function (a, b) { return (b.net > 0) - (a.net > 0) || a.index - b.index; }).map(function (s) {
      return { seat: s.index, isMe: s.index === me, name: s.name, bet: s.total, folded: s.folded, cards: s.folded ? [] : s.cards.slice(), combo: !s.folded && s.hand ? s.hand.name : '', win: s.net > 0 ? s.net + s.total : 0 };
    });
    var side = 0, lines = mergedPots(st).map(function (p) {
      var names = p.winners.map(function (w) { return { name: st.seats[w].name, isMe: w === me }; });
      if (p.eligible.length === 1) return { k: 'returned', names: names, amount: p.amount };
      var first = side++ === 0, tie = p.winners.length > 1;
      return { k: first ? (tie ? 'mainTie' : 'main') : (tie ? 'sideTie' : 'side'), names: names, amount: p.amount, win: Math.floor(p.amount / p.winners.length), n: side - 1 };
    });
    var w = st.seats.filter(function (s) { return s.net > 0; })[0];
    return { rows: rows, bank: st.pot, lines: lines, taker: w ? { name: w.name, isMe: w.index === me, pay: w.net + w.total } : null };
  }

  function buildModel(ctx) {
    var st = ctx.st, me = ctx.me, n = st.seats.length, holding = ctx.holding;
    var showdown = st.phase === 'settled' && !!(st.result && st.result.showdown);
    var wc = showdown ? winnerCodes(st) : { codes: {}, win: {} };
    var order = [];
    for (var k = 0; k < n; k++) { var i = (me + k) % n; if (st.seats[i].active || i === me) order.push(i); }
    var seats = order.map(function (i) {
      var s = st.seats[i], isMe = i === me, cards = [];
      if (s.inHand && s.cards.length) {
        if (isMe) cards = s.cards.map(function (c) { return { code: c, dim: s.folded || (showdown && !wc.win[i]), hl: showdown && !!wc.win[i], flip: false }; });
        else if (!s.folded) cards = showdown && s.shown ? s.cards.map(function (c) { return { code: c, dim: !wc.win[i], hl: !!wc.win[i], flip: ctx.stage === 'flip' }; }) : [{ code: null }, { code: null }];
      }
      return {
        index: i, isMe: isMe, id: s.id, name: s.name, kind: s.kind, chips: s.chips, bet: st.phase === 'settled' ? 0 : s.bet, total: s.total, folded: s.folded, allIn: s.allIn, inHand: s.inHand, out: !s.active,
        turn: st.current === i && !holding && !ctx.stage && st.phase !== 'settled', timer: ctx.timerOf ? ctx.timerOf(i) : null, status: seatStatus(ctx, s), cards: cards, winner: !!wc.win[i],
        dealer: st.button === i, sb: st.sbSeat === i, bb: st.bbSeat === i
      };
    });
    var shown = holding ? ctx.prevBoardLen : st.board.length, board = [];
    for (var b = 0; b < 5; b++) {
      if (b < shown) board.push({ code: st.board[b], hl: showdown && !!wc.codes[st.board[b]], dim: showdown && !wc.codes[st.board[b]] });
      else board.push({ code: '' });
    }
    var la = (!ctx.stage && !holding && !ctx.pending && st.phase !== 'settled' && st.current === me) ? PK.legalActions(st, me) : null;
    var roundKey = (ctx.stage === 'flip' || ctx.stage === 'summary' || showdown) ? 'show' : ({ preflop: 'pre', flop: 'flop', turn: 'turn', river: 'river' }[st.phase] || 'wait');
    var meSeat = st.seats[me];
    return {
      variant: st.variant, phase: st.phase, stage: ctx.stage, round: st.round, roundKey: roundKey, pot: st.pot, currentBet: st.currentBet, minBet: st.minBet, ante: st.ante, smallBlind: st.smallBlind, bigBlind: st.bigBlind, mandatory: st.mandatory,
      board: board, seats: seats, me: { index: me, stack: ctx.stack, chips: meSeat.chips, bet: meSeat.bet, folded: meSeat.folded, la: la, holding: holding, waiting: !la && !ctx.stage && !holding && st.phase !== 'settled' && st.phase !== 'waiting', waitingFor: st.current >= 0 && st.current !== me ? st.seats[st.current].name : '' },
      caption: holding ? ctx.caption : '', pending: !!ctx.pending, summary: ctx.stage === 'summary' || ctx.stage === 'short' ? summaryOf(st, me) : null,
      notice: ctx.notice || null, toasts: ctx.toasts || [], ask: ctx.ask || null, ready: null, banner: ctx.banner || null
    };
  }

  // ===== Стол против ботов =====
  // Характеры ботов случайные: порядок осторожный/средний/смелый перемешивается при каждой посадке за стол (имена у каждого характера свои)
  function botSeats(n) {
    var out = [], order = Bots.ORDER.slice();
    for (var k = order.length - 1; k > 0; k--) { var j = Math.floor(Math.random() * (k + 1)), t = order[k]; order[k] = order[j]; order[j] = t; }
    for (var i = 1; i < n; i++) {
      var bot = Bots.makeBot(i), style = order[(i - 1) % order.length];
      bot.style = style; bot.name = Bots.STYLES[style].name;
      out.push(bot);
    }
    return out;
  }
  function Solo(cfg) {
    this.cfg = cfg; this.W = cfg.wallet; this.source = cfg.source || 'poker';
    this.holdMs = cfg.holdMs !== undefined ? cfg.holdMs : (reduced() ? 400 : HOLD_MS); this.flipMs = cfg.flipMs !== undefined ? cfg.flipMs : (reduced() ? 600 : FLIP_MS);
    this.listeners = []; this.stage = null; this.holdUntil = 0; this.prevBoardLen = 0; this.caption = ''; this.notice = null; this.timer = null; this.spent = 0; this.stopped = false;
    var balance = this.W.getBalance(), n = cfg.size;
    this.W.capStart(now());
    var seats = [{ id: 'me', name: cfg.name || '', kind: 'human', chips: balance }].concat(botSeats(n).map(function (b) { return Object.assign(b, { chips: balance }); }));
    var gopts = { variant: cfg.variant, tableSize: n };
    if (cfg.variant === 'simple') { gopts.ante = cfg.ante; gopts.minBet = cfg.minBet || cfg.ante * 2; } else { gopts.bigBlind = cfg.bigBlind; gopts.smallBlind = cfg.smallBlind || Math.floor(cfg.bigBlind / 2); }
    this.st = PK.init(seats, gopts, null);
    this.botStack = balance;
  }
  Solo.prototype.subscribe = function (fn) { this.listeners.push(fn); };
  Solo.prototype.emit = function () { var m = this; this.listeners.forEach(function (fn) { try { fn(m); } catch (e) { /* подписчик не должен ломать стол */ } }); };
  Solo.prototype.holding = function () { return now() < this.holdUntil; };
  Solo.prototype.minToPlay = function () { return this.st.variant === 'simple' ? this.st.ante : this.st.bigBlind; };
  Solo.prototype.begin = function () { this.startHand(); };
  Solo.prototype.startHand = function () {
    var st = this.st, W = this.W, self = this;
    if (W.getBalance() < this.minToPlay()) { this.stage = 'broke'; this.emit(); return; }
    st.seats[0].chips = W.getBalance();
    st.seats.forEach(function (s, i) { if (i > 0) { s.chips = self.botStack; s.sitOut = false; } });
    var r = PK.reduce(st, { type: 'deal', seat: 0 }, Math.random);
    if (!r.ok) { this.stage = 'broke'; this.emit(); return; }
    this.st = r.state; this.stage = null; this.holdUntil = 0; this.prevBoardLen = 0; this.caption = '';
    W.markPlayed(); W.countPlay(this.source);
    this.spendSync(); this.emit(); this.pump();
  };
  Solo.prototype.spendSync = function () {
    var total = this.st.seats[0].total;
    if (total > this.spent) { this.W.spend(total - this.spent, this.source, now()); this.spent = total; }
  };
  Solo.prototype.apply = function (action) {
    var before = this.st, r = PK.reduce(before, action, Math.random), self = this;
    if (!r.ok) return false;
    this.st = r.state; this.spendSync();
    if (r.state.phase === 'settled') { this.onSettled(); return true; }
    if (r.state.board.length > before.board.length) {
      this.prevBoardLen = before.board.length; this.holdUntil = now() + this.holdMs; this.caption = 'next';
      setTimeout(function () { if (!self.stopped) self.emit(); }, this.holdMs + 20);
    }
    this.emit(); this.pump();
    return true;
  };
  Solo.prototype.pump = function () {
    clearTimeout(this.timer);
    var st = this.st, self = this;
    if (this.stage || this.stopped || st.phase === 'waiting' || st.phase === 'settled' || st.current <= 0) return;
    var wait = Math.max(0, this.holdUntil - now()) + (this.cfg.botMs !== undefined ? this.cfg.botMs : (reduced() ? 200 : 800 + Math.random() * 400));
    this.timer = setTimeout(function () {
      if (self.stopped || self.stage || self.st.current <= 0) return;
      var a = Bots.nextBotAction(self.st, Math.random), cur = self.st.current;
      if (!a || !self.apply(a)) self.apply({ type: self.st.currentBet > self.st.seats[cur].bet ? 'fold' : 'check', seat: cur });
    }, wait);
  };
  Solo.prototype.onSettled = function () {
    var st = this.st, me = st.seats[0], payout = me.total + me.net, self = this;
    if (payout > 0) {
      var cr = this.W.capPayout(this.source, payout, this.spent, now());
      if (cr.capped) this.notice = { k: cr.granted > 0 ? 'capCut' : 'capReached', n: cr.granted, until: now() + 6000 };
    }
    if (me.net > 0) this.W.countWin(this.source);
    this.spent = 0; this.caption = '';
    if (st.result && st.result.showdown) {
      this.stage = 'flip'; this.emit();
      setTimeout(function () { if (!self.stopped && self.stage === 'flip') { self.stage = 'summary'; self.emit(); } }, this.flipMs);
    } else { this.stage = 'short'; this.emit(); }
  };
  Solo.prototype.act = function (type, extra) {
    if (this.stopped || this.stage || this.st.current !== 0 || this.holding()) return false;
    return this.apply(Object.assign({ type: type, seat: 0 }, extra || {}));
  };
  Solo.prototype.back = function () { this.stage = null; this.startHand(); };
  Solo.prototype.inHand = function () { var st = this.st; return ['preflop', 'flop', 'turn', 'river'].indexOf(st.phase) >= 0 && !st.seats[0].folded; };
  Solo.prototype.leave = function () { this.stopped = true; clearTimeout(this.timer); };
  Solo.prototype.tick = function () { if (this.notice && now() > this.notice.until) { this.notice = null; this.emit(); } };
  Solo.prototype.model = function () {
    var me = this.st.seats[0];
    return Object.assign(buildModel({ mode: 'bots', st: this.st, me: 0, stage: this.stage, holding: this.holding(), prevBoardLen: this.prevBoardLen, caption: this.caption, stack: this.W.getBalance(), notice: this.notice && now() <= this.notice.until ? this.notice : null }), { mode: 'bots', canLeaveFree: !this.inHand(), myChips: me.chips });
  };

  // ===== Онлайн-стол =====
  function Online(cfg) {
    this.cfg = cfg; this.W = cfg.wallet; this.source = cfg.source || 'poker'; this.ctrl = cfg.ctrl; this.uid = cfg.uid;
    this.listeners = []; this.v = null; this.stage = null; this.holdUntil = 0; this.prevBoardLen = 0; this.caption = ''; this.notice = null; this.spent = 0; this.pending = false;
    this.round = -1; this.settledRound = -1; this.strikes = 0; this.toasts = []; this.askAt = 0; this.joined = false; this.stopped = false; this.members = null; this.autoAck = true;
    var self = this;
    this.ctrl.onChange(function (v) { self.onView(v); });
    if (this.ctrl.getView()) this.onView(this.ctrl.getView());
  }
  Online.prototype.subscribe = function (fn) { this.listeners.push(fn); };
  Online.prototype.emit = function () { var m = this; this.listeners.forEach(function (fn) { try { fn(m); } catch (e) { /* подписчик не должен ломать стол */ } }); };
  Online.prototype.holding = function () { return now() < this.holdUntil; };
  Online.prototype.toast = function (k, name) { this.toasts.push({ k: k, name: name, until: now() + 4000 }); };
  Online.prototype.onView = function (v) {
    if (this.stopped) return;
    var prev = this.v, self = this, st = v.state;
    this.v = v; this.pending = false;
    if (v.joined) this.joined = true;
    // кто пришёл и ушёл
    if (prev && prev.members && v.members) {
      var had = {}, has = {};
      prev.members.forEach(function (m) { had[m.uid] = m; }); v.members.forEach(function (m) { has[m.uid] = m; });
      v.members.forEach(function (m) { if (!had[m.uid] && m.uid !== self.uid) self.toast('joined', m.name); });
      prev.members.forEach(function (m) { if (!has[m.uid] && m.uid !== self.uid) self.toast('left', m.name); });
    }
    if (!st) { this.emit(); return; }
    var mine = v.seat === null ? null : st.seats[v.seat];
    if (st.round !== this.round) {                      // началась новая раздача
      this.round = st.round; if (this.stage !== 'broke') this.stage = null; this.holdUntil = 0; this.prevBoardLen = 0; this.caption = ''; this.spent = 0;
      if (mine && mine.inHand) { this.W.markPlayed(); this.W.countPlay(this.source); }
    }
    if (mine && !(st.phase === 'settled' && this.settledRound === st.round)) this.spendSync(mine);
    if (prev && prev.state && prev.state.round === st.round && st.board.length > prev.state.board.length && st.phase !== 'settled') {
      this.prevBoardLen = prev.state.board.length; this.holdUntil = now() + (reduced() ? 400 : HOLD_MS); this.caption = 'next';
      setTimeout(function () { if (!self.stopped) self.emit(); }, (reduced() ? 400 : HOLD_MS) + 20);
    }
    if (st.phase === 'settled' && this.settledRound !== st.round) { this.settledRound = st.round; this.onSettled(st, mine); }
    // «Вы ещё играете?» и автоходы
    var tm = v.timers.filter(function (t) { return t.seat === v.seat; })[0];
    if (tm && tm.stage === 'asking') { this.askAt = 1; this.askMs = tm.ms; this.askSince = now(); }
    else this.askAt = 0;
    var strikes = (v.strikes && v.strikes[this.uid]) || 0;
    if (strikes > this.strikes) { this.autoAck = false; }
    this.strikes = strikes;
    if (this.joined && v.seat === null && !v.closed) this.out = true;
    this.emit();
  };
  Online.prototype.spendSync = function (mine) {
    if (mine.total > this.spent) { this.W.spend(mine.total - this.spent, this.source, now()); this.spent = mine.total; }
  };
  Online.prototype.onSettled = function (st, mine) {
    var self = this;
    if (mine && mine.inHand) {
      var payout = mine.total + mine.net;
      var back = Math.min(payout, this.spent);
      if (back > 0) this.W.add(back, this.source, now());
      if (payout > this.spent) {
        var cr = this.W.onlineWin(this.source, payout - this.spent, now());
        if (cr.capped) this.notice = { k: cr.granted > 0 ? 'capCut' : 'capReached', n: cr.granted, until: now() + 6000 };
      }
      if (mine.net > 0) this.W.countWin(this.source);
    }
    this.spent = 0; this.caption = '';
    if (st.result && st.result.showdown) {
      this.stage = 'flip';
      setTimeout(function () { if (!self.stopped && self.stage === 'flip') { self.stage = 'summary'; self.emit(); } }, reduced() ? 600 : FLIP_MS);
    } else this.stage = 'short';
    if (mine && mine.chips <= 0) this.brokeAfter = true;
  };
  Online.prototype.send = function (action) { var self = this; this.pending = true; this.emit(); return Promise.resolve(this.ctrl.send(action)).then(null, function () { self.pending = false; self.emit(); }); };
  Online.prototype.act = function (type, extra) {
    var v = this.v;
    if (this.stopped || !v || !v.state || this.stage || this.holding() || v.state.current !== v.seat) return false;
    this.send(Object.assign({ type: type }, extra || {}));
    return true;
  };
  Online.prototype.here = function () { this.send({ type: 'here' }); this.askAt = 0; };
  Online.prototype.ackAuto = function () { this.autoAck = true; this.emit(); };
  Online.prototype.back = function () {
    if (this.brokeAfter) { this.stage = 'broke'; this.emit(); return; }
    this.stage = 'ready'; this.send({ type: 'ready' });
  };
  Online.prototype.start = function () { return this.send({ type: 'start' }); };
  Online.prototype.chatSend = function (text, cid) { return this.ctrl.send({ type: 'chat', text: text, cid: cid }); };
  Online.prototype.leave = function () { this.stopped = true; try { this.ctrl.leave(); } catch (e) { /* закрываем */ } };
  Online.prototype.inHand = function () { var v = this.v, st = v && v.state; return !!st && ['preflop', 'flop', 'turn', 'river'].indexOf(st.phase) >= 0 && v.seat !== null && !st.seats[v.seat].folded; };
  Online.prototype.tick = function () {
    var t = now(), before = this.toasts.length;
    this.toasts = this.toasts.filter(function (x) { return t < x.until; });
    if (this.notice && t > this.notice.until) { this.notice = null; before = -1; }
    if (this.stage === 'ready' && this.v && this.v.state && this.v.state.phase !== 'settled') { this.stage = null; before = -1; }
    if (this.askAt || this.toasts.length !== before || before === -1) this.emit();
  };
  // Вопрос «Вы ещё играете?»: ask (идёт отсчёт), auto (ход сделан за вас), out (вы выбыли)
  Online.prototype.askInfo = function () {
    if (this.out) return { k: 'out' };
    if (this.askAt) return { k: 'ask', ms: Math.max(0, this.askMs - (now() - this.askSince)), total: (this.cfg.askMs || 7000) };
    if (!this.autoAck) return { k: 'auto' };
    return null;
  };
  Online.prototype.model = function () {
    var v = this.v;
    if (!v) return { mode: 'online', loading: true };
    if (!v.state) {
      return { mode: 'online', lobby: true, status: v.status, closed: v.closed || v.status === 'closed', code: v.code, members: v.members, owner: v.owner, size: v.size, startIn: v.startIn >= 0 ? Math.max(0, v.startIn - (now() - v.receivedAt)) : -1,
        variant: v.variant, ante: v.ante, minBet: v.minBet, bigBlind: v.bigBlind, smallBlind: v.smallBlind, private: v.private, isOwner: v.owner === this.uid, hostGone: v.hostGone, toasts: this.toasts.slice(), chat: v.chat };
    }
    var mineSeat = v.seat === null ? 0 : v.seat, readyMap = {};
    (v.ready || []).forEach(function (u) { readyMap[u] = true; });
    var stage = this.stage;
    var model = buildModel({ mode: 'online', st: v.state, me: mineSeat, stage: stage, holding: this.holding(), prevBoardLen: this.prevBoardLen, caption: this.caption, stack: v.state.seats[mineSeat] ? v.state.seats[mineSeat].chips : 0, pending: this.pending,
      notice: this.notice, toasts: this.toasts.slice(), ready: stage === 'ready' || v.state.phase === 'settled' ? readyMap : null,
      timerOf: function (i) { var t = v.timers.filter(function (x) { return x.seat === i; })[0]; return t ? { stage: t.stage, ms: Math.max(0, t.ms - (now() - v.receivedAt)) } : null; },
      ask: this.askInfo() });
    if (v.state.phase === 'settled') {
      var cand = v.state.seats.filter(function (s) { return s.active && s.chips > 0; });
      model.ready = { count: cand.filter(function (s) { return readyMap[s.id]; }).length, total: cand.length, left: v.readyIn >= 0 ? Math.max(0, v.readyIn - (now() - v.receivedAt)) : -1, me: !!readyMap[this.uid] };
    }
    model.mode = 'online'; model.code = v.code; model.closed = v.closed; model.hostGone = v.hostGone; model.owner = v.owner; model.isOwner = v.owner === this.uid; model.chat = v.chat; model.members = v.members;
    model.stack = model.me.chips;
    return model;
  };

  root.PokerCore = {
    createSolo: function (cfg) { return new Solo(cfg); },
    createOnline: function (cfg) { return new Online(cfg); },
    summaryOf: summaryOf, buildModel: buildModel, seatStatus: seatStatus, DEN: [100, 150, 200, 250, 500, 750, 1000, 2000, 3000, 5000], HUE: [255, 215, 145, 85, 25, 350, 300, 195, 120, 50]
  };
})(typeof window !== 'undefined' ? window : globalThis);
