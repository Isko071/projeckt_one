// Запуск: node --test tests/seo.test.js
// Поиск и превью ссылок: у каждой страницы игры и у главной есть заголовок, описание, канонический адрес и картинка превью; все они в sitemap.xml
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const vm = require('node:vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'games', 'games.js'), 'utf8'), ctx);
const games = ctx.GAMES.filter((g) => g.status === 'available');

test('каждая доступная игра и главная: заголовок, описание, канонический адрес, превью; всё в sitemap.xml', () => {
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  [''].concat(games.map((g) => g.path)).forEach((p) => {
    const html = fs.readFileSync(path.join(root, p, 'index.html'), 'utf8');
    assert.match(html, /<!-- seo[^]*<!-- \/seo -->/, p + ': блок seo (node tools/seo.js)');
    assert.equal((html.match(/<title>/g) || []).length, 1, p + ': один <title>');
    const desc = (html.match(/<meta name="description" content="([^"]+)"/) || [])[1];
    assert.ok(desc && desc.length >= 70 && desc.length <= 230, p + ': описание 70–230 символов, сейчас ' + (desc || '').length);
    const canon = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    assert.ok(canon && canon.endsWith('/' + p), p + ': канонический адрес');
    assert.ok(sitemap.includes('<loc>' + canon + '</loc>'), p + ': в sitemap.xml');
    const og = (html.match(/<meta property="og:image" content="[^"]*?\/projeckt_one\/([^"]+)"/) || html.match(/<meta property="og:image" content="https?:\/\/[^/]+\/(?:[^/"]+\/)?([^"]+)"/) || [])[1];
    assert.ok(og && fs.existsSync(path.join(root, og)), p + ': картинка превью есть в репозитории (' + og + ')');
    JSON.parse((html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/) || [])[1]);
  });
  assert.equal((sitemap.match(/<loc>/g) || []).length, games.length + 1, 'в sitemap ровно главная и доступные игры');
});

test('главная: внизу обычные ссылки на все игры (поисковик находит страницы без скриптов)', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  games.forEach((g) => assert.ok(html.includes('href="' + g.path + '"'), 'ссылка на ' + g.path));
});
