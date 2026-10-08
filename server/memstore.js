// Хранилище документов в памяти, которое ведёт себя как нужная часть Firestore REST для комнат (shared/rooms.js, shared/rooms-turns.js).
// Движок комнат обращается к «базе» через fetch; здесь вместо сети его запросы обслуживает эта память, а каждое сохранение документа
// комнаты сразу уходит подписчикам (onDoc). Игроки пишут действия напрямую через addAction.
class MemStore {
  constructor(opts) {
    this.docs = new Map();            // код → { fields }
    this.actions = new Map();         // код → [{ name, fields }]
    this.seq = 0;
    this.onDoc = (opts && opts.onDoc) || (() => {});
    this.fetch = this.fetch.bind(this);
  }

  addAction(code, uid, payload, createdAt) {
    const list = this.actions.get(code) || [];
    const name = 'projects/p/databases/d/documents/rooms/' + code + '/actions/a' + String(++this.seq).padStart(9, '0');
    list.push({ name, fields: { uid: { stringValue: String(uid) }, createdAt: { integerValue: String(createdAt || Date.now()) }, payload: { stringValue: String(payload) } } });
    this.actions.set(code, list);
  }

  drop(code) { this.docs.delete(code); this.actions.delete(code); }

  // Минимальная подмена fetch: то, что вызывает хост комнаты (PATCH документа, список и удаление действий)
  async fetch(url, init) {
    const method = (init && init.method) || 'GET';
    const rel = url.split('/documents')[1] || '';
    const p = rel.split('?')[0], parts = p.split('/').filter(Boolean);
    const res = (status, body) => ({ ok: status < 300, status, json: async () => body || {} });
    if (parts[0] === 'rooms' && parts.length === 2) {
      const code = parts[1];
      if (method === 'PATCH') {
        const body = JSON.parse(init.body);
        if (url.includes('exists=false') && this.docs.has(code)) return res(409);
        this.docs.set(code, { fields: body.fields });
        this.onDoc(code, body.fields);
        return res(200);
      }
      if (method === 'GET') return this.docs.has(code) ? res(200, { name: 'projects/p/databases/d/documents' + p, fields: this.docs.get(code).fields }) : res(404);
    }
    if (parts[0] === 'rooms' && parts[2] === 'actions') {
      const code = parts[1];
      if (parts.length === 3 && method === 'GET') {
        const list = this.actions.get(code) || [];
        return res(200, list.length ? { documents: list.map((a) => ({ name: a.name, fields: a.fields })) } : {});
      }
      if (parts.length === 4 && method === 'DELETE') {
        const list = (this.actions.get(code) || []).filter((a) => !a.name.endsWith('/' + parts[3]));
        this.actions.set(code, list);
        return res(200);
      }
    }
    return res(404);
  }
}

// Поля документа Firestore → обычные значения (строки, числа, логические)
function decodeFields(f) {
  const out = {};
  Object.keys(f || {}).forEach((k) => {
    const v = f[k];
    out[k] = v.stringValue !== undefined ? v.stringValue : (v.integerValue !== undefined ? Number(v.integerValue) : v.booleanValue);
  });
  return out;
}

module.exports = { MemStore, decodeFields };
