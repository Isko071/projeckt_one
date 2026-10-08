// Запуск: node --test tests/rooms-turns.test.js
// Онлайн-столы для «Ятзи» (shared/rooms-turns.js) на поддельном Firestore с правилами из docs/online-tables.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeServer } = require('./helpers/fake-firestore.js');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ JSON, Promise, Math, Object, Array, Number, String, Error, Date });
['games/yahtzee/logic.js', 'games/yahtzee/table.js', 'shared/rooms-turns.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
const Y = vm.runInContext('Yahtzee', ctx), T = ctx.YahtzeeTable, R = ctx.PlatformTurnRooms;
const plain = (x) => JSON.parse(JSON.stringify(x));
const FAST = { idleMs: 3000, askMs: 2000, staleMs: 30000, heartbeatMs: 5000 };

function client(server, uid) {
  let k = 11;
  return R.create({ fetch: server.fetch, getToken: async () => 'tok-' + uid, uid, projectId: 'p', db: 'd', game: T, gameId: 'yahtzee', now: () => server.now,
    rng: () => { k = (k * 1103515245 + 12345) % 2147483648; return k / 2147483648; }, options: FAST });
}
async function step(server, host, players, ms = 500) { server.advance(ms); await host.tick(server.now); for (const p of players) await p.poll(); }

// Игрок бросает и пишет очки в первую разрешённую клетку
async function turn(p) {
  const v = p.getView(), st = v.state, me = st.players[v.seat];
  if (!T.canAct(st, v.seat)) return false;
  if (me.rollsUsed === 0) { await p.send({ type: 'roll' }); return true; }
  await p.send({ type: 'score', cat: Y.allowedCategories(me, me.dice)[0] });
  return true;
}

async function table(server, n, mode) {
  const { code, host } = await client(server, 'h').createRoom({ size: 6, name: 'Хост', mode });
  const players = [];
  for (let i = 1; i < n; i++) players.push(await client(server, 'p' + i).joinRoom(code, { name: 'Игрок ' + i }));
  await step(server, host, players);
  await host.start();
  await step(server, host, players);
  return { code, host, players };
}

test('комната: код, режим, до 6 мест; в списке только столы «Ятзи», заполненный пропадает', async () => {
  const server = makeServer();
  const a = await client(server, 'h').createRoom({ size: 9, name: 'Аня', mode: 'sync' });
  assert.match(a.code, /^[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(a.host.getView().size, 6, 'не больше 6 мест');
  assert.equal(a.host.getView().mode, 'sync');
  assert.equal((await client(server, 'h').createRoom({ size: 2, name: 'Борис', mode: 'неизвестный' })).host.getView().mode, 'turns', 'неверный режим → по очереди');
  // чужая игра в списке не видна
  server.docs.set('/rooms/ZZZZZ', { fields: { status: { stringValue: 'lobby' }, game: { stringValue: 'blackjack' }, size: { integerValue: '3' }, players: { integerValue: '1' }, heartbeat: { integerValue: String(server.now) } } });
  const list = await client(server, 'x').listRooms();
  assert.deepEqual(plain(list.map((r) => [r.hostName, r.size, r.players, r.mode])), [['Аня', 6, 1, 'sync'], ['Борис', 2, 1, 'turns']]);
});

test('вход: неверный код, закрытая и уже начавшаяся игра, заполненный стол', async () => {
  const server = makeServer();
  const guest = client(server, 'g');
  await assert.rejects(() => guest.joinRoom('AAAAA', {}), { code: 'not-found' });
  const { code, host } = await client(server, 'h').createRoom({ size: 2, name: 'Х' });
  await guest.joinRoom(code, { name: 'Г' });
  await host.tick(server.now);
  await assert.rejects(() => client(server, 'g2').joinRoom(code, {}).then(async (p) => { await host.tick(server.now); return client(server, 'g3').joinRoom(code, {}); }), { code: 'full' });
  await host.start(); await host.publish();
  await assert.rejects(() => client(server, 'late').joinRoom(code, {}), { code: 'started' });
  await host.close();
  await assert.rejects(() => client(server, 'late').joinRoom(code, {}), { code: 'closed' });
});

test('по очереди: действие вне очереди игнорируется, ход идёт по кругу, все видят кубики и таблицы', async () => {
  const server = makeServer();
  const { host, players } = await table(server, 3, 'turns');
  const [p1, p2] = players;
  assert.equal(p1.getView().state.current, 0);
  await p1.send({ type: 'roll' });                       // не его ход
  await step(server, host, players);
  assert.equal(p1.getView().state.players[1].rollsUsed, 0);
  host.send({ type: 'roll' });
  host.send({ type: 'score', cat: 'chance' });
  await step(server, host, players);
  assert.equal(p2.getView().state.current, 1);
  assert.notEqual(p2.getView().state.players[0].scores.chance, null, 'игрок видит записанные очки хоста');
  assert.equal(await turn(p1), true);
  await step(server, host, players);
  await turn(p1);
  await step(server, host, players);
  assert.equal(p2.getView().state.current, 2);
});

test('одновременно: все играют сразу, раунд закрывается после записи последнего игрока', async () => {
  const server = makeServer();
  const { host, players } = await table(server, 4, 'sync');
  const all = [{ send: (a) => host.send(a), getView: () => host.getView() }, ...players];
  for (let round = 1; round <= 3; round++) {
    for (const p of all) await turn(p), await step(server, host, players, 100);                 // бросок
    // по одному записывают очки; пока не все записали, раунд тот же
    for (let i = 0; i < all.length; i++) {
      await turn(all[i]); await step(server, host, players, 100);
      const st = host.getView().state;
      if (i < all.length - 1) { assert.equal(st.round, round, 'раунд ' + round + ' ещё идёт'); assert.equal(st.players[i].done, true); }
    }
    assert.equal(host.getView().state.round, round + 1);
    assert.ok(host.getView().state.players.every((p) => !p.done));
  }
});

test('неактивный игрок: вопрос «играете?», «да» начинает отсчёт заново, без ответа он сдаётся, ходов за него никто не делает', async () => {
  const server = makeServer();
  const { host, players } = await table(server, 2, 'turns');
  const [p1] = players;
  host.send({ type: 'roll' }); host.send({ type: 'score', cat: 'chance' });         // ход переходит к игроку 1
  await step(server, host, players);
  assert.equal(p1.getView().state.current, 1);
  await step(server, host, players, 3000);
  assert.equal(p1.getView().timers[0].stage, 'asking');
  await p1.send({ type: 'here' });
  await step(server, host, players, 500);
  assert.equal(p1.getView().timers[0].stage, 'idle', 'после «да» отсчёт начался заново');
  assert.ok(p1.getView().timers[0].ms > 2000);
  await step(server, host, players, 3000);
  assert.equal(p1.getView().timers[0].stage, 'asking');
  assert.equal(p1.getView().state.players[1].rollsUsed, 0, 'бросков за игрока не делается');
  await step(server, host, players, 2000);                                          // ответа нет: сдался
  const st = p1.getView().state;
  assert.equal(st.players[1].active, false);
  assert.equal(st.players[1].rollsUsed, 0);
  assert.equal(Y.openCategories(st.players[1]).length, 13, 'очки за него не записаны');
  assert.equal(st.gameOver, true, 'остался один игрок');
  assert.equal(st.reason, 'alone');
});

test('неактивный игрок в одновременном режиме сдаётся, остальные продолжают без него', async () => {
  const server = makeServer();
  const { host, players } = await table(server, 3, 'sync');
  const [p1, p2] = players;
  host.send({ type: 'roll' }); host.send({ type: 'score', cat: 'chance' });
  await p1.send({ type: 'roll' }); await step(server, host, players);
  await p1.send({ type: 'score', cat: Y.allowedCategories(p1.getView().state.players[1], p1.getView().state.players[1].dice)[0] });
  await step(server, host, players, 3000);                                          // третий молчит
  assert.equal(p2.getView().timers.filter((t) => t.seat === 2)[0].stage, 'asking');
  await step(server, host, players, 2000);
  const st = host.getView().state;
  assert.equal(st.players[2].active, false);
  assert.equal(st.gameOver, false);
  assert.equal(st.round, 2, 'раунд закрыт: остальные уже записали очки');
});

test('выход игрока: ведущий отмечает место свободным, стол продолжается; закрытие хоста видно игрокам', async () => {
  const server = makeServer();
  const { host, players } = await table(server, 3, 'sync');
  await players[0].leave();
  await step(server, host, players);
  assert.equal(host.getView().state.players[1].active, false);
  assert.equal(host.getView().state.gameOver, false);
  await host.close();
  await players[1].poll();
  assert.equal(players[1].getView().closed, true);
});

test('молчание хоста: игроки замечают, что стол остановился', async () => {
  const server = makeServer();
  const { host, players } = await table(server, 2, 'turns');
  server.advance(40000);
  await players[0].poll();
  assert.equal(players[0].getView().hostGone, true);
  await host.tick(server.now);
  await players[0].poll();
  assert.equal(players[0].getView().hostGone, false);
});

test('полная партия на троих по сети в обоих режимах: 13 раундов, итоги видны всем', async () => {
  for (const mode of ['turns', 'sync']) {
    const server = makeServer();
    const { host, players } = await table(server, 3, mode);
    const all = [{ send: (a) => host.send(a), getView: () => host.getView() }, ...players];
    let guard = 0;
    while (!host.getView().state.gameOver && guard++ < 400) {
      for (const p of all) await turn(p);
      await step(server, host, players, 200);
    }
    await step(server, host, players, 200);
    const st = players[1].getView().state;
    assert.equal(st.gameOver, true, mode);
    assert.equal(st.reason, 'finished');
    assert.ok(st.players.every((p) => Y.openCategories(p).length === 0), mode + ': все клетки заполнены');
    assert.ok(T.standings(st)[0].winner);
  }
});

test('запись в несуществующую базу (404) не считается успехом: стол не создаётся молча', async () => {
  const server = makeServer();
  const broken = Object.assign({}, server, { fetch: async (url, init) => (init.method === 'GET' ? server.fetch(url, init) : { ok: false, status: 404, json: async () => ({}) }) });
  await assert.rejects(() => client(broken, 'h').createRoom({ size: 2, name: 'Х' }), { code: 'missing' });
  await assert.rejects(() => client(broken, 'h').listRooms(), { code: 'missing' });
});

test('автозапуск: через 20 секунд после входа второго игрока хост сам начинает игру, новый вход сдвигает отсчёт', async () => {
  const server = makeServer();
  const mk = (uid) => R.create({ fetch: server.fetch, getToken: async () => 'tok-' + uid, uid, projectId: 'p', db: 'd', game: T, gameId: 'yahtzee', now: () => server.now, rng: Math.random, options: Object.assign({}, FAST, { autoStartMs: 20000 }) });
  const { code, host } = await mk('h').createRoom({ size: 4, name: 'Хост', mode: 'sync' });
  await host.tick(server.now);
  assert.equal(host.getView().startIn, -1, 'один игрок: отсчёта нет');
  const p1 = await mk('p1').joinRoom(code, { name: 'Аня' });
  await step(server, host, [p1], 1000);
  assert.ok(host.getView().startIn > 18000 && host.getView().startIn <= 20000, 'отсчёт пошёл: ' + host.getView().startIn);
  await step(server, host, [p1], 1000);
  assert.ok(p1.getView().startIn >= 0 && p1.getView().startIn <= 20000, 'игрок тоже видит отсчёт');
  await step(server, host, [p1], 12000);                              // 14 секунд: ещё ждём
  assert.equal(host.getView().status, 'lobby');
  const p2 = await mk('p2').joinRoom(code, { name: 'Боря' });          // новый игрок: отсчёт заново
  await step(server, host, [p1, p2], 1000);
  assert.ok(host.getView().startIn > 18000);
  await step(server, host, [p1, p2], 15000);
  assert.equal(host.getView().status, 'lobby', '16 секунд после последнего входа: ещё не началась');
  await step(server, host, [p1, p2], 5000);
  assert.equal(host.getView().status, 'playing', 'через 20 секунд игра началась сама');
  assert.equal(host.getView().state.players.length, 3);
  assert.equal(p2.getView().status, 'playing');
});

test('автозапуск: если игрок вышел и остался один, отсчёт отменяется', async () => {
  const server = makeServer();
  const mk = (uid) => R.create({ fetch: server.fetch, getToken: async () => 'tok-' + uid, uid, projectId: 'p', db: 'd', game: T, gameId: 'yahtzee', now: () => server.now, rng: Math.random, options: Object.assign({}, FAST, { autoStartMs: 20000 }) });
  const { code, host } = await mk('h').createRoom({ size: 3, name: 'Хост' });
  const p1 = await mk('p1').joinRoom(code, { name: 'Аня' });
  await step(server, host, [p1], 1000);
  assert.ok(host.getView().startIn >= 0);
  await p1.leave();
  await step(server, host, [], 1000);
  assert.equal(host.getView().startIn, -1);
  await step(server, host, [], 30000);
  assert.equal(host.getView().status, 'lobby');
});
