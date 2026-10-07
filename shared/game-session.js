// Сессия игры: общий каркас для «Ятзи», блэкджека, покера и других игр, готовый к мультиплееру.
// Идея: игра описана тремя чистыми функциями, а сессия хранит места за столом, журнал действий и подписчиков.
//
//   game = {
//     init(seats, options, rng) → state,
//     reduce(state, action, rng) → { ok, state, events } | { ok: false, error },   // действие содержит seat
//     view(state, seat) → то, что видит это место (карты соперников скрыты)       // необязательно
//   }
//   seats = [{ id, name, kind: 'human' | 'cpu' | 'remote' }]   — kind сообщает, откуда ждать действия
//
//   var s = PlatformSession.create({ game, seats, seed })
//   s.dispatch(action)   → { ok, events } | { ok: false, error };   действие применяется и попадает в журнал
//   s.getState(), s.viewFor(seat), s.getLog(), s.subscribe(fn)
//   PlatformSession.replay(options, log) → восстановление партии по журналу (то же начальное seed и те же действия)
//   transport — необязательный объект { send(entry), onRemote(fn) }: через него действия уходят по сети
//   и приходят от других игроков. Сейчас сети нет, поэтому по умолчанию действия применяются на месте.
(function (root) {
  // Детерминированный генератор: одинаковый seed даёт одинаковые броски и раздачи у всех участников
  function createRng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalizeSeats(seats) {
    return (seats || []).map(function (s, i) {
      return { id: s && s.id !== undefined ? String(s.id) : 'seat' + i, name: s && s.name ? String(s.name) : '', kind: s && (s.kind === 'cpu' || s.kind === 'remote') ? s.kind : 'human' };
    });
  }

  function create(options) {
    var game = options.game, seats = normalizeSeats(options.seats);
    var seed = options.seed === undefined ? Math.floor(Math.random() * 4294967296) : options.seed >>> 0;
    var transport = options.transport || null;
    var rng = createRng(seed);
    var state = game.init(seats, options.options || {}, rng);
    var log = [], listeners = [];

    function apply(action, fromRemote) {
      var res = game.reduce(state, action, rng);
      if (!res || !res.ok) return { ok: false, error: res && res.error ? res.error : 'rejected' };
      state = res.state;
      log.push(action);
      if (transport && !fromRemote && typeof transport.send === 'function') transport.send({ action: action, index: log.length - 1 });
      var events = res.events || [];
      listeners.forEach(function (fn) { try { fn(state, events, action); } catch (e) { /* подписчик не должен ломать игру */ } });
      return { ok: true, events: events };
    }

    if (transport && typeof transport.onRemote === 'function') {
      transport.onRemote(function (entry) { if (entry && entry.action) apply(entry.action, true); });
    }

    return {
      seed: seed,
      seats: seats,
      getState: function () { return state; },
      viewFor: function (seat) { return game.view ? game.view(state, seat) : state; },
      getLog: function () { return log.slice(); },
      dispatch: function (action) { return apply(action, false); },
      subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
    };
  }

  // Воспроизводит партию: полезно для проверки честности, показа повтора и восстановления после обрыва связи
  function replay(options, log) {
    var s = create(options);
    for (var i = 0; i < log.length; i++) {
      var r = s.dispatch(log[i]);
      if (!r.ok) return { ok: false, error: r.error, at: i, session: s };
    }
    return { ok: true, session: s };
  }

  root.PlatformSession = { create: create, replay: replay, createRng: createRng };
})(typeof window !== 'undefined' ? window : globalThis);
