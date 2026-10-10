// Чистая логика «Морского боя» для двух игроков: расстановка флота, стрельба по очереди, победа.
// Форма та же, что у других игр с сервером столов: init / reduce / view, без DOM и без обращения к window.
// Правила: поле 10×10, флот 4 корабля по 1 клетке, 3 по 2, 2 по 3, 1 в 4 клетки; корабли стоят прямо и не касаются друг друга (даже углами).
// Игроки стреляют по очереди; при попадании («ранил» или «убил») ход остаётся, при промахе переходит. Выигрывает тот, кто первым потопил весь флот.
// Когда корабль потоплен, клетки вокруг него сразу отмечаются промахами.
//
// Клетка поля: индекс y * size + x. Отметки на поле игрока (по нему стреляет соперник): 0 — не стреляли, 1 — промах, 2 — ранен, 3 — потоплен.
//
//   Battleship.CONFIG, Battleship.PLAYER_ACTIONS
//   Battleship.init(seats, options, rng) → состояние; seats: [{ id, name }] (ровно два); options: { first } — кто ходит первым (иначе случайно по rng)
//   Battleship.reduce(state, action, rng) → { ok, state, events } | { ok: false, error }
//     { type: 'place',   seat, ships: [{ x, y, len, dir: 'h' | 'v' }] }   расстановка всего флота; игрок готов
//     { type: 'unplace', seat }                                            передумал, пока соперник не готов
//     { type: 'shoot',   seat, x, y }                                      выстрел по полю соперника
//     { type: 'concede', seat }                                            сдаться (выйти из игры): побеждает соперник
//   Battleship.view(state, seat) → вид для места seat (свои корабли целиком, чужие не видны; без seat — публичный вид, как у зрителя)
//   Battleship.randomLayout(rng, options) → список кораблей для действия place
//   Battleship.validateLayout(ships, options) → { ok, error?, ships }
//   Battleship.waitingSeats(state), Battleship.progressKey(state, seat), Battleship.legalActions(state, seat)
(function (root) {
  var CONFIG = { minSeats: 2, maxSeats: 2, size: 10, fleet: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1] };
  var PLAYER_ACTIONS = ['place', 'unplace', 'shoot', 'concede'];
  var MISS = 1, HIT = 2, SUNK = 3;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function bad(error) { return { ok: false, error: error }; }
  function sizeOf(o) { return (o && o.size) || CONFIG.size; }
  function fleetOf(o) { return (o && o.fleet) || CONFIG.fleet; }
  function otherSeat(seat) { return seat === 0 ? 1 : 0; }

  // Клетки корабля {x, y, len, dir} или null, если корабль выходит за поле
  function cellsOf(ship, size) {
    var x = Number(ship.x), y = Number(ship.y), len = Number(ship.len), dx = ship.dir === 'v' ? 0 : 1, dy = ship.dir === 'v' ? 1 : 0, out = [];
    if (!(isFinite(x) && isFinite(y) && isFinite(len)) || Math.floor(x) !== x || Math.floor(y) !== y || len < 1) return null;
    if (ship.dir !== 'h' && ship.dir !== 'v') return null;
    for (var i = 0; i < len; i++) {
      var cx = x + dx * i, cy = y + dy * i;
      if (cx < 0 || cy < 0 || cx >= size || cy >= size) return null;
      out.push(cy * size + cx);
    }
    return out;
  }
  // Соседние клетки (8 направлений) для индекса
  function around(idx, size) {
    var x = idx % size, y = Math.floor(idx / size), out = [];
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      var nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size) out.push(ny * size + nx);
    }
    return out;
  }

  // Проверка расстановки: состав флота, границы, без наложений и без касаний
  function validateLayout(ships, options) {
    var size = sizeOf(options), fleet = fleetOf(options).slice().sort(function (a, b) { return b - a; });
    if (!Array.isArray(ships) || ships.length !== fleet.length) return bad('fleet');
    var lens = ships.map(function (s) { return Number(s && s.len); }).sort(function (a, b) { return b - a; });
    for (var i = 0; i < fleet.length; i++) if (lens[i] !== fleet[i]) return bad('fleet');
    var owner = {}, out = [];
    for (var k = 0; k < ships.length; k++) {
      var cells = ships[k] && typeof ships[k] === 'object' ? cellsOf(ships[k], size) : null;
      if (!cells) return bad('bounds');
      for (var c = 0; c < cells.length; c++) { if (owner[cells[c]] !== undefined) return bad('overlap'); owner[cells[c]] = k; }
      out.push({ len: cells.length, cells: cells, hit: cells.map(function () { return false; }) });
    }
    for (var s = 0; s < out.length; s++) {
      for (var m = 0; m < out[s].cells.length; m++) {
        var nb = around(out[s].cells[m], size);
        for (var n = 0; n < nb.length; n++) if (owner[nb[n]] !== undefined && owner[nb[n]] !== s) return bad('touch');
      }
    }
    return { ok: true, ships: out };
  }

  // Случайная правильная расстановка: самые длинные корабли первыми, при тупике начинаем заново
  function randomLayout(rng, options) {
    rng = rng || Math.random;
    var size = sizeOf(options), fleet = fleetOf(options).slice().sort(function (a, b) { return b - a; });
    for (var attempt = 0; attempt < 500; attempt++) {
      var blocked = {}, ships = [], okAll = true;
      for (var i = 0; i < fleet.length && okAll; i++) {
        var placed = false;
        for (var t = 0; t < 200 && !placed; t++) {
          var dir = rng() < 0.5 ? 'h' : 'v', x = Math.floor(rng() * size), y = Math.floor(rng() * size);
          var cells = cellsOf({ x: x, y: y, len: fleet[i], dir: dir }, size);
          if (!cells || cells.some(function (c) { return blocked[c]; })) continue;
          cells.forEach(function (c) { blocked[c] = true; around(c, size).forEach(function (a) { blocked[a] = true; }); });
          ships.push({ x: x, y: y, len: fleet[i], dir: dir });
          placed = true;
        }
        if (!placed) okAll = false;
      }
      if (okAll) return ships;
    }
    throw new Error('layout');
  }

  function emptyBoard(size) { var b = []; for (var i = 0; i < size * size; i++) b.push(0); return b; }

  function init(seats, options, rng) {
    options = options || {};
    var size = sizeOf(options);
    var list = (seats || []).slice(0, 2).map(function (s, i) {
      return { id: s.id, name: s.name || '', active: true, ready: false, ships: [], marks: emptyBoard(size) };
    });
    while (list.length < 2) list.push({ id: 'seat' + list.length, name: '', active: false, ready: false, ships: [], marks: emptyBoard(size) });
    var first = options.first === 0 || options.first === 1 ? options.first : Math.floor((rng || Math.random)() * 2);
    return { v: 1, size: size, fleet: fleetOf(options).slice(), round: 1, phase: 'placing', gameOver: false, reason: '', winner: -1, current: -1, first: first, turns: 0, last: null, seats: list };
  }

  function shipAt(seat, idx) {
    for (var i = 0; i < seat.ships.length; i++) if (seat.ships[i].cells.indexOf(idx) >= 0) return seat.ships[i];
    return null;
  }
  function finish(ns, winner, reason, events) {
    ns.phase = 'finished'; ns.gameOver = true; ns.winner = winner; ns.reason = reason; ns.current = -1;
    events.push({ type: 'over', winner: winner, reason: reason });
  }

  function reduce(state, action, rng) {
    if (!action || typeof action !== 'object') return bad('bad-action');
    var seat = action.seat;
    if (seat !== 0 && seat !== 1) return bad('bad-seat');
    if (state.gameOver) return bad('game-over');
    var me = state.seats[seat];
    if (!me || !me.active) return bad('not-seated');
    var ns = clone(state), mine = ns.seats[seat], events = [];

    if (action.type === 'concede') {
      finish(ns, otherSeat(seat), 'concede', events);
      return { ok: true, state: ns, events: events };
    }

    if (action.type === 'place') {
      if (state.phase !== 'placing') return bad('wrong-phase');
      var v = validateLayout(action.ships, { size: state.size, fleet: state.fleet });
      if (!v.ok) return v;
      mine.ships = v.ships; mine.ready = true;
      events.push({ type: 'ready', seat: seat });
      var both = ns.seats.every(function (s) { return !s.active || s.ready; }) && ns.seats.filter(function (s) { return s.active; }).length === 2;
      if (both) { ns.phase = 'playing'; ns.current = ns.first; events.push({ type: 'start', first: ns.first }); }
      return { ok: true, state: ns, events: events };
    }

    if (action.type === 'unplace') {
      if (state.phase !== 'placing') return bad('wrong-phase');
      if (!mine.ready) return bad('not-ready');
      mine.ready = false; mine.ships = [];
      return { ok: true, state: ns, events: [{ type: 'unready', seat: seat }] };
    }

    if (action.type === 'shoot') {
      if (state.phase !== 'playing') return bad('wrong-phase');
      if (state.current !== seat) return bad('not-your-turn');
      var x = Number(action.x), y = Number(action.y), size = state.size;
      if (!isFinite(x) || !isFinite(y) || Math.floor(x) !== x || Math.floor(y) !== y || x < 0 || y < 0 || x >= size || y >= size) return bad('bounds');
      var foe = ns.seats[otherSeat(seat)], idx = y * size + x;
      if (foe.marks[idx] !== 0) return bad('already-shot');
      var ship = shipAt(foe, idx), result;
      if (!ship) {
        foe.marks[idx] = MISS; result = 'miss'; ns.current = otherSeat(seat);
      } else {
        ship.hit[ship.cells.indexOf(idx)] = true;
        if (ship.hit.every(Boolean)) {
          result = 'sunk';
          ship.cells.forEach(function (c) { foe.marks[c] = SUNK; });
          ship.cells.forEach(function (c) { around(c, size).forEach(function (a) { if (foe.marks[a] === 0) foe.marks[a] = MISS; }); });
        } else { result = 'hit'; foe.marks[idx] = HIT; }
      }
      ns.turns++;
      ns.last = { seat: seat, x: x, y: y, result: result };
      events.push({ type: 'shot', seat: seat, x: x, y: y, result: result });
      if (foe.ships.every(function (s) { return s.hit.every(Boolean); })) finish(ns, seat, 'fleet', events);
      return { ok: true, state: ns, events: events };
    }
    return bad('unknown-action');
  }

  function afloatCounts(seat) {
    var left = {};
    seat.ships.forEach(function (s) { if (!s.hit.every(Boolean)) left[s.len] = (left[s.len] || 0) + 1; });
    return left;
  }

  // Вид для места viewer: свои корабли целиком, чужие скрыты до конца игры. Без viewer — публичный вид
  function view(state, viewer) {
    var open = state.gameOver;
    return {
      v: state.v, size: state.size, fleet: state.fleet, round: state.round, phase: state.phase, gameOver: state.gameOver, reason: state.reason,
      winner: state.winner, current: state.current, turns: state.turns, last: state.last, first: state.first,
      seats: state.seats.map(function (s, i) {
        var show = i === viewer || open;
        return {
          id: s.id, name: s.name, active: s.active, ready: s.ready, marks: s.marks.slice(),
          left: s.ready ? afloatCounts(s) : null,
          ships: show ? s.ships.map(function (sh) { return { len: sh.len, cells: sh.cells.slice(), hit: sh.hit.slice() }; }) : []
        };
      })
    };
  }

  function legalActions(state, seat) {
    if (state.gameOver || !state.seats[seat] || !state.seats[seat].active) return [];
    if (state.phase === 'placing') return state.seats[seat].ready ? ['unplace', 'concede'] : ['place', 'concede'];
    var out = ['concede'];
    if (state.current === seat) out.unshift('shoot');
    return out;
  }
  // Места, от которых игра ждёт действия (для таймеров «Вы ещё играете?»)
  function waitingSeats(state) {
    if (state.gameOver) return [];
    if (state.phase === 'placing') return state.seats.map(function (s, i) { return s.active && !s.ready ? i : -1; }).filter(function (i) { return i >= 0; });
    return state.current >= 0 ? [state.current] : [];
  }
  function progressKey(state, seat) {
    var s = state.seats[seat];
    return state.phase + ':' + state.turns + ':' + (s && s.ready ? 1 : 0) + ':' + state.current;
  }

  root.Battleship = {
    CONFIG: CONFIG, PLAYER_ACTIONS: PLAYER_ACTIONS, init: init, reduce: reduce, view: view, randomLayout: randomLayout, validateLayout: validateLayout,
    legalActions: legalActions, waitingSeats: waitingSeats, progressKey: progressKey, cellsOf: cellsOf, around: around
  };
})(typeof window !== 'undefined' ? window : globalThis);
