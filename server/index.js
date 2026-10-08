// WebSocket-сервер столов. Протокол (JSON):
//  клиент → сервер: { t:'auth', token } первым сообщением; затем { id, t:'list'|'create'|'join'|'act'|'leave', game, code, ... }
//  сервер → клиент: { t:'ready' }, { id, ok:true, ... } / { id, ok:false, error }, { t:'doc', code, doc }, { t:'gone', code }
const http = require('http');
const { WebSocketServer } = require('ws');
const { loadEngine } = require('./load-engine');
const { RoomManager } = require('./manager');
const { makeVerifier } = require('./auth');

function startServer(o) {
  o = o || {};
  const verify = o.verify || makeVerifier({ projectId: o.projectId, insecure: o.insecure });
  const origins = (o.allowedOrigins || []).filter(Boolean);
  const maxConns = o.maxConns || 400, maxPerIp = o.maxPerIp || 20, maxMsg = 4000, perSec = 20;
  const manager = new RoomManager({ engine: loadEngine(), config: o.config || {} }).start();
  const perIp = new Map();

  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(Object.assign({ ok: true }, manager.stats()))); return; }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server, maxPayload: maxMsg, verifyClient: (info) => !origins.length || !info.origin || origins.indexOf(info.origin) >= 0 });

  wss.on('connection', (ws, req) => {
    const ip = String((req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')).split(',')[0].trim();
    if (wss.clients.size > maxConns || (perIp.get(ip) || 0) >= maxPerIp) { ws.close(1013, 'busy'); return; }
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    const conn = { uid: null, rooms: new Set(), send: (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } };
    let alive = true, count = 0, authing = false;
    const rate = setInterval(() => { count = 0; }, 1000);
    ws.on('pong', () => { alive = true; });
    const ping = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 20000);

    ws.on('message', async (raw) => {
      if (++count > perSec) { ws.close(1008, 'rate'); return; }
      let m; try { m = JSON.parse(String(raw)); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      const reply = (extra) => conn.send(Object.assign({ id: m.id, ok: true }, extra));
      const err = (e) => conn.send({ id: m.id, ok: false, error: (e && e.code) || 'error' });
      if (!conn.uid) {
        if (m.t !== 'auth' || authing) return;
        authing = true;
        try { conn.uid = (await verify(m.token)).uid; manager.conns.add(conn); conn.send({ t: 'ready', uid: conn.uid }); }
        catch (e) { conn.send({ t: 'denied' }); ws.close(1008, 'auth'); }
        return;
      }
      try {
        if (m.t === 'list') reply({ rooms: manager.list(m.game) });
        else if (m.t === 'create') reply({ code: await manager.create(conn, m.game, m.opts) });
        else if (m.t === 'join') reply({ code: await manager.join(conn, m.game, m.code, m.hello) });
        else if (m.t === 'act') { manager.act(conn, m.code, m.action); reply({}); }
        else if (m.t === 'leave') { manager.leave(conn, m.code); reply({}); }
        else if (m.t === 'ping') reply({});
      } catch (e) { err(e); }
    });
    ws.on('close', () => {
      clearInterval(rate); clearInterval(ping);
      perIp.set(ip, Math.max(0, (perIp.get(ip) || 1) - 1));
      if (conn.uid) manager.disconnect(conn);
    });
    ws.on('error', () => {});
  });

  return new Promise((resolve) => server.listen(o.port || 0, () => resolve({
    port: server.address().port, manager,
    close: () => { manager.stop(); wss.clients.forEach((c) => c.terminate()); return new Promise((r) => server.close(r)); }
  })));
}

module.exports = { startServer };

if (require.main === module) {
  startServer({
    port: Number(process.env.PORT) || 8080,
    projectId: process.env.FIREBASE_PROJECT_ID,
    insecure: process.env.INSECURE_AUTH === '1',
    allowedOrigins: String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim())
  }).then((s) => console.log('Игротека: сервер столов слушает порт ' + s.port));
}
