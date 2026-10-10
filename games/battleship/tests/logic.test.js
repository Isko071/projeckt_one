// Запуск: node --test games/battleship/tests/logic.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ JSON, Math, Object, Array, Number, String });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8'), ctx);
const B = ctx.Battleship;
const plain = (x) => JSON.parse(JSON.stringify(x));
function seededRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Простая расстановка по строкам: корабли в ряд через одну пустую линию
const FLEET_A = [
  { x: 0, y: 0, len: 4, dir: 'h' }, { x: 0, y: 2, len: 3, dir: 'h' }, { x: 5, y: 2, len: 3, dir: 'h' }, { x: 0, y: 4, len: 2, dir: 'h' },
  { x: 3, y: 4, len: 2, dir: 'h' }, { x: 6, y: 4, len: 2, dir: 'h' }, { x: 0, y: 6, len: 1, dir: 'h' }, { x: 2, y: 6, len: 1, dir: 'h' },
  { x: 4, y: 6, len: 1, dir: 'h' }, { x: 6, y: 6, len: 1, dir: 'h' }
];
const ARS = { radar: 1, sub: 1, bomber: 2 };
const act = (st, a, rng) => { const r = B.reduce(st, a, rng); assert.ok(r.ok, JSON.stringify(a) + ': ' + r.error); return r.state; };
function ready(first) {
  let st = B.init([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Боря' }], { first: first === undefined ? 0 : first });
  st = act(st, { type: 'place', seat: 0, ships: B.randomLayout(seededRng(1)), arsenal: ARS });
  st = act(st, { type: 'place', seat: 1, ships: B.randomLayout(seededRng(2)), arsenal: ARS });
  return st;
}
const cellOf = (st, seat, k) => st.seats[seat].ships[0].cells[k];     // клетка корабля по индексу в списке
const xy = (idx) => ({ x: idx % 10, y: Math.floor(idx / 10) });

test('расстановка: состав флота 4×1, 3×2, 2×3, 1×4 и правильный пример проходит', () => {
  assert.deepEqual(plain(B.CONFIG.fleet), [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]);
  assert.equal(B.validateLayout(FLEET_A).ok, true);
});

test('расстановка: неверный состав, выход за поле, наложение и касание отклоняются', () => {
  assert.equal(B.validateLayout(FLEET_A.slice(1)).error, 'fleet');
  const wrongLen = FLEET_A.map((s, i) => (i === 0 ? Object.assign({}, s, { len: 5 }) : s));
  assert.equal(B.validateLayout(wrongLen).error, 'fleet');
  const out = FLEET_A.map((s, i) => (i === 0 ? Object.assign({}, s, { x: 8 }) : s));
  assert.equal(B.validateLayout(out).error, 'bounds');
  const over = FLEET_A.map((s, i) => (i === 1 ? Object.assign({}, s, { y: 0, x: 2 }) : s));
  assert.equal(B.validateLayout(over).error, 'overlap');
  const touch = FLEET_A.map((s, i) => (i === 1 ? Object.assign({}, s, { y: 1 }) : s));
  assert.equal(B.validateLayout(touch).error, 'touch');
  const corner = FLEET_A.map((s, i) => (i === 6 ? { x: 4, y: 3, len: 1, dir: 'h' } : s));          // касание углом клетки (3..4, 2..4) соседней тройки
  assert.equal(B.validateLayout(corner).ok, false);
  assert.equal(B.validateLayout(null).error, 'fleet');
  assert.equal(B.validateLayout(FLEET_A.map((s, i) => (i === 0 ? Object.assign({}, s, { dir: 'x' }) : s))).error, 'bounds');
});

test('случайная расстановка всегда правильная', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const ships = B.randomLayout(seededRng(seed));
    assert.equal(B.validateLayout(ships).ok, true, 'seed ' + seed);
  }
});

test('игра начинается, когда оба расставили; первый ходит по options.first', () => {
  let st = B.init([{ id: 'a', name: 'А' }, { id: 'b', name: 'Б' }], { first: 1 });
  assert.equal(st.phase, 'placing');
  assert.deepEqual(plain(B.waitingSeats(st)), [0, 1]);
  st = act(st, { type: 'place', seat: 0, ships: B.randomLayout(seededRng(3)), arsenal: ARS });
  assert.equal(st.phase, 'placing');
  assert.deepEqual(plain(B.waitingSeats(st)), [1]);
  st = act(st, { type: 'place', seat: 1, ships: B.randomLayout(seededRng(4)), arsenal: ARS });
  assert.equal(st.phase, 'playing');
  assert.equal(st.current, 1);
  assert.deepEqual(plain(B.waitingSeats(st)), [1]);
});

test('расстановку можно отменить, пока игра не началась; потом нельзя', () => {
  let st = B.init([{ id: 'a' }, { id: 'b' }], { first: 0 });
  st = act(st, { type: 'place', seat: 0, ships: B.randomLayout(seededRng(5)), arsenal: ARS });
  st = act(st, { type: 'unplace', seat: 0 });
  assert.equal(st.seats[0].ready, false);
  assert.equal(B.reduce(st, { type: 'unplace', seat: 0 }).error, 'not-ready');
  st = act(st, { type: 'place', seat: 0, ships: B.randomLayout(seededRng(5)), arsenal: ARS });
  st = act(st, { type: 'place', seat: 1, ships: B.randomLayout(seededRng(6)), arsenal: ARS });
  assert.equal(B.reduce(st, { type: 'unplace', seat: 0 }).error, 'wrong-phase');
  assert.equal(B.reduce(st, { type: 'place', seat: 0, ships: B.randomLayout(seededRng(7)), arsenal: ARS }).error, 'wrong-phase');
});

test('стрельба: до начала нельзя, не в свой ход нельзя, за поле и повторно нельзя', () => {
  const pre = B.init([{ id: 'a' }, { id: 'b' }], { first: 0 });
  assert.equal(B.reduce(pre, { type: 'shoot', seat: 0, x: 0, y: 0 }).error, 'wrong-phase');
  let st = ready(0);
  assert.equal(B.reduce(st, { type: 'shoot', seat: 1, x: 0, y: 0 }).error, 'not-your-turn');
  assert.equal(B.reduce(st, { type: 'shoot', seat: 0, x: 10, y: 0 }).error, 'bounds');
  assert.equal(B.reduce(st, { type: 'shoot', seat: 0, x: -1, y: 0 }).error, 'bounds');
  assert.equal(B.reduce(st, { type: 'shoot', seat: 0, x: 1.5, y: 0 }).error, 'bounds');
  assert.equal(B.reduce(st, { type: 'shoot', seat: 2, x: 0, y: 0 }).error, 'bad-seat');
  // найдём пустую клетку соперника: промах отдаёт ход и повтор запрещён
  const occupied = {}; st.seats[1].ships.forEach((s) => s.cells.forEach((c) => { occupied[c] = true; }));
  const empty = [...Array(100).keys()].find((i) => !occupied[i]);
  const e = xy(empty);
  const r = B.reduce(st, { type: 'shoot', seat: 0, x: e.x, y: e.y });
  assert.equal(r.ok, true);
  assert.equal(r.state.last.result, 'miss');
  assert.equal(r.state.current, 1, 'после промаха ход переходит');
  assert.equal(r.state.seats[1].marks[empty], 1);
  assert.equal(B.reduce(r.state, { type: 'shoot', seat: 0, x: e.x, y: e.y }).error, 'not-your-turn');
  // тот же выстрел на следующем ходу: соперник стреляет мимо, потом снова мы — клетка уже отмечена
  const occ0 = {}; r.state.seats[0].ships.forEach((sh) => sh.cells.forEach((c) => { occ0[c] = true; }));
  const e0 = xy([...Array(100).keys()].find((i) => !occ0[i]));
  const back = act(r.state, Object.assign({ type: 'shoot', seat: 1 }, e0));
  assert.equal(back.current, 0);
  assert.equal(B.reduce(back, { type: 'shoot', seat: 0, x: e.x, y: e.y }).error, 'already-shot');
});

test('попадание оставляет ход, потопление отмечает клетки вокруг промахами', () => {
  let st = ready(0);
  const ship = st.seats[1].ships.find((s) => s.len === 2);
  const [c1, c2] = ship.cells;
  let r = B.reduce(st, Object.assign({ type: 'shoot', seat: 0 }, xy(c1)));
  assert.equal(r.state.last.result, 'hit');
  assert.equal(r.state.current, 0, 'после попадания ход остаётся');
  assert.equal(r.state.seats[1].marks[c1], 2);
  r = B.reduce(r.state, Object.assign({ type: 'shoot', seat: 0 }, xy(c2)));
  assert.equal(r.state.last.result, 'sunk');
  assert.equal(r.state.current, 0);
  assert.equal(r.state.seats[1].marks[c1], 3);
  assert.equal(r.state.seats[1].marks[c2], 3);
  [c1, c2].forEach((c) => B.around(c, 10).forEach((a) => { if (a !== c1 && a !== c2) assert.equal(r.state.seats[1].marks[a], 1, 'вокруг потопленного промахи'); }));
  assert.equal(B.reduce(r.state, Object.assign({ type: 'shoot', seat: 0 }, xy(B.around(c1, 10).find((a) => a !== c2)))).error, 'already-shot');
});

test('победа: потоплен весь флот, дальше действовать нельзя', () => {
  let st = ready(0);
  const cells = [];
  st.seats[1].ships.forEach((s) => s.cells.forEach((c) => cells.push(c)));
  cells.forEach((c, i) => {
    const r = B.reduce(st, Object.assign({ type: 'shoot', seat: 0 }, xy(c)));
    assert.ok(r.ok, 'клетка ' + c);
    st = r.state;
    assert.equal(st.gameOver, i === cells.length - 1);
  });
  assert.equal(st.phase, 'finished');
  assert.equal(st.winner, 0);
  assert.equal(st.reason, 'fleet');
  assert.deepEqual(plain(B.waitingSeats(st)), []);
  assert.equal(B.reduce(st, { type: 'shoot', seat: 0, x: 0, y: 0 }).error, 'game-over');
  assert.deepEqual(plain(B.legalActions(st, 0)), []);
});

test('сдача: побеждает соперник, можно и во время расстановки', () => {
  let st = ready(0);
  st = act(st, { type: 'concede', seat: 0 });
  assert.equal(st.winner, 1); assert.equal(st.reason, 'concede'); assert.equal(st.gameOver, true);
  let pre = B.init([{ id: 'a' }, { id: 'b' }], { first: 0 });
  pre = act(pre, { type: 'concede', seat: 1 });
  assert.equal(pre.winner, 0);
});

test('вид: свои корабли видны, чужие скрыты до конца; публичный вид без кораблей', () => {
  let st = ready(0);
  const v0 = B.view(st, 0), v1 = B.view(st, 1), pub = B.view(st);
  assert.equal(v0.seats[0].ships.length, 10);
  assert.equal(v0.seats[1].ships.length, 0, 'чужие корабли скрыты');
  assert.equal(v1.seats[1].ships.length, 10);
  assert.equal(pub.seats[0].ships.length + pub.seats[1].ships.length, 0);
  assert.equal(JSON.stringify(v0).includes(JSON.stringify(st.seats[1].ships[0].cells)), false, 'координаты чужих кораблей не утекают в вид');
  assert.deepEqual(plain(v0.seats[1].left), { 1: 4, 2: 3, 3: 2, 4: 1 });
  const cells = []; st.seats[1].ships.forEach((s) => s.cells.forEach((c) => cells.push(c)));
  cells.forEach((c) => { st = B.reduce(st, Object.assign({ type: 'shoot', seat: 0 }, xy(c))).state; });
  assert.equal(B.view(st, 1).seats[0].ships.length, 10, 'после конца оба поля открыты');
  assert.equal(B.view(st, 1).seats[1].ships.length, 10);
});

test('до готовности соперника виден только факт готовности, а не расстановка', () => {
  let st = B.init([{ id: 'a' }, { id: 'b' }], { first: 0 });
  st = act(st, { type: 'place', seat: 0, ships: B.randomLayout(seededRng(8)), arsenal: ARS });
  const v = B.view(st, 1);
  assert.equal(v.seats[0].ready, true);
  assert.equal(v.seats[0].ships.length, 0);
});

test('случайные партии доигрываются: ход чередуется по правилам, отметки сходятся', () => {
  for (let g = 1; g <= 60; g++) {
    const rng = seededRng(g * 7);
    let st = B.init([{ id: 'a' }, { id: 'b' }], {}, rng);
    st = act(st, { type: 'place', seat: 0, ships: B.randomLayout(rng), arsenal: ARS });
    st = act(st, { type: 'place', seat: 1, ships: B.randomLayout(rng), arsenal: ARS });
    for (let step = 0; step < 400 && !st.gameOver; step++) {
      const seat = st.current, foe = st.seats[1 - seat], free = [];
      foe.marks.forEach((m, i) => { if (m === 0) free.push(i); });
      const pick = free[Math.floor(rng() * free.length)], before = st.seats[1 - seat].marks.filter((m) => m !== 0).length;
      const r = B.reduce(st, Object.assign({ type: 'shoot', seat }, xy(pick)), rng);
      assert.ok(r.ok);
      st = r.state;
      assert.ok(st.seats[1 - seat].marks.filter((m) => m !== 0).length > before);
      if (r.events[0].result === 'miss' && !st.gameOver) assert.equal(st.current, 1 - seat);
      else if (!st.gameOver) assert.equal(st.current, seat);
    }
    assert.equal(st.gameOver, true, 'партия ' + g + ' закончилась');
    assert.ok(st.winner === 0 || st.winner === 1);
    const loser = st.seats[1 - st.winner];
    assert.ok(loser.ships.every((s) => s.hit.every(Boolean)), 'у проигравшего потоплено всё');
  }
});

test('progressKey меняется с ходом, legalActions по фазам', () => {
  let st = B.init([{ id: 'a' }, { id: 'b' }], { first: 0 });
  assert.deepEqual(plain(B.legalActions(st, 0)), ['place', 'concede']);
  const k0 = B.progressKey(st, 0);
  st = act(st, { type: 'place', seat: 0, ships: B.randomLayout(seededRng(9)), arsenal: ARS });
  assert.notEqual(B.progressKey(st, 0), k0);
  assert.deepEqual(plain(B.legalActions(st, 0)), ['unplace', 'concede']);
  st = act(st, { type: 'place', seat: 1, ships: B.randomLayout(seededRng(10)), arsenal: ARS });
  assert.deepEqual(plain(B.legalActions(st, 0)), ['shoot', 'radar', 'sub', 'bomber', 'concede']);
  assert.deepEqual(plain(B.legalActions(st, 1)), ['concede']);
});

test('первый ход без options.first выбирается по rng и повторяем', () => {
  const a = B.init([{ id: 'a' }, { id: 'b' }], {}, seededRng(11)), b = B.init([{ id: 'a' }, { id: 'b' }], {}, seededRng(11));
  assert.equal(a.first, b.first);
  const firsts = new Set();
  for (let i = 1; i < 40; i++) firsts.add(B.init([{ id: 'a' }, { id: 'b' }], {}, seededRng(i)).first);
  assert.equal(firsts.size, 2);
});

test('расстановка по одному: canPlace и remaining', () => {
  const placed = [{ x: 0, y: 0, len: 4, dir: 'h' }];
  assert.equal(B.canPlace(placed, { x: 0, y: 2, len: 3, dir: 'h' }).ok, true);
  assert.equal(B.canPlace(placed, { x: 0, y: 1, len: 3, dir: 'h' }).error, 'touch');
  assert.equal(B.canPlace(placed, { x: 4, y: 1, len: 2, dir: 'v' }).error, 'touch', 'угол');
  assert.equal(B.canPlace(placed, { x: 2, y: 0, len: 2, dir: 'v' }).error, 'overlap');
  assert.equal(B.canPlace(placed, { x: 9, y: 9, len: 2, dir: 'h' }).error, 'bounds');
  assert.equal(B.canPlace([], { x: 0, y: 0, len: 4, dir: 'h' }).ok, true);
  assert.deepEqual(plain(B.remaining(placed)), { 1: 4, 2: 3, 3: 2, 4: 0 });
  assert.deepEqual(plain(B.remaining([])), { 1: 4, 2: 3, 3: 2, 4: 1 });
});

// ===== Расширенный режим: оружие =====
const xy2 = (x, y) => y * 10 + x;
function withFleetA(first) {             // у места 1 известная расстановка FLEET_A, у места 0 случайная
  let st = B.init([{ id: 'a' }, { id: 'b' }], { first: first === undefined ? 0 : first });
  st = act(st, { type: 'place', seat: 0, ships: B.randomLayout(seededRng(31)), arsenal: ARS });
  st = act(st, { type: 'place', seat: 1, ships: FLEET_A, arsenal: { radar: 1, sub: 2, bomber: 1 } });
  return st;
}

test('выбор оружия: ровно 4 заряда, радар не больше 1, остальные не больше 2', () => {
  assert.equal(B.validateArsenal({ radar: 1, sub: 1, bomber: 2 }).ok, true);
  assert.equal(B.validateArsenal({ radar: 0, sub: 2, bomber: 2 }).ok, true);
  assert.equal(B.validateArsenal({ radar: 1, sub: 2, bomber: 1 }).ok, true);
  [{ radar: 2, sub: 1, bomber: 1 }, { radar: 1, sub: 1, bomber: 1 }, { radar: 1, sub: 3, bomber: 0 }, { radar: 0, sub: 0, bomber: 0 }, { radar: 1, sub: 1, bomber: 1.5 }, { radar: -1, sub: 3, bomber: 2 }, null, 'x'].forEach((a) => assert.equal(B.validateArsenal(a).error, 'arsenal', JSON.stringify(a)));
  const st = B.init([{ id: 'a' }, { id: 'b' }], { first: 0 });
  assert.equal(B.reduce(st, { type: 'place', seat: 0, ships: B.randomLayout(seededRng(1)) }).error, 'arsenal', 'без выбора оружия нельзя');
  assert.equal(B.reduce(st, { type: 'place', seat: 0, ships: B.randomLayout(seededRng(1)), arsenal: { radar: 2, sub: 1, bomber: 1 } }).error, 'arsenal');
});

test('оружие нельзя до начала боя, не в свой ход и сверх выбранного', () => {
  const pre = B.init([{ id: 'a' }, { id: 'b' }], { first: 0 });
  assert.equal(B.reduce(pre, { type: 'radar', seat: 0, x: 5, y: 5 }).error, 'wrong-phase');
  let st = withFleetA(0);
  assert.equal(B.reduce(st, { type: 'radar', seat: 1, x: 5, y: 5 }).error, 'not-your-turn');
  assert.equal(B.reduce(st, { type: 'bomber', seat: 0, x: 10, y: 5 }).error, 'bounds');
  st = act(st, { type: 'radar', seat: 0, x: 8, y: 8 });
  assert.equal(st.current, 1, 'радар передаёт ход');
  st = act(st, { type: 'shoot', seat: 1, x: 9, y: 9 }, seededRng(1));
  assert.equal(st.current === 0 || st.current === 1, true);
  const s2 = Object.assign(plain(st), { current: 0 });
  assert.equal(B.reduce(s2, { type: 'radar', seat: 0, x: 1, y: 1 }).error, 'no-weapon', 'радар был один');
});

test('радар: корабли в области 3×3 отмечаются «обнаружен», пустые клетки промахом; ход передаётся; по обнаруженной клетке можно стрелять', () => {
  let st = withFleetA(0);
  st = act(st, { type: 'radar', seat: 0, x: 1, y: 1 });             // область x0..2, y0..2: корабль (0..3,0) и тройка (0..2,2)
  const m = st.seats[1].marks;
  [xy2(0, 0), xy2(1, 0), xy2(2, 0), xy2(0, 2), xy2(1, 2), xy2(2, 2)].forEach((c) => assert.equal(m[c], 4, 'корабль в клетке ' + c));
  [xy2(0, 1), xy2(1, 1), xy2(2, 1)].forEach((c) => assert.equal(m[c], 1, 'пусто в клетке ' + c));
  assert.equal(m[xy2(3, 0)], 0, 'вне области без изменений');
  assert.equal(st.last.kind, 'radar'); assert.equal(st.last.found, 6); assert.equal(st.last.cells.length, 9, 'все клетки области получили новые отметки');
  assert.equal(st.current, 1);
  assert.equal(st.seats[0].arsenal.radar, 0);
  const back = Object.assign(plain(st), { current: 0 });
  const r = B.reduce(back, { type: 'shoot', seat: 0, x: 0, y: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.state.last.result, 'hit', 'по обнаруженной клетке выстрел попадает');
  assert.equal(r.state.current, 0);
  assert.equal(B.reduce(back, { type: 'shoot', seat: 0, x: 0, y: 1 }).error, 'already-shot', 'по пустой клетке из радара стрелять незачем');
});

test('радар у края поля берёт только клетки внутри поля', () => {
  let st = withFleetA(0);
  st = act(st, { type: 'radar', seat: 0, x: 0, y: 0 });
  assert.equal(st.last.cells.length, 4);
});

test('бомбардировщик: 6–7 случайных клеток области 3×3; попадание оставляет ход, пустая бомбёжка передаёт', () => {
  const counts = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    let st = withFleetA(0);
    st = act(st, { type: 'bomber', seat: 0, x: 5, y: 3 }, seededRng(seed));        // область x4..6, y2..4: корабли (5..6,2) и (6..7,4) и др.
    counts.add(st.last.cells.length);
    assert.ok(st.last.cells.length === 6 || st.last.cells.length === 7);
    const area = new Set(B.area3(5, 3, 10));
    st.last.cells.forEach((c) => assert.ok(area.has(c.idx)));
    assert.equal(new Set(st.last.cells.map((c) => c.idx)).size, st.last.cells.length, 'клетки не повторяются');
    assert.equal(st.last.hits, st.last.cells.filter((c) => c.result === 'hit' || c.result === 'sunk').length);
    assert.equal(st.current, st.last.hits > 0 ? 0 : 1);
  }
  assert.deepEqual([...counts].sort(), [6, 7], 'бывает и 6 и 7 клеток');
  let st = withFleetA(0);
  st = act(st, { type: 'bomber', seat: 0, x: 8, y: 8 }, seededRng(5));              // пустой угол
  assert.equal(st.last.hits, 0); assert.equal(st.current, 1);
  let corner = withFleetA(0);
  corner = act(corner, { type: 'bomber', seat: 0, x: 9, y: 9 }, seededRng(5));
  assert.equal(corner.last.cells.length, 4, 'в углу всего 4 клетки');
});

test('подлодка: две торпеды по столбцу вверх и вниз до первого корабля, вода отмечается, ход остаётся при попадании', () => {
  let st = withFleetA(0);
  st = act(st, { type: 'sub', seat: 0, x: 0, y: 3 });
  const up = st.last.torpedoes[0], down = st.last.torpedoes[1];
  assert.equal(up.dir, 'up'); assert.equal(down.dir, 'down');
  assert.deepEqual(plain(up.path), [xy2(0, 3), xy2(0, 2)]); assert.equal(up.hit, xy2(0, 2)); assert.equal(up.result, 'hit');
  assert.deepEqual(plain(down.path), [xy2(0, 4)]); assert.equal(down.hit, xy2(0, 4)); assert.equal(down.result, 'hit');
  assert.equal(st.seats[1].marks[xy2(0, 3)], 1, 'проплытая вода отмечена');
  assert.equal(st.seats[1].marks[xy2(0, 2)], 2); assert.equal(st.seats[1].marks[xy2(0, 4)], 2);
  assert.equal(st.last.hits, 2); assert.equal(st.current, 0);
  assert.equal(st.seats[0].arsenal.sub, 0);
});

test('подлодка: пустой столбец до краёв — торпеды уходят за край, ход передаётся; уже подбитые клетки торпеда проходит', () => {
  let st = withFleetA(0);
  st = act(st, { type: 'sub', seat: 0, x: 9, y: 5 });
  assert.equal(st.last.torpedoes[0].path.length, 6); assert.equal(st.last.torpedoes[0].hit, -1);
  assert.equal(st.last.torpedoes[1].path.length, 4); assert.equal(st.last.torpedoes[1].hit, -1);
  assert.equal(st.last.hits, 0); assert.equal(st.current, 1);
  // повторный пуск по столбцу с ранее подбитой клеткой: торпеда проходит её и бьёт следующий корабль
  let s2 = withFleetA(0);
  s2 = act(s2, { type: 'shoot', seat: 0, x: 0, y: 6 });                     // однопалубный (0,6) потоплен
  s2 = act(s2, { type: 'shoot', seat: 0, x: 0, y: 4 });                     // ранен двухпалубный (0..1,4)
  s2 = act(s2, { type: 'sub', seat: 0, x: 0, y: 8 });                       // вверх по столбцу 0 от y=8
  const t = s2.last.torpedoes[0];
  assert.equal(t.hit, xy2(0, 2) === t.hit ? t.hit : t.hit);
  assert.ok(t.path.indexOf(xy2(0, 6)) >= 0 && t.path.indexOf(xy2(0, 4)) >= 0, 'прошла и потопленную, и подбитую клетки');
  assert.equal(t.hit, xy2(0, 2), 'следующий живой корабль — тройка');
});

test('оружие и победа: последний корабль, потопленный подлодкой, заканчивает партию', () => {
  let st = withFleetA(0);
  // топим всё, кроме одиночного (6,6), обычными выстрелами
  FLEET_A.forEach((ship) => {
    if (ship.x === 6 && ship.y === 6) return;
    for (let k = 0; k < ship.len; k++) st = act(st, { type: 'shoot', seat: 0, x: ship.x + k, y: ship.y });
  });
  assert.equal(st.gameOver, false);
  st = act(st, { type: 'sub', seat: 0, x: 6, y: 9 });
  assert.equal(st.gameOver, true); assert.equal(st.winner, 0); assert.equal(st.reason, 'fleet');
});

test('вид: свой запас оружия виден, чужой скрыт до конца; метки радара видны обоим', () => {
  let st = withFleetA(0);
  const v0 = B.view(st, 0), v1 = B.view(st, 1);
  assert.deepEqual(plain(v0.seats[0].arsenal), plain(ARS));
  assert.equal(v0.seats[1].arsenal, null);
  assert.equal(v1.seats[0].arsenal, null);
  assert.deepEqual(plain(v1.seats[1].arsenal), { radar: 1, sub: 2, bomber: 1 });
  assert.equal(JSON.stringify(B.view(st)).includes('"arsenal":{'), false, 'публичный вид без оружия');
  st = act(st, { type: 'radar', seat: 0, x: 1, y: 1 });
  assert.equal(B.view(st, 1).seats[1].marks[xy2(0, 0)], 4);
  assert.equal(B.view(st, 0).seats[0].arsenal.radar, 0);
});

test('legalActions: оружие доступно, пока есть заряды и ход ваш', () => {
  let st = withFleetA(0);
  assert.deepEqual(plain(B.legalActions(st, 0)), ['shoot', 'radar', 'sub', 'bomber', 'concede']);
  st = act(st, { type: 'radar', seat: 0, x: 8, y: 8 });
  assert.deepEqual(plain(B.legalActions(st, 1)), ['shoot', 'radar', 'sub', 'bomber', 'concede']);
  assert.deepEqual(plain(B.legalActions(st, 0)), ['concede']);
  const mid = Object.assign(plain(st), { current: 0 });
  assert.deepEqual(plain(B.legalActions(mid, 0)), ['shoot', 'sub', 'bomber', 'concede'], 'радар израсходован');
});

test('случайные партии с оружием доигрываются, отметки согласованы', () => {
  for (let g = 1; g <= 80; g++) {
    const rng = seededRng(g * 13);
    let st = B.init([{ id: 'a' }, { id: 'b' }], {}, rng);
    const arsenals = [{ radar: 1, sub: 2, bomber: 1 }, { radar: 0, sub: 2, bomber: 2 }];
    st = act(st, { type: 'place', seat: 0, ships: B.randomLayout(rng), arsenal: arsenals[g % 2] }, rng);
    st = act(st, { type: 'place', seat: 1, ships: B.randomLayout(rng), arsenal: arsenals[(g + 1) % 2] }, rng);
    for (let step = 0; step < 600 && !st.gameOver; step++) {
      const seat = st.current, la = B.legalActions(st, seat), free = [];
      st.seats[1 - seat].marks.forEach((m, i) => { if (m === 0 || m === 4) free.push(i); });
      const pick = free[Math.floor(rng() * free.length)], x = pick % 10, y = Math.floor(pick / 10);
      const kind = la.filter((a) => a !== 'concede')[Math.floor(rng() * (la.length - 1))];
      let r = B.reduce(st, { type: kind, seat, x, y }, rng);
      assert.ok(r.ok, kind + ': ' + r.error);
      st = r.state;
      st.seats.forEach((s) => s.marks.forEach((m, i) => { if (m === 3) assert.ok(s.ships.some((sh) => sh.cells.includes(i) && sh.hit.every(Boolean))); if (m === 2) assert.ok(s.ships.some((sh) => sh.cells.includes(i) && sh.hit[sh.cells.indexOf(i)])); if (m === 4) assert.ok(s.ships.some((sh) => sh.cells.includes(i))); }));
    }
    assert.equal(st.gameOver, true, 'партия ' + g + ' закончилась');
    assert.ok(st.seats[1 - st.winner].ships.every((s) => s.hit.every(Boolean)));
  }
});

test('радар повторно по той же области: новых отметок нет, найдено считает уже обнаруженные', () => {
  let st = withFleetA(0);
  st = act(st, { type: 'radar', seat: 0, x: 1, y: 1 });
  const again = Object.assign(plain(st), { current: 0 });
  again.seats[0].arsenal.radar = 1;
  const r = B.reduce(again, { type: 'radar', seat: 0, x: 1, y: 1 });
  assert.equal(r.state.last.cells.length, 0);
  assert.equal(r.state.last.found, 6);
});

test('подлодка запоминает в fresh только новые клетки воды', () => {
  let st = withFleetA(0);
  st = act(st, { type: 'sub', seat: 0, x: 9, y: 5 });
  assert.equal(st.last.torpedoes[0].fresh.length, 6);
  const second = Object.assign(plain(st), { current: 0 });
  second.seats[0].arsenal.sub = 1;
  const r = B.reduce(second, { type: 'sub', seat: 0, x: 9, y: 2 });
  assert.equal(r.state.last.torpedoes[0].fresh.length, 0, 'вода уже отмечена');
  assert.equal(r.state.last.torpedoes[0].path.length, 3);
});
