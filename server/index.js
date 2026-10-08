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

  const admins = (o.adminEmails || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  const originOk = (origin) => !origins.length || !origin || origins.indexOf(origin) >= 0;

  const server = http.createServer((req, res) => {
    const path = String(req.url || '').split('?')[0];
    if (path === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(Object.assign({ ok: true }, manager.stats()))); return; }
    if (path === '/admin/stats') {
      // Личный кабинет владельца: только с токеном аккаунта из ADMIN_EMAILS (почта подтверждена Google), только с разрешённых сайтов
      const origin = req.headers.origin;
      const cors = origin && originOk(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Allow-Methods': 'GET' } : { 'Vary': 'Origin' };
      const send = (status, body) => { res.writeHead(status, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors)); res.end(JSON.stringify(body)); };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
      if (!originOk(origin)) { send(403, { error: 'origin' }); return; }
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      verify(token).then((u) => {
        if (!admins.length || !u.emailVerified || admins.indexOf(String(u.email || '').toLowerCase()) < 0) { manager.counters.denied++; manager.event('denied', { uid: u.uid, info: 'admin' }); send(403, { error: 'forbidden' }); return; }
        send(200, manager.adminReport());
      }, () => { manager.counters.denied++; send(401, { error: 'auth' }); });
      return;
    }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server, maxPayload: maxMsg, verifyClient: (info) => !origins.length || !info.origin || origins.indexOf(info.origin) >= 0 });

  wss.on('connection', (ws, req) => {
    const ip = String((req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')).split(',')[0].trim();
    if (wss.clients.size > maxConns || (perIp.get(ip) || 0) >= maxPerIp) { manager.event('error', { info: 'busy' }); manager.counters.errors++; ws.close(1013, 'busy'); return; }
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    const conn = { uid: null, rooms: new Set(), send: (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } };
    let alive = true, count = 0, authing = false;
    const rate = setInterval(() => { count = 0; }, 1000);
    ws.on('pong', () => { alive = true; });
    const ping = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 20000);

    ws.on('message', async (raw) => {
      if (++count > perSec) { manager.counters.errors++; manager.event('error', { uid: conn.uid, info: 'rate' }); ws.close(1008, 'rate'); return; }
      let m; try { m = JSON.parse(String(raw)); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      const reply = (extra) => conn.send(Object.assign({ id: m.id, ok: true }, extra));
      const err = (e) => conn.send({ id: m.id, ok: false, error: (e && e.code) || 'error' });
      if (!conn.uid) {
        if (m.t !== 'auth' || authing) return;
        authing = true;
        try { conn.uid = (await verify(m.token)).uid; manager.conns.add(conn); manager.counters.connects++; manager.counters.peakConns = Math.max(manager.counters.peakConns, manager.conns.size); conn.send({ t: 'ready', uid: conn.uid }); }
        catch (e) { manager.counters.denied++; manager.event('denied', { info: 'token' }); conn.send({ t: 'denied' }); ws.close(1008, 'auth'); }
        return;
      }
      try {
        if (m.t === 'list') reply({ rooms: manager.list(m.game) });
        else if (m.t === 'create') reply({ code: await manager.create(conn, m.game, m.opts) });
        else if (m.t === 'join') reply({ code: await manager.join(conn, m.game, m.code, m.hello) });
        else if (m.t === 'act') { manager.act(conn, m.code, m.action); reply({}); }
        else if (m.t === 'leave') { manager.leave(conn, m.code); reply({}); }
        else if (m.t === 'ping') reply({});
      } catch (e) { if (!e || !e.code || ['error', 'timeout'].indexOf(e.code) >= 0) { manager.counters.errors++; manager.event('error', { uid: conn.uid, info: String((e && e.code) || 'error') }); } err(e); }
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
    allowedOrigins: String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()),
    adminEmails: String(process.env.ADMIN_EMAILS || '').split(',')
  }).then((s) => console.log('Игротека: сервер столов слушает порт ' + s.port));
}
