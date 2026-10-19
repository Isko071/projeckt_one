const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { startServer } = require('../index');
const { loadEngine } = require('../load-engine');
require('../../shared/rooms-ws.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await wait(20); } throw new Error('timeout'); }

test('клиент rooms-ws: создание, вход, старт, передача роли', async () => {
  const eng = loadEngine();
  const s = await startServer({ insecure: true, config: { tickMs: 50, engineOptions: { startDelayMs: 0 } } });
  const mk = (uid) => globalThis.PlatformRoomsWS.create({ url: 'ws://localhost:' + s.port, WebSocket, getToken: async () => 'test:' + uid, uid, engine: eng.PlatformTurnRooms, engineEnv: { game: eng.YahtzeeTable, gameId: 'yahtzee' }, game: 'yahtzee' });
  const A = mk('A'), B = mk('B');
  try {
    const { code, host } = await A.createRoom({ size: 2, mode: 'turns', name: 'Аня', avatar: 0 });
    assert.strictEqual(host.server, true);
    assert.strictEqual(host.getView().owner, 'A');
    assert.strictEqual((await B.listRooms()).length, 1);
    const b = await B.joinRoom(code, { name: 'Боря', avatar: 1 });
    await until(() => host.getView().members.length === 2);
    await host.start();
    await until(() => b.getView().status === 'playing');
    await host.leave();
    await until(() => b.getView().owner === 'B');
    await b.send({ type: 'roll' });
  } finally { A.shutdown(); B.shutdown(); await s.close(); }
});

// Телефон сменил сеть: сокет числится открытым, но ничего не доходит. Клиент сам замечает это, переподключается и возвращается за стол
test('клиент rooms-ws: молча умершее соединение заменяется новым', async () => {
  const eng = loadEngine();
  const s = await startServer({ insecure: true, config: { tickMs: 50, engineOptions: { startDelayMs: 0 } } });
  const socks = [];
  class FlakyWS extends WebSocket {
    constructor(url) { super(url); this.frozen = false; socks.push(this); }
    send(data) { if (!this.frozen) super.send(data); }
    set onmessage(fn) { super.onmessage = (ev) => { if (!this.frozen) fn(ev); }; }
    get onmessage() { return super.onmessage; }
  }
  const timing = { act: 300, ping: 200, pingWait: 150 };
  const A = globalThis.PlatformRoomsWS.create({ url: 'ws://localhost:' + s.port, WebSocket, getToken: async () => 'test:A', uid: 'A', engine: eng.PlatformTurnRooms, engineEnv: { game: eng.YahtzeeTable, gameId: 'yahtzee' }, game: 'yahtzee' });
  const B = globalThis.PlatformRoomsWS.create({ url: 'ws://localhost:' + s.port, WebSocket: FlakyWS, timing, getToken: async () => 'test:B', uid: 'B', engine: eng.PlatformTurnRooms, engineEnv: { game: eng.YahtzeeTable, gameId: 'yahtzee' }, game: 'yahtzee' });
  const chat = (v) => (v.chat || []).filter((m) => m.kind === 'msg').map((m) => m.text);
  try {
    const { code, host } = await A.createRoom({ size: 2, mode: 'sync', name: 'Аня', avatar: 0 });
    const b = await B.joinRoom(code, { name: 'Боря', avatar: 1 });
    await until(() => host.getView().members.length === 2);
    // действие в мёртвое соединение: ошибка через короткое время, а не вечное ожидание
    socks[socks.length - 1].frozen = true;
    await assert.rejects(b.send({ type: 'chat', text: 'потерялось', cid: 'c1' }));
    await until(() => B.status() === 'open' && socks.length >= 2);
    await b.send({ type: 'chat', text: 'дошло', cid: 'c2' });
    await until(() => chat(host.getView()).includes('дошло'));
    // без всяких действий: проверка связи сама находит мёртвое соединение
    const n = socks.length;
    socks[n - 1].frozen = true;
    await until(() => socks.length > n && B.status() === 'open');
    await b.send({ type: 'chat', text: 'снова тут', cid: 'c3' });
    await until(() => chat(host.getView()).includes('снова тут'));
  } finally { A.shutdown(); B.shutdown(); socks.forEach((w) => w.terminate()); await s.close(); }
});

// Сообщение входа потерялось (соединение открылось в умирающей сети): действия не ждут вечно, а уходят по следующему соединению
test('клиент rooms-ws: потерянный вход — новое соединение, ждавший запрос не теряется', async () => {
  const eng = loadEngine();
  const s = await startServer({ insecure: true, config: { tickMs: 50, engineOptions: { startDelayMs: 0 } } });
  const socks = [];
  class LossyWS extends WebSocket {
    constructor(url) { super(url); this.frozen = socks.length === 0; socks.push(this); }   // первое соединение «умирает» сразу
    send(data) { if (!this.frozen) super.send(data); }
    set onmessage(fn) { super.onmessage = (ev) => { if (!this.frozen) fn(ev); }; }
    get onmessage() { return super.onmessage; }
  }
  const A = globalThis.PlatformRoomsWS.create({ url: 'ws://localhost:' + s.port, WebSocket: LossyWS, timing: { auth: 300 }, getToken: async () => 'test:A', uid: 'A', engine: eng.PlatformTurnRooms, engineEnv: { game: eng.YahtzeeTable, gameId: 'yahtzee' }, game: 'yahtzee' });
  try {
    const t0 = Date.now();
    const { host } = await A.createRoom({ size: 2, mode: 'sync', name: 'Аня', avatar: 0 });
    assert.ok(Date.now() - t0 < 5000, 'стол создан по второму соединению');
    assert.strictEqual(host.getView().owner, 'A');
    assert.ok(socks.length >= 2);
  } finally { A.shutdown(); socks.forEach((w) => w.terminate()); await s.close(); }
});
