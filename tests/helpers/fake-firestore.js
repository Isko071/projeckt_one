// Поддельный Firestore для тестов онлайн-столов (shared/rooms.js, shared/rooms-turns.js): документы в памяти и правила доступа из docs/online-tables.md
function makeServer() {
  const docs = new Map(); let counter = 0, clock = 1000;
  const server = { docs, get now() { return clock; }, advance(ms) { clock += ms; }, log: [] };
  const uidOf = (init) => (init.headers.Authorization || '').replace('Bearer tok-', '');
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const val = (d, k) => { const f = d.fields[k]; return f ? (f.stringValue !== undefined ? f.stringValue : Number(f.integerValue)) : undefined; };
  server.fetch = async (url, init) => {
    const uid = uidOf(init), method = init.method;
    const rel = url.split('/documents')[1] || '';
    server.log.push(method + ' ' + rel);
    if (!uid) return res(401, {});
    if (rel === ':runQuery') {
      const rows = [...docs.entries()].filter(([p, d]) => /^\/rooms\/[^/]+$/.test(p) && d.fields.status.stringValue === 'lobby').map(([p, d]) => ({ document: { name: 'projects/p/databases/d/documents' + p, fields: d.fields } }));
      return res(200, rows.length ? rows : [{}]);
    }
    const p = rel.split('?')[0], parts = p.split('/').filter(Boolean);
    const roomPath = '/rooms/' + parts[1], room = docs.get(roomPath);
    if (parts[0] === 'rooms' && parts.length === 2) {
      if (method === 'GET') return room ? res(200, { name: 'projects/p/databases/d/documents' + p, ...room }) : res(404, {});
      if (method === 'PATCH') {
        const body = JSON.parse(init.body);
        if (url.includes('exists=false')) {
          if (room) return res(409, {});
          if (val(body, 'hostUid') !== uid) return res(403, {});
        } else if (!room || val(room, 'hostUid') !== uid) return res(403, {});
        docs.set(roomPath, { fields: body.fields, createTime: String(clock) });
        return res(200, {});
      }
    }
    if (parts[0] === 'rooms' && parts[2] === 'actions') {
      if (parts.length === 3) {
        if (method === 'POST') {
          const body = JSON.parse(init.body);
          if (val(body, 'uid') !== uid) return res(403, {});
          const id = 'a' + String(++counter).padStart(6, '0');
          docs.set('/rooms/' + parts[1] + '/actions/' + id, { fields: body.fields, createTime: String(clock) });
          return res(200, { name: 'projects/p/databases/d/documents/rooms/' + parts[1] + '/actions/' + id });
        }
        if (method === 'GET') {
          if (!room || val(room, 'hostUid') !== uid) return res(403, {});
          const list = [...docs.entries()].filter(([k]) => k.startsWith('/rooms/' + parts[1] + '/actions/')).map(([k, d]) => ({ name: 'projects/p/databases/d/documents' + k, fields: d.fields }));
          return res(200, list.length ? { documents: list } : {});
        }
      }
      if (parts.length === 4 && method === 'DELETE') {
        if (!room || val(room, 'hostUid') !== uid) return res(403, {});
        docs.delete(p);
        return res(200, {});
      }
    }
    return res(404, {});
  };
  return server;
}


module.exports = { makeServer };
