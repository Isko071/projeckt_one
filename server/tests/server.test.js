const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { startServer } = require('../index');

function client(port, uid) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:' + port), docs = [], pend = {}; let n = 0;
    const c = { docs, ws,
      call: (msg) => new Promise((res) => { const id = ++n; pend[id] = res; ws.send(JSON.stringify(Object.assign({ id }, msg))); }),
      last: () => docs[docs.length - 1] };
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === 'ready') resolve(c);
      else if (m.t === 'doc') docs.push(m.doc);
      else if (m.id && pend[m.id]) pend[m.id](m);
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', token: 'test:' + uid })));
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('сеть: два игрока за одним столом, создатель уходит — стол живёт', async () => {
  const s = await startServer({ insecure: true, config: { tickMs: 50, engineOptions: { startDelayMs: 0 } } });
  try {
    const a = await client(s.port, 'A'), b = await client(s.port, 'B');
    const created = await a.call({ t: 'create', game: 'yahtzee', opts: { size: 2, mode: 'turns', name: 'Аня' } });
    assert.ok(created.ok && created.code);
    const list = await b.call({ t: 'list', game: 'yahtzee' });
    assert.strictEqual(list.rooms.length, 1);
    assert.ok((await b.call({ t: 'join', game: 'yahtzee', code: created.code, hello: { name: 'Боря' } })).ok);
    assert.ok((await a.call({ t: 'act', code: created.code, action: { type: 'start' } })).ok);
    await wait(300);
    assert.strictEqual(b.last().status, 'playing');
    assert.ok((await a.call({ t: 'leave', code: created.code })).ok);
    await wait(300);
    assert.strictEqual(JSON.parse(b.last().meta).owner, 'B');
    const bad = await b.call({ t: 'act', code: created.code, action: { type: 'hack' } });
    assert.strictEqual(bad.error, 'bad-action');
  } finally { await s.close(); }
});

test('сеть: без токена не пускает', async () => {
  const s = await startServer({ insecure: true });
  try {
    const ws = new WebSocket('ws://localhost:' + s.port);
    const closed = new Promise((r) => ws.on('close', r));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', token: 'bad' })));
    await closed;
  } finally { await s.close(); }
});

test('кабинет: /admin/stats только для владельца, показывает столы и события', async () => {
  const verify = async (t) => { const m = /^(.+):(.+)$/.exec(String(t)); if (!m) throw new Error('bad'); return { uid: m[1], email: m[2], emailVerified: m[1] !== 'unverified' }; };
  const s = await startServer({ verify, adminEmails: ['Boss@x.com'], allowedOrigins: ['https://site.example'], config: { tickMs: 50, engineOptions: { startDelayMs: 0 } } });
  const get = (token, origin) => fetch('http://localhost:' + s.port + '/admin/stats', { headers: Object.assign({}, token ? { Authorization: 'Bearer ' + token } : {}, origin ? { Origin: origin } : {}) });
  try {
    const ws = new WebSocket('ws://localhost:' + s.port, { headers: { Origin: 'https://site.example' } });
    const opened = new Promise((r) => ws.on('message', (raw) => { if (JSON.parse(String(raw)).t === 'ready') r(); }));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', token: 'p1:p1@x.com' })));
    await opened;
    const created = new Promise((r) => ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.id === 1) r(m); }));
    ws.send(JSON.stringify({ id: 1, t: 'create', game: 'yahtzee', opts: { size: 2, mode: 'turns', name: 'Аня' } }));
    const c = await created;
    assert.strictEqual((await get('')).status, 401);
    assert.strictEqual((await get('p2:other@x.com', 'https://site.example')).status, 403);
    assert.strictEqual((await get('unverified:boss@x.com', 'https://site.example')).status, 403);
    assert.strictEqual((await get('boss:boss@x.com', 'https://evil.example')).status, 403);
    const ok = await get('boss:boss@x.com', 'https://site.example');
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.headers.get('access-control-allow-origin'), 'https://site.example');
    const rep = await ok.json();
    assert.strictEqual(rep.rooms, 1);
    assert.strictEqual(rep.tables[0].code, c.code);
    assert.deepStrictEqual(rep.tables[0].players, ['Аня']);
    assert.strictEqual(rep.counters.created.yahtzee, 1);
    assert.ok(rep.events.some((e) => e.type === 'create' && e.name === 'Аня'));
    assert.ok(rep.counters.denied >= 3);
    ws.close();
  } finally { await s.close(); }
});

test('кабинет: /admin/wallets — баланс и партии всех игроков с сервера, только владельцу', async () => {
  const { MemLedger } = require('../ledger');
  const verify = async (t) => { const m = /^(.+):(.+)$/.exec(String(t)); if (!m) throw new Error('bad'); return { uid: m[1], email: m[2], emailVerified: true }; };
  const s = await startServer({ verify, ledger: new MemLedger(), adminEmails: ['boss@x.com'], config: { tickMs: 50 } });
  const get = (token) => fetch('http://localhost:' + s.port + '/admin/wallets', { headers: { Authorization: 'Bearer ' + token } });
  try {
    await s.wallet.act('A', { op: 'sync' });
    await s.wallet.act('A', { op: 'countPlay', source: 'yahtzee' });
    assert.strictEqual((await get('p2:other@x.com')).status, 403);
    const r = await get('boss:boss@x.com');
    assert.strictEqual(r.status, 200);
    const w = (await r.json()).wallets;
    assert.strictEqual(w.A.plays.yahtzee, 1);
    assert.strictEqual(w.A.balance, 5000);
  } finally { await s.close(); }
});

test('кабинет: без ADMIN_EMAILS доступа нет ни у кого', async () => {
  const s = await startServer({ insecure: true });
  try {
    const r = await fetch('http://localhost:' + s.port + '/admin/stats', { headers: { Authorization: 'Bearer test:boss' } });
    assert.strictEqual(r.status, 403);
  } finally { await s.close(); }
});

test('сеть: серверный кошелёк — баланс, награда по своим суммам, ставка за столом', async () => {
  const { MemLedger } = require('../ledger');
  const s = await startServer({ insecure: true, ledger: new MemLedger(), config: { tickMs: 50, engineOptions: { startDelayMs: 0 } } });
  try {
    const a = await client(s.port, 'A'), b = await client(s.port, 'B');
    const sync = await a.call({ t: 'wallet', op: 'sync' });
    assert.ok(sync.ok); assert.strictEqual(sync.state.balance, 5000);
    const rw = await a.call({ t: 'wallet', op: 'reward', source: 'blackjack', kind: 'win' });
    assert.strictEqual(rw.state.balance, 5250);
    assert.strictEqual((await a.call({ t: 'wallet', op: 'add', n: 99999 })).error, 'bad-request');
    const created = await a.call({ t: 'create', game: 'yahtzee', opts: { size: 2, mode: 'turns', name: 'Аня', stake: 250 } });
    assert.ok(created.ok);
    assert.strictEqual((await a.call({ t: 'wallet', op: 'sync' })).state.balance, 5000);
    assert.strictEqual((await b.call({ t: 'create', game: 'yahtzee', opts: { size: 2, mode: 'turns', stake: 1 } })).error, 'bad-stake');
  } finally { await s.close(); }
});

test('сеть: без серверного кошелька запросы кошелька и ставки отклоняются, столы работают как раньше', async () => {
  const s = await startServer({ insecure: true, ledger: null, config: { tickMs: 50, engineOptions: { startDelayMs: 0 } } });
  try {
    const a = await client(s.port, 'A');
    assert.strictEqual((await a.call({ t: 'wallet', op: 'sync' })).error, 'wallet-off');
    assert.strictEqual((await a.call({ t: 'create', game: 'yahtzee', opts: { size: 2, mode: 'turns', stake: 100 } })).error, 'stakes-off');
    assert.ok((await a.call({ t: 'create', game: 'yahtzee', opts: { size: 2, mode: 'turns' } })).ok);
  } finally { await s.close(); }
});
