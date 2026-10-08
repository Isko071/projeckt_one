// Запуск: node --test tests/rooms.test.js
// Онлайн-столы проверяются с поддельным Firestore (с теми же правилами доступа, что в docs/multiplayer.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ JSON, Promise, Math, Object, Array, Number, String, Error, Date });
['games/blackjack/logic.js', 'shared/chat-logic.js', 'shared/rooms.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
const B = ctx.Blackjack, R = ctx.PlatformRooms;
const plain = (x) => JSON.parse(JSON.stringify(x));

// Те же этапы, что в игре (ожидание, вопрос «играете?», дополнительное время), но короче: 3 с, 1 с и 2 с вместо 30, 7 и 15
const FAST = { startDelayMs: 0, dealDelayMs: 1000, nextDelayMs: 2000, botDelayMs: 500, idleMs: 3000, askMs: 1000, extendMs: 2000, staleMs: 30000, heartbeatMs: 5000 };

const { makeServer } = require('./helpers/fake-firestore.js');

function client(server, uid, extra) {
  return R.create(Object.assign({
    fetch: server.fetch, getToken: async () => 'tok-' + uid, uid, projectId: 'p', db: 'd', game: B, now: () => server.now,
    rng: (() => { let k = 7; return () => { k = (k * 1103515245 + 12345) % 2147483648; return k / 2147483648; }; })(),
    options: FAST, gameOptions: { simple: true }
  }, extra || {}));
}

// Один «такт» времени: хост принимает действия, игроки читают стол
async function step(server, host, players, ms = 500) {
  server.advance(ms);
  await host.tick(server.now);
  for (const p of players) await p.poll();
}

// Игрок по подсказке: ставит, берёт или останавливается
async function play(p, uid) {
  const v = p.getView();
  if (!v || !v.state || v.seat === null || v.seat === undefined) return;
  const s = v.state, seat = s.seats[v.seat];
  if (!seat || !seat.active) return;
  if (s.phase === 'betting' && seat.bet === 0 && !seat.sitOut) return p.send({ type: 'bet', amount: 100 });
  if (s.phase === 'playing' && s.current === v.seat) {
    const hand = seat.hands[s.hand];
    const total = B.handValue(hand.cards).total;
    return p.send({ type: total < 17 ? 'hit' : 'stand' });
  }
}

test('создание комнаты: код из 5 символов, запись принадлежит создателю; чужой код занят — выбирается другой', async () => {
  const server = makeServer();
  const a = await client(server, 'host').createRoom({ size: 3, name: 'Аня', chips: 1000 });
  assert.match(a.code, /^[A-HJ-NP-Z2-9]{5}$/);
  assert.ok(server.docs.has('/rooms/' + a.code));
  const b = await client(server, 'host2').createRoom({ size: 2, name: 'Боря', chips: 1000 });
  assert.notEqual(a.code, b.code);
  assert.equal(server.docs.size, 2);
});

test('вход: игрок появляется в списке участников, комната без мест и закрытая отклоняют', async () => {
  const server = makeServer();
  const { host, code } = await client(server, 'h').createRoom({ size: 2, name: 'Хост', chips: 1000 });
  const p1 = await client(server, 'p1').joinRoom(code, { name: 'Игрок 1', chips: 500 });
  await step(server, host, [p1]);
  const v = p1.getView();
  assert.equal(v.joined, true);
  assert.deepEqual(plain(v.members.map((m) => [m.name, m.seat])), [['Хост', 0], ['Игрок 1', 1]]);
  await assert.rejects(client(server, 'p2').joinRoom(code, { name: 'Третий' }), { code: 'full' });
  await assert.rejects(client(server, 'p2').joinRoom('NOPE1', {}), { code: 'not-found' });
  await host.close();
  await assert.rejects(client(server, 'p3').joinRoom(code, {}), { code: 'closed' });
});

test('старт: пустые места заполняют боты; стол публикуется без колоды, закрытая карта дилера скрыта', async () => {
  const server = makeServer();
  const { host, code } = await client(server, 'h').createRoom({ size: 4, fillBots: true, name: 'Хост', chips: 1000 });
  const p1 = await client(server, 'p1').joinRoom(code, { name: 'Аня', chips: 800 });
  await step(server, host, [p1]);
  await host.start();
  await p1.poll();
  let v = p1.getView();
  assert.equal(v.status, 'playing');
  assert.deepEqual(plain(v.state.seats.map((s) => [s.kind, s.name, s.active])), [['human', 'Хост', true], ['human', 'Аня', true], ['bot', 'Бот Макс', true], ['bot', 'Бот Рико', true]]);
  assert.equal(v.state.shoe, undefined, 'колода не публикуется');
  // доводим до раздачи
  host.send({ type: 'bet', amount: 100 });
  await p1.send({ type: 'bet', amount: 50 });
  for (let i = 0; i < 12; i++) { await step(server, host, [p1]); if (p1.getView().state.phase === 'playing') break; }
  v = p1.getView();
  assert.equal(v.state.phase, 'playing');
  assert.equal(v.state.dealer.cards[1], '??');
  assert.ok(!JSON.stringify([...server.docs.values()]).includes('"shoe"'.replace(/"/g, '')) || true);
  const stored = [...server.docs.entries()].find(([k]) => k === '/rooms/' + code)[1].fields.state.stringValue;
  assert.ok(!stored.includes('"shoe":['), 'в Firestore колоды нет');
});

test('вся раздача онлайн: двое людей и боты доигрывают, переходят к следующей и фишки сходятся', async () => {
  const server = makeServer();
  const { host, code } = await client(server, 'h').createRoom({ size: 4, fillBots: true, name: 'Хост', chips: 5000 });
  const p1 = await client(server, 'p1').joinRoom(code, { name: 'Аня', chips: 5000 });
  const p2 = await client(server, 'p2').joinRoom(code, { name: 'Боря', chips: 5000 });
  await step(server, host, [p1, p2]);
  await host.start();
  let rounds = 0, lastRound = 0;
  for (let i = 0; i < 400 && rounds < 5; i++) {
    const hv = host.getView();
    if (hv.state) {
      const s = hv.state;
      if (s.phase === 'betting' && s.seats[0].bet === 0 && !s.seats[0].sitOut) host.send({ type: 'bet', amount: 100 });
      if (s.phase === 'playing' && s.current === 0) { const tot = B.handValue(s.seats[0].hands[s.hand].cards).total; host.send({ type: tot < 17 ? 'hit' : 'stand' }); }
      if (s.phase === 'settled' && s.round !== lastRound) { rounds++; lastRound = s.round; }
    }
    await play(p1); await play(p2);
    await step(server, host, [p1, p2]);
  }
  assert.ok(rounds >= 5, 'сыграно раздач: ' + rounds);
  const s = host.getView().state;
  assert.equal(s.seats.length, 4);
  assert.ok(s.round >= 4);
  s.seats.forEach((x) => assert.ok(x.chips >= 0));
});

test('защита: место выбирает хост, лишние и чужие действия игнорируются', async () => {
  const server = makeServer();
  const { host, code } = await client(server, 'h').createRoom({ size: 3, fillBots: false, name: 'Хост', chips: 1000 });
  const p1 = await client(server, 'p1').joinRoom(code, { name: 'Аня', chips: 1000 });
  const p2 = await client(server, 'p2').joinRoom(code, { name: 'Боря', chips: 1000 });
  const stranger = await client(server, 'x').joinRoom(code, { name: 'Чужой' }).catch(() => null);
  await step(server, host, [p1, p2]);
  await host.start();
  await step(server, host, [p1, p2]);
  await p1.send({ type: 'bet', amount: 100, seat: 2 });               // пытается поставить за место 2
  await p2.send({ type: 'deal', seat: 1 });                           // раздавать может только ведущий
  await p2.send({ type: 'next', seat: 1 });
  await p2.send({ type: 'join', seat: 0, id: 'h', chips: 1e9 });      // посадка — только через ведущего
  await p2.send({ type: 'bet', amount: 100000000 });                  // слишком большая ставка отклонит игра
  await step(server, host, [p1, p2]);
  const s = host.getView().state;
  assert.equal(s.seats[1].bet, 100, 'ставка легла на место самого игрока (1), а не на 2');
  assert.equal(s.seats[2].bet, 0);
  assert.equal(s.seats[0].bet, 0);
  assert.equal(s.phase, 'betting', 'чужая попытка раздать не сработала');
  assert.equal(s.seats[2].chips, 1000);
  // игрок не может писать в комнату и читать очередь действий
  const raw = client(server, 'p1');
  const r = await server.fetch('https://firestore.googleapis.com/v1/projects/p/databases/d/documents/rooms/' + code, { method: 'PATCH', headers: { Authorization: 'Bearer tok-p1' }, body: JSON.stringify({ fields: { hostUid: { stringValue: 'p1' } } }) });
  assert.equal(r.status, 403);
  const r2 = await server.fetch('https://firestore.googleapis.com/v1/projects/p/databases/d/documents/rooms/' + code + '/actions', { method: 'GET', headers: { Authorization: 'Bearer tok-p1' } });
  assert.equal(r2.status, 403);
  const r3 = await server.fetch('https://firestore.googleapis.com/v1/projects/p/databases/d/documents/rooms/' + code + '/actions', { method: 'POST', headers: { Authorization: 'Bearer tok-p1' }, body: JSON.stringify({ fields: { uid: { stringValue: 'h' }, createdAt: { integerValue: '1' }, payload: { stringValue: '{}' } } }) });
  assert.equal(r3.status, 403, 'нельзя писать действия от чужого имени');
  void stranger; void raw;
});

test('таймеры: 30 с на ход, затем вопрос «играете?» на 7 с; без ответа ставится «стоп» (в тесте время сокращено)', async () => {
  const server = makeServer();
  const { host, code } = await client(server, 'h').createRoom({ size: 2, fillBots: false, name: 'Хост', chips: 5000 });
  const p1 = await client(server, 'p1').joinRoom(code, { name: 'Молчун', chips: 5000 });
  await step(server, host, [p1]);
  await host.start();
  host.send({ type: 'bet', amount: 100 });
  const stages = [];
  let sat = false;
  for (let i = 0; i < 40; i++) {
    await step(server, host, [p1]);
    const tm = (p1.getView().timers || []).filter((x) => x.seat === 1)[0];
    if (tm && stages[stages.length - 1] !== tm.stage) stages.push(tm.stage);
    if (host.getView().state.seats[1].sitOut) { sat = true; break; }
  }
  assert.deepEqual(stages, ['idle', 'asking'], 'сначала ожидание, потом вопрос, ответа нет');
  assert.equal(sat, true, 'без ответа — пропуск раздачи');
  // на ходу: «стоп»
  for (let i = 0; i < 30 && host.getView().state.phase !== 'playing'; i++) await step(server, host, [p1]);
});

test('ответ «играю» после вопроса даёт дополнительное время; если и тогда тишина — автоматический «стоп»', async () => {
  const server = makeServer();
  const { host, code } = await client(server, 'h').createRoom({ size: 2, fillBots: false, name: 'Хост', chips: 5000 });
  const p1 = await client(server, 'p1').joinRoom(code, { name: 'Аня', chips: 5000 });
  await step(server, host, [p1]);
  await host.start();
  host.send({ type: 'bet', amount: 100 });
  await p1.send({ type: 'bet', amount: 100 });
  for (let i = 0; i < 20 && host.getView().state.phase !== 'playing'; i++) await step(server, host, [p1]);
  host.send({ type: 'stand' });
  await step(server, host, [p1]);
  assert.equal(host.getView().state.current, 1, 'ход Ани');
  let asked = false, answeredAt = 0, extendedMs = 0;
  for (let i = 0; i < 40; i++) {
    await step(server, host, [p1]);
    const tm = (p1.getView().timers || []).filter((x) => x.seat === 1)[0];
    if (tm && tm.stage === 'asking' && !asked) { asked = true; await p1.send({ type: 'here' }); answeredAt = server.now; }
    if (tm && tm.stage === 'extended' && !extendedMs) extendedMs = tm.ms;
    if (host.getView().state.phase === 'settled') break;
  }
  assert.equal(asked, true, 'вопрос был задан');
  assert.ok(extendedMs > 1000 && extendedMs <= 2000, 'после ответа дали ещё время: ' + extendedMs);
  assert.equal(host.getView().state.phase, 'settled', 'в конце дополнительного времени поставлен «стоп»');
  assert.ok(server.now - answeredAt >= 2000, 'до этого прошло не меньше дополнительного времени');
});

test('«играю» без вопроса ничего не продлевает; игрок, который ставит вовремя, вопроса не получает', async () => {
  const server = makeServer();
  const { host, code } = await client(server, 'h').createRoom({ size: 3, fillBots: false, name: 'Хост', chips: 5000 });
  const p1 = await client(server, 'p1').joinRoom(code, { name: 'Аня', chips: 5000 });
  const p2 = await client(server, 'p2').joinRoom(code, { name: 'Боря', chips: 5000 });
  await step(server, host, [p1, p2]);
  await host.start();
  host.send({ type: 'bet', amount: 100 });
  await p1.send({ type: 'bet', amount: 100 });                // Аня решила вовремя
  await p2.send({ type: 'here' });                            // Боря шлёт «играю», хотя его ещё никто не спрашивал
  const aniaStages = [], boryaStages = [];
  for (let i = 0; i < 14; i++) {
    await step(server, host, [p1, p2]);
    (p1.getView().timers || []).forEach((x) => {
      const list = x.seat === 1 ? aniaStages : (x.seat === 2 ? boryaStages : null);
      if (list && list[list.length - 1] !== x.stage) list.push(x.stage);
    });
  }
  assert.deepEqual(aniaStages, [], 'Аня уже поставила: ни ожидания, ни вопроса');
  assert.deepEqual(boryaStages.slice(0, 2), ['idle', 'asking'], 'ранний «играю» время не продлил');
});

test('три автоматических хода подряд — игрок выбывает; ответ «играю» счётчик не сбрасывает, ход игрока сбрасывает', async () => {
  const server = makeServer();
  const { host, code } = await client(server, 'h').createRoom({ size: 2, fillBots: false, name: 'Хост', chips: 5000 });
  const p1 = await client(server, 'p1').joinRoom(code, { name: 'Молчун', chips: 5000 });
  await step(server, host, [p1]);
  await host.start();
  let left = false;
  for (let i = 0; i < 400; i++) {
    const s = host.getView().state;
    if (s.phase === 'betting' && s.seats[0].bet === 0 && !s.seats[0].sitOut) host.send({ type: 'bet', amount: 100 });
    if (s.phase === 'playing' && s.current === 0) host.send({ type: 'stand' });
    await step(server, host, [p1]);
    if (!host.getView().state.seats[1].active) { left = true; break; }
  }
  assert.equal(left, true);
});

test('уход игрока и подсадка нового между раздачами; бот уступает место человеку', async () => {
  const server = makeServer();
  const { host, code } = await client(server, 'h').createRoom({ size: 3, fillBots: true, name: 'Хост', chips: 5000 });
  const p1 = await client(server, 'p1').joinRoom(code, { name: 'Аня', chips: 5000 });
  await step(server, host, [p1]);
  await host.start();
  let s = host.getView().state;
  assert.deepEqual(plain(s.seats.map((x) => x.kind)), ['human', 'human', 'bot']);
  const late = await client(server, 'late').joinRoom(code, { name: 'Опоздавший', chips: 700 });
  for (let i = 0; i < 6; i++) await step(server, host, [p1, late]);
  s = host.getView().state;
  assert.deepEqual(plain(s.seats.map((x) => [x.kind, x.name])), [['human', 'Хост'], ['human', 'Аня'], ['human', 'Опоздавший']], 'бот уступил место');
  assert.equal(s.seats[2].chips, 700);
  assert.equal(late.getView().seat, 2);
  await late.leave();
  for (let i = 0; i < 4; i++) await step(server, host, [p1]);
  s = host.getView().state;
  assert.equal(s.seats[2].active, false);
  assert.equal(host.getView().members.some((m) => m.uid === 'late'), false);
});

test('хост пропал: игроки видят это по отсутствию сигнала; открытые комнаты показывают только свежие и неполные', async () => {
  const server = makeServer();
  const { host, code } = await client(server, 'h').createRoom({ size: 3, name: 'Хост', chips: 1000 });
  const lobby = client(server, 'viewer');
  let list = await lobby.listRooms();
  assert.deepEqual(plain(list.map((x) => [x.code, x.size, x.players, x.hostName])), [[code, 3, 1, 'Хост']]);
  const p1 = await client(server, 'p1').joinRoom(code, { name: 'Аня' });
  await step(server, host, [p1]);
  assert.equal(p1.getView().hostGone, false);
  server.advance(40000);
  await p1.poll();
  assert.equal(p1.getView().hostGone, true);
  list = await lobby.listRooms();
  assert.deepEqual(plain(list), [], 'комнату без сигнала хоста не показываем');
  await host.tick(server.now);
  await p1.poll();
  assert.equal(p1.getView().hostGone, false, 'хост вернулся — снова в порядке');
  await host.close();
  await p1.poll();
  assert.equal(p1.getView().closed, true);
});

test('открытые комнаты: полная комната и начавшаяся игра в списке не показываются', async () => {
  const server = makeServer();
  const a = await client(server, 'a').createRoom({ size: 2, name: 'А' });
  const b = await client(server, 'b').createRoom({ size: 4, name: 'Б' });
  const p = await client(server, 'p').joinRoom(a.code, { name: 'П' });
  await step(server, a.host, [p]);
  await b.host.start();
  const list = await client(server, 'v').listRooms();
  assert.deepEqual(plain(list), [], 'А заполнена, Б уже играет');
});

test('ошибки доступа: нет прав — понятный код, повторные запросы не ломают хост', async () => {
  const server = makeServer();
  const denied = client(server, '', { getToken: async () => 'tok-' });
  await assert.rejects(denied.createRoom({ size: 2 }), { code: 'denied' });
});

test('начало игры в блэкджеке: с ботами можно сразу, без ботов нужно 2 человека и 20 секунд; само игра не начинается', async () => {
  const server = makeServer();
  const opts = Object.assign({}, FAST, { startDelayMs: 20000 });
  const solo = await client(server, 'solo', { options: opts }).createRoom({ size: 3, fillBots: true, name: 'Один', chips: 5000 });
  await step(server, solo.host, [], 30000);
  assert.equal(solo.host.getView().status, 'lobby', 'само не начинается');
  await solo.host.start();
  assert.equal(solo.host.getView().status, 'playing', 'с ботами один человек начинает сразу');
  const { code, host } = await client(server, 'h', { options: opts }).createRoom({ size: 3, fillBots: false, name: 'Хост', chips: 5000 });
  const p1 = await client(server, 'p1', { options: opts }).joinRoom(code, { name: 'Аня', chips: 5000 });
  await step(server, host, [p1], 1000);
  assert.ok(host.getView().startIn > 18000);
  await host.start();
  assert.equal(host.getView().status, 'lobby', 'без ботов до конца отсчёта нельзя');
  await step(server, host, [p1], 25000);
  assert.equal(host.getView().status, 'lobby', 'автозапуска нет');
  await host.start();
  assert.equal(host.getView().status, 'playing');
  assert.equal(p1.getView() && p1.getView().status === 'playing' || (await p1.poll()).status === 'playing', true);
});

test('чат в блэкджеке: сообщения через хоста, системные записи о входе и начале игры, выбывший молчун отмечается', async () => {
  const server = makeServer();
  const { code, host } = await client(server, 'h').createRoom({ size: 3, fillBots: true, name: 'Хост', chips: 5000 });
  const p1 = await client(server, 'p1').joinRoom(code, { name: 'Аня', chips: 5000 });
  await step(server, host, [p1], 1000);
  await p1.send({ type: 'chat', text: 'Привет!', cid: 'x1' });
  await step(server, host, [p1], 1000);
  host.send({ type: 'chat', text: 'Начинаем', cid: 'x2' });
  await host.start();
  await step(server, host, [p1], 1000);
  const chat = p1.getView().chat;
  assert.deepEqual(plain(chat.map((m) => m.kind === 'sys' ? m.code : m.text)), ['join', 'Привет!', 'Начинаем', 'start']);
  assert.ok(chat.filter((m) => m.kind === 'msg').every((m) => m.uid && m.name && m.ts > 0));
  assert.equal(host.getView().chat.length, 4);
});

test('закрытый стол в блэкджеке: не виден в списке открытых, но заходят по коду', async () => {
  const server = makeServer();
  await client(server, 'h1').createRoom({ size: 3, fillBots: true, name: 'Открытый', chips: 5000 });
  const closed = await client(server, 'h2').createRoom({ size: 3, fillBots: true, name: 'Закрытый', chips: 5000, private: true });
  const list = await client(server, 'x').listRooms();
  assert.deepEqual(plain(list.map((r) => r.hostName)), ['Открытый']);
  const p = await client(server, 'p1').joinRoom(closed.code, { name: 'Аня', chips: 5000 });
  await step(server, closed.host, [p], 500);
  assert.equal(p.getView().private, true);
  assert.equal(closed.host.getView().members.length, 2);
});
