// Запуск: node --test tests/version.test.js
// Все локальные скрипты и стили в страницах должны иметь один номер версии (?v=N): иначе после обновления сайта
// браузер может взять часть файлов из старого кэша. Поменять номер: node tools/set-version.js <номер>
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pages = ['index.html', 'games/yahtzee/index.html', 'games/minesweeper/index.html', 'games/blackjack/index.html', 'admin/index.html', 'games/poker-simple/index.html'];

test('локальные скрипты и стили во всех страницах имеют один и тот же номер версии', () => {
  const versions = new Set();
  pages.forEach((page) => {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const refs = [...html.matchAll(/(?:<script src|<link rel="stylesheet" href)="((?!https?:)[^"]+\.(?:js|css))(\?v=\d+)?"/g)];
    assert.ok(refs.length > 5, page + ': не найдены подключения');
    refs.forEach((m) => {
      assert.ok(m[2], page + ': нет версии у ' + m[1]);
      versions.add(m[2]);
      assert.ok(fs.existsSync(path.join(root, path.dirname(page), m[1])), page + ': нет файла ' + m[1]);
    });
  });
  assert.equal(versions.size, 1, 'разные версии: ' + [...versions].join(', '));
});
