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
    const base = canon.slice(0, canon.length - p.length), ogUrl = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || '';
    const og = ogUrl.startsWith(base) ? ogUrl.slice(base.length) : null;      // адрес картинки = адрес сайта + путь в репозитории
    assert.ok(og && fs.existsSync(path.join(root, og)), p + ': картинка превью есть в репозитории (' + og + ')');
    JSON.parse((html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/) || [])[1]);
  });
  assert.equal((sitemap.match(/<loc>/g) || []).length, games.length + 1, 'в sitemap ровно главная и доступные игры');
});

test('robots.txt указывает на sitemap.xml того же сайта и закрывает кабинет', () => {
  const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
  const canon = (fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  assert.ok(robots.includes('Sitemap: ' + canon + 'sitemap.xml'));
  assert.ok(robots.includes('Disallow: /admin/'));
});

test('переезд: на каждой странице есть переход со старого адреса, кабинет тоже', () => {
  [''].concat(games.map((g) => g.path), ['admin/']).forEach((p) => {
    const html = fs.readFileSync(path.join(root, p, 'index.html'), 'utf8');
    assert.ok(html.includes('location.hostname!=="isko071.github.io"') && html.includes('location.replace("https://partejka.pages.dev/"'), p + ': скрипт перехода');
  });
});

test('главная: внизу обычные ссылки на все игры (поисковик находит страницы без скриптов)', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  games.forEach((g) => assert.ok(html.includes('href="' + g.path + '"'), 'ссылка на ' + g.path));
});
