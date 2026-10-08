// Запуск: node tools/set-version.js <номер>
// Ставит один номер версии (?v=<номер>) на все локальные скрипты и стили в html-страницах.
// Нужен, чтобы после обновления сайта браузер не смешивал старые файлы из кэша с новыми.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pages = ['index.html', 'games/yahtzee/index.html', 'games/minesweeper/index.html', 'games/blackjack/index.html'];
const version = process.argv[2];
if (!/^\d+$/.test(version || '')) { console.error('Использование: node tools/set-version.js <номер>'); process.exit(1); }

pages.forEach((page) => {
  const file = path.join(root, page);
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/(<script src="|<link rel="stylesheet" href=")((?!https?:)[^"?]+\.(?:js|css))(\?v=\d+)?"/g, '$1$2?v=' + version + '"');
  fs.writeFileSync(file, html);
});
console.log('Версия файлов: ' + version);
