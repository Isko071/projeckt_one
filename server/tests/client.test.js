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
