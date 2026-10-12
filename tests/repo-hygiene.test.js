// Запуск: node --test tests/repo-hygiene.test.js
// GitHub Pages собирает сайт Jekyll'ом, и любая сломанная ссылка (symlink) в репозитории роняет всю выкладку (так было с server/node_modules).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');

test('в репозитории нет символических ссылок (они ломают сборку GitHub Pages)', () => {
  let files;
  try { files = execFileSync('git', ['ls-files', '-s'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean); } catch (e) { return; }      // без git проверять нечего
  const links = files.filter((l) => l.startsWith('120000')).map((l) => l.split('\t')[1]);
  assert.deepEqual(links, []);
});

test('папки node_modules игнорируются git', () => {
  const ign = fs.readFileSync(path.join(root, 'server', '.gitignore'), 'utf8').split('\n').map((s) => s.trim());
  assert.ok(ign.includes('node_modules'), 'в server/.gitignore должно быть «node_modules» (без слэша: так игнорируется и ссылка)');
});
