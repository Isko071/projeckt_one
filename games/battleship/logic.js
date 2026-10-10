// Чистая логика «Морского боя» для двух игроков: расстановка флота, стрельба по очереди, победа.
// Форма та же, что у других игр с сервером столов: init / reduce / view, без DOM и без обращения к window.
// Правила: поле 10×10, флот 4 корабля по 1 клетке, 3 по 2, 2 по 3, 1 в 4 клетки; корабли стоят прямо и не касаются друг друга (даже углами).
// Игроки стреляют по очереди; при попадании («ранил» или «убил») ход остаётся, при промахе переходит. Выигрывает тот, кто первым потопил весь флот.
// Когда корабль потоплен, клетки вокруг него сразу отмечаются промахами.
// Расширенный режим (обычного нет): перед боем каждый выбирает ровно 4 заряда оружия — радар (не больше 1), подлодка и бомбардировщик (не больше 2 каждого).
// Каждый заряд один раз за партию. Радар открывает область 3×3 (корабли отмечаются как «обнаружены», пустые клетки как промахи) и передаёт ход.
// Бомбардировщик бомбит 6–7 случайных клеток области 3×3. Подлодка ставится на клетку и пускает две торпеды вверх и вниз по столбцу до первого корабля или края поля.
// Бомбардировщик и подлодка: при попадании ход остаётся, без попаданий переходит.
//
// Клетка поля: индекс y * size + x. Отметки на поле игрока (по нему стреляет соперник): 0 — не стреляли, 1 — промах (пусто), 2 — ранен, 3 — потоплен, 4 — корабль обнаружен радаром (ещё не поражён).
//
//   Battleship.CONFIG, Battleship.PLAYER_ACTIONS
//   Battleship.init(seats, options, rng) → состояние; seats: [{ id, name }] (ровно два); options: { first } — кто ходит первым (иначе случайно по rng)
//   Battleship.reduce(state, action, rng) → { ok, state, events } | { ok: false, error }
//     { type: 'place',   seat, ships: [{ x, y, len, dir: 'h' | 'v' }], arsenal: { radar, sub, bomber } }   расстановка флота и выбор оружия; игрок готов
//     { type: 'unplace', seat }                                            передумал, пока соперник не готов
//     { type: 'shoot',   seat, x, y }                                      выстрел по полю соперника
//     { type: 'radar',   seat, x, y }   радар: центр области 3×3
//     { type: 'bomber',  seat, x, y }   бомбардировщик: центр области 3×3
//     { type: 'sub',     seat, x, y }   подлодка: клетка, откуда торпеды идут вверх и вниз
//     { type: 'concede', seat }                                            сдаться (выйти из игры): побеждает соперник
//   Battleship.view(state, seat) → вид для места seat (свои корабли целиком, чужие не видны; без seat — публичный вид, как у зрителя)
//   Battleship.randomLayout(rng, options) → список кораблей для действия place
//   Battleship.validateArsenal(arsenal) → { ok, arsenal } | { ok: false, error }; Battleship.WEAPONS, Battleship.area3(x, y, size)
//   Battleship.validateLayout(ships, options) → { ok, error?, ships }
//   Battleship.canPlace(placed, ship, options) → { ok } | { ok: false, error } — можно ли добавить корабль к уже поставленным; Battleship.remaining(placed, options) → { длина: сколько осталось }
//   Battleship.waitingSeats(state), Battleship.progressKey(state, seat), Battleship.legalActions(state, seat)
(function (root) {
  var CONFIG = { minSeats: 2, maxSeats: 2, size: 10, fleet: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1], arsenal: { total: 4, max: { radar: 1, sub: 2, bomber: 2 } } };
  var WEAPONS = ['radar', 'sub', 'bomber'];
  var PLAYER_ACTIONS = ['place', 'unplace', 'shoot', 'radar', 'sub', 'bomber', 'concede'];
  var MISS = 1, HIT = 2, SUNK = 3, DETECTED = 4;

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

  // Можно ли добавить корабль ship {x, y, len, dir} к уже поставленным placed (для расстановки по одному): { ok } или { ok: false, error }
  function canPlace(placed, ship, options) {
    var size = sizeOf(options), cells = ship && typeof ship === 'object' ? cellsOf(ship, size) : null;
    if (!cells) return bad('bounds');
    var owner = {};
    (placed || []).forEach(function (p, k) { (cellsOf(p, size) || []).forEach(function (c) { owner[c] = k; }); });
    for (var i = 0; i < cells.length; i++) if (owner[cells[i]] !== undefined) return bad('overlap');
    for (var j = 0; j < cells.length; j++) {
      var nb = around(cells[j], size);
      for (var n = 0; n < nb.length; n++) if (owner[nb[n]] !== undefined) return bad('touch');
    }
    return { ok: true };
  }
  // Сколько кораблей каждой длины ещё осталось расставить: { 4: n, 3: n, 2: n, 1: n }
  function remaining(placed, options) {
    var out = {};
    fleetOf(options).forEach(function (len) { out[len] = (out[len] || 0) + 1; });
    (placed || []).forEach(function (p) { if (out[p.len]) out[p.len]--; });
    return out;
  }

  // Выбор оружия: целые числа, не больше предела по каждому виду, всего ровно CONFIG.arsenal.total
  function validateArsenal(a) {
    if (!a || typeof a !== 'object') return bad('arsenal');
    var out = {}, sum = 0;
    for (var i = 0; i < WEAPONS.length; i++) {
      var k = WEAPONS[i], v = a[k] === undefined ? 0 : Number(a[k]);
      if (!isFinite(v) || Math.floor(v) !== v || v < 0 || v > CONFIG.arsenal.max[k]) return bad('arsenal');
      out[k] = v; sum += v;
    }
    return sum === CONFIG.arsenal.total ? { ok: true, arsenal: out } : bad('arsenal');
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
      return { id: s.id, name: s.name || '', active: true, ready: false, ships: [], arsenal: { radar: 0, sub: 0, bomber: 0 }, marks: emptyBoard(size) };
    });
    while (list.length < 2) list.push({ id: 'seat' + list.length, name: '', active: false, ready: false, ships: [], arsenal: { radar: 0, sub: 0, bomber: 0 }, marks: emptyBoard(size) });
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

  // Попадание по клетке idx поля foe: 'miss' | 'hit' | 'sunk' | 'none' (клетка уже отмечена). Потопленный корабль обводится промахами
  function applyShot(foe, idx, size) {
    var m = foe.marks[idx];
    if (m === MISS || m === HIT || m === SUNK) return 'none';
    var ship = shipAt(foe, idx);
    if (!ship) { foe.marks[idx] = MISS; return 'miss'; }
    ship.hit[ship.cells.indexOf(idx)] = true;
    if (ship.hit.every(Boolean)) {
      ship.cells.forEach(function (c) { foe.marks[c] = SUNK; });
      ship.cells.forEach(function (c) { around(c, size).forEach(function (a) { if (foe.marks[a] === 0) foe.marks[a] = MISS; }); });
      return 'sunk';
    }
    foe.marks[idx] = HIT;
    return 'hit';
  }
  // Клетки области 3×3 вокруг (x, y), только внутри поля
  function area3(x, y, size) {
    var out = [];
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size) out.push(ny * size + nx);
    }
    return out;
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
      var ar = validateArsenal(action.arsenal);
      if (!ar.ok) return ar;
      mine.ships = v.ships; mine.arsenal = ar.arsenal; mine.ready = true;
      events.push({ type: 'ready', seat: seat });
      var both = ns.seats.every(function (s) { return !s.active || s.ready; }) && ns.seats.filter(function (s) { return s.active; }).length === 2;
      if (both) { ns.phase = 'playing'; ns.current = ns.first; events.push({ type: 'start', first: ns.first }); }
      return { ok: true, state: ns, events: events };
    }

    if (action.type === 'unplace') {
      if (state.phase !== 'placing') return bad('wrong-phase');
      if (!mine.ready) return bad('not-ready');
      mine.ready = false; mine.ships = []; mine.arsenal = { radar: 0, sub: 0, bomber: 0 };
      return { ok: true, state: ns, events: [{ type: 'unready', seat: seat }] };
    }

    if (action.type === 'shoot' || WEAPONS.indexOf(action.type) >= 0) {
      if (state.phase !== 'playing') return bad('wrong-phase');
      if (state.current !== seat) return bad('not-your-turn');
      var x = Number(action.x), y = Number(action.y), size = state.size;
      if (!isFinite(x) || !isFinite(y) || Math.floor(x) !== x || Math.floor(y) !== y || x < 0 || y < 0 || x >= size || y >= size) return bad('bounds');
      var foe = ns.seats[otherSeat(seat)], idx = y * size + x, last, hits = 0;
      if (action.type !== 'shoot') {
        if (!(mine.arsenal[action.type] > 0)) return bad('no-weapon');
        mine.arsenal[action.type]--;
      }
      if (action.type === 'shoot') {
        var m0 = foe.marks[idx];
        if (m0 !== 0 && m0 !== DETECTED) return bad('already-shot');
        var res = applyShot(foe, idx, size);
        hits = res === 'miss' ? 0 : 1;
        last = { seat: seat, kind: 'shoot', x: x, y: y, result: res };
        events.push({ type: 'shot', seat: seat, x: x, y: y, result: res });
      } else if (action.type === 'radar') {
        var seen = [], found = 0;
        area3(x, y, size).forEach(function (c) {
          var m = foe.marks[c];
          if (m === 0) {
            if (shipAt(foe, c)) { foe.marks[c] = DETECTED; found++; } else foe.marks[c] = MISS;
            seen.push(c);                                                  // только клетки, где появилась новая отметка
          } else if (m === DETECTED) found++;
        });
        last = { seat: seat, kind: 'radar', x: x, y: y, cells: seen, found: found };
        events.push({ type: 'radar', seat: seat, x: x, y: y, found: found });
      } else if (action.type === 'bomber') {
        var area = area3(x, y, size), count = Math.min(6 + ((rng || Math.random)() < 0.5 ? 0 : 1), area.length), pool = area.slice(), drops = [];
        for (var d = 0; d < count; d++) {
          var j = d + Math.floor((rng || Math.random)() * (pool.length - d)), t = pool[d]; pool[d] = pool[j]; pool[j] = t;
          var r = applyShot(foe, pool[d], size);
          if (r === 'hit' || r === 'sunk') hits++;
          drops.push({ idx: pool[d], result: r });
        }
        last = { seat: seat, kind: 'bomber', x: x, y: y, cells: drops, hits: hits };
        events.push({ type: 'bomb', seat: seat, x: x, y: y, hits: hits });
      } else {                                                         // подлодка: две торпеды по столбцу, вверх (включая выбранную клетку) и вниз
        var torp = [];
        [{ dir: 'up', from: y, step: -1 }, { dir: 'down', from: y + 1, step: 1 }].forEach(function (tp) {
          var path = [], fresh = [], hitIdx = -1, tr2 = null;
          for (var ry = tp.from; ry >= 0 && ry < size; ry += tp.step) {
            var ci = ry * size + x, cm = foe.marks[ci];
            path.push(ci);
            if (cm === MISS || cm === HIT || cm === SUNK) continue;        // знакомая вода и уже подбитые клетки торпеда проходит
            if (!shipAt(foe, ci)) { if (cm === 0) { foe.marks[ci] = MISS; fresh.push(ci); } continue; }
            tr2 = applyShot(foe, ci, size); hitIdx = ci; hits++;
            break;
          }
          torp.push({ dir: tp.dir, path: path, fresh: fresh, hit: hitIdx, result: tr2 });
        });
        last = { seat: seat, kind: 'sub', x: x, y: y, torpedoes: torp, hits: hits };
        events.push({ type: 'sub', seat: seat, x: x, y: y, hits: hits });
      }
      ns.turns++;
      ns.last = last;
      if (action.type === 'radar' || hits === 0) ns.current = otherSeat(seat);
      if (foe.ships.every(function (sh) { return sh.hit.every(Boolean); })) finish(ns, seat, 'fleet', events);
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
          id: s.id, name: s.name, active: s.active, ready: s.ready, marks: s.marks.slice(), arsenal: show ? { radar: s.arsenal.radar, sub: s.arsenal.sub, bomber: s.arsenal.bomber } : null,
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
    if (state.current === seat) {
      var arm = state.seats[seat].arsenal || {};
      out = ['shoot'].concat(WEAPONS.filter(function (w) { return arm[w] > 0; }), out);
    }
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
    CONFIG: CONFIG, PLAYER_ACTIONS: PLAYER_ACTIONS, init: init, reduce: reduce, view: view, randomLayout: randomLayout, validateLayout: validateLayout, validateArsenal: validateArsenal, WEAPONS: WEAPONS, area3: area3, canPlace: canPlace, remaining: remaining,
    legalActions: legalActions, waitingSeats: waitingSeats, progressKey: progressKey, cellsOf: cellsOf, around: around
  };
})(typeof window !== 'undefined' ? window : globalThis);
