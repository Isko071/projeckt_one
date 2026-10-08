// Запуск: node --test tests/analytics.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'shared', 'analytics.js'), 'utf8');
function run(token) {
  const added = [], note = { hidden: true };
  const document = { head: { appendChild: (el) => added.push(el) }, createElement: () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }), getElementById: (id) => (id === 'footer-stats' ? note : null) };
  const win = { document, CF_ANALYTICS_TOKEN: token, JSON, String, RegExp };
  win.window = win;
  vm.runInContext(code, vm.createContext(win));
  return { added, note };
}

test('без токена статистика выключена и ничего не загружается', () => {
  const r = run('');
  assert.equal(r.added.length, 0);
  assert.equal(r.note.hidden, true);
});

test('с токеном подключается скрипт Cloudflare и показывается строка в подвале', () => {
  const r = run('0123456789abcdef0123456789abcdef');
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].src, 'https://static.cloudflareinsights.com/beacon.min.js');
  assert.deepEqual(JSON.parse(r.added[0].attrs['data-cf-beacon']), { token: '0123456789abcdef0123456789abcdef' });
  assert.equal(r.note.hidden, false);
});

test('странный токен не подключается', () => {
  assert.equal(run('"><script>').added.length, 0);
  assert.equal(run(123).added.length, 0);
});
