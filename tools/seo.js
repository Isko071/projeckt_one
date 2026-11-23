// Запуск: node tools/seo.js [адрес сайта]
// Для поисковиков и превью ссылок (Google, Яндекс, Telegram, WhatsApp): в <head> каждой страницы вписывает заголовок, описание,
// канонический адрес, Open Graph (картинка и текст превью) и разметку schema.org; под игрой — текст об игре; создаёт sitemap.xml и sitemap.txt.
// Блок в <head> между <!-- seo --> и <!-- /seo --> переписывается целиком, остальное не трогается.
// Сменился адрес сайта (свой домен, Cloudflare Pages) — запустить с новым адресом.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const BASE = (process.argv[2] || 'https://partejka.pages.dev/').replace(/\/?$/, '/');
// Прежний адрес сайта (GitHub Pages): страница оттуда сразу переходит на ту же страницу нового адреса.
// В первый раз она забирает с собой прогресс гостя (аконы, рекорды, профиль) — у нового адреса своё хранилище браузера, иначе гость начал бы с нуля.
// Новый адрес принимает его в shared/storage.js (#move=…), только если там ещё ничего нет
const OLD = { host: 'isko071.github.io', prefix: '/projeckt_one' };
const SITE = 'Партейка';
// Коды подтверждения владельца сайта из Google Search Console и Яндекс Вебмастера (метатег, способ «HTML-тег»): только содержимое content="…"
const VERIFY = { google: '2MiJKadnDOe0Y7kURBNsd4-zQC72_QKI7djZBmL57ks', yandex: '292ad233c4b1c14d' };

// path — страница; og — картинка превью 1200×630 (jpg); game — для разметки VideoGame
const PAGES = [
  { path: '', og: 'assets/og.jpg', title: 'Партейка — бесплатные игры онлайн: дурак, шашки, кости, сапёр, 2048',
    desc: 'Бесплатные игры в браузере без установки: дурак, шашки, кости, сапёр, 2048, блоки, блэкджек, покер, морской бой и мины. Играйте с ботами или онлайн с друзьями, собирайте аконы и попадайте в рейтинг.' },
  { path: 'games/checkers/', og: 'games/checkers/og.jpg', game: 'Шашки', genre: ['Настольная игра', 'Шашки'], modes: ['SinglePlayer', 'MultiPlayer'],
    title: 'Шашки онлайн бесплатно — с ботом и с другом | Партейка',
    desc: 'Русские шашки онлайн: бот трёх уровней (лёгкий, средний, сложный) или игра с другом по ссылке. Обязательное взятие, дамки, серии взятий — всё по правилам. Бесплатно, без регистрации.' },
  { path: 'games/durak/', og: 'games/durak/og.jpg', game: 'Дурак', genre: ['Карточная игра'], modes: ['SinglePlayer', 'MultiPlayer'],
    title: 'Дурак онлайн бесплатно — подкидной и переводной | Партейка',
    desc: 'Карточная игра «Дурак» онлайн: подкидной и переводной, колода 36 или 52 карты. Против ботов трёх уровней или с друзьями до 6 человек по ссылке. Бесплатно.' },
  { path: 'games/yahtzee/', og: 'games/yahtzee/og.jpg', game: 'Кости', genre: ['Игра в кости'], modes: ['SinglePlayer', 'MultiPlayer'],
    title: 'Кости онлайн бесплатно — покер на костях с друзьями | Партейка',
    desc: 'Покер на костях онлайн: пять кубиков, три броска и 13 комбинаций. Против компьютера, вдвоём на одном телефоне или с друзьями до 6 человек по ссылке. Бесплатно.' },
  { path: 'games/minesweeper/', og: 'games/minesweeper/og.jpg', game: 'Сапёр', genre: ['Головоломка'], modes: ['SinglePlayer'],
    title: 'Сапёр онлайн бесплатно — классическая игра | Партейка',
    desc: 'Классический сапёр онлайн: три уровня (новичок, любитель, эксперт), флажки, рекорды по времени и рейтинг быстрых побед. Первое нажатие всегда безопасно. Удобно на телефоне.' },
  { path: 'games/2048/', og: 'games/2048/og.jpg', game: '2048', genre: ['Головоломка'], modes: ['SinglePlayer'],
    title: '2048 онлайн бесплатно — играть в браузере | Партейка',
    desc: 'Игра 2048 онлайн: сдвигайте плитки свайпом или стрелками, складывайте числа и соберите 2048. Рекорд и сохранение партии. Бесплатно, без установки.' },
  { path: 'games/blocks/', og: 'games/blocks/og.jpg', game: 'Блоки', genre: ['Головоломка'], modes: ['SinglePlayer'],
    title: 'Блоки — головоломка с кубиками онлайн бесплатно | Партейка',
    desc: 'Головоломка с блоками онлайн: перетаскивайте фигуры на поле 8×8, собирайте целые ряды и столбцы, делайте комбо. Бесплатно в браузере на телефоне и компьютере.' },
  { path: 'games/blackjack/', og: 'games/blackjack/og.jpg', game: 'Блэкджек', genre: ['Карточная игра'], modes: ['SinglePlayer', 'MultiPlayer'],
    title: 'Блэкджек онлайн бесплатно — с ботом и с друзьями | Партейка',
    desc: 'Блэкджек (21 очко) онлайн без реальных денег: против дилера или за одним столом с друзьями по ссылке. Удвоение, сплит, подсказки правил. Бесплатно.' },
  { path: 'games/poker-simple/', og: 'games/poker-simple/og.jpg', game: 'Покер: Чожук', genre: ['Карточная игра', 'Покер'], modes: ['SinglePlayer', 'MultiPlayer'],
    title: 'Покер онлайн бесплатно — с ботами и друзьями | Партейка',
    desc: 'Покер «Чожук» онлайн без реальных денег: стол с ботами разных характеров или игра с друзьями по ссылке до 6 человек. Комбинации и правила под рукой. Бесплатно.' },
  { path: 'games/battleship/', og: 'games/battleship/og.jpg', game: 'Морской бой', genre: ['Стратегия'], modes: ['SinglePlayer', 'MultiPlayer'],
    title: 'Морской бой онлайн — с ботом и с другом бесплатно | Партейка',
    desc: 'Морской бой онлайн: против бота или с другом по ссылке. Расставьте флот и топите корабли соперника, используйте радар, подлодку и бомбардировщик. Бесплатно.' },
  { path: 'games/mines/', og: 'games/mines/og.jpg', game: 'Мины', genre: ['Головоломка'], modes: ['SinglePlayer'],
    title: 'Мины онлайн бесплатно — открывай клетки и не попадись | Партейка',
    desc: 'Игра «Мины» онлайн: выберите число мин на поле 5×5 и открывайте клетки — чем дальше, тем больше награда. Вовремя заберите выигрыш. Без реальных денег, бесплатно.' }
];

function moveScript() {
  return '<script>(function(){if(location.hostname!==' + JSON.stringify(OLD.host) + ')return;' +
    'var p=location.pathname.replace(/^' + OLD.prefix.replace(/\//g, '\\/') + '\\/?/,""),h=location.hash,d="";' +
    'try{if(!/^#[A-Z0-9]{5}$/i.test(h)&&!localStorage.getItem("platform:moved")){var o={},n=0;' +
    'for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(/^(platform|game):/.test(k)){o[k]=localStorage.getItem(k);n++;}}' +
    'if(n)d="#move="+encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(o)))));localStorage.setItem("platform:moved","1");}}catch(e){}' +
    'location.replace(' + JSON.stringify(BASE) + '+p+location.search+(d||h));})();</script>';
}
const EXTRA = ['admin/index.html', '404.html'];        // страницы без блока seo, которым тоже нужен переход со старого адреса

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function block(p) {
  const url = BASE + p.path, img = BASE + p.og;
  const ld = p.game
    ? { '@context': 'https://schema.org', '@type': 'VideoGame', name: p.game, description: p.desc, url, image: img, inLanguage: 'ru', genre: p.genre, playMode: p.modes,
        applicationCategory: 'Game', gamePlatform: 'Web browser', operatingSystem: 'Any', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        isPartOf: { '@type': 'WebSite', name: SITE, url: BASE } }
    : { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE, alternateName: ['Partejka', SITE + ' — игры онлайн'], url: BASE, description: p.desc, inLanguage: 'ru',
        hasPart: PAGES.filter((x) => x.game).map((x) => ({ '@type': 'VideoGame', name: x.game, url: BASE + x.path })) };
  return [
    '<!-- seo: создано tools/seo.js, правьте там -->',
    moveScript(),
    '<title>' + esc(p.title) + '</title>',
    '<meta name="description" content="' + esc(p.desc) + '">',
    '<link rel="canonical" href="' + url + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="' + SITE + '">',
    '<meta property="og:locale" content="ru_RU">',
    '<meta property="og:title" content="' + esc(p.title) + '">',
    '<meta property="og:description" content="' + esc(p.desc) + '">',
    '<meta property="og:url" content="' + url + '">',
    '<meta property="og:image" content="' + img + '">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>',
    p.path === '' && VERIFY.google ? '<meta name="google-site-verification" content="' + esc(VERIFY.google) + '">' : '',
    p.path === '' && VERIFY.yandex ? '<meta name="yandex-verification" content="' + esc(VERIFY.yandex) + '">' : '',
    '<!-- /seo -->'
  ].filter(Boolean).join('\n');
}

PAGES.forEach((p) => {
  const file = path.join(root, p.path, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  if (/<!-- seo[^]*?<!-- \/seo -->/.test(html)) html = html.replace(/<!-- seo[^]*?<!-- \/seo -->/, block(p));
  else html = html.replace(/<title>[^<]*<\/title>/, block(p));
  fs.writeFileSync(file, html);
});

EXTRA.forEach((f) => {
  const file = path.join(root, f), tag = '<!-- move: создано tools/seo.js -->';
  let html = fs.readFileSync(file, 'utf8');
  const blockText = tag + '\n' + moveScript() + '\n<!-- /move -->';
  if (/<!-- move[^]*?<!-- \/move -->/.test(html)) html = html.replace(/<!-- move[^]*?<!-- \/move -->/, blockText);
  else html = html.replace(/(<meta charset="utf-8">\n)/, '$1' + blockText + '\n');
  fs.writeFileSync(file, html);
});

// Текст о сайте и об игре прямо в HTML (под игрой, на главной — над подвалом): поисковик видит содержание страницы без скриптов.
// Тексты берутся из словаря locales/ru.js (ключи seo.*), блок между <!-- about --> и <!-- /about --> переписывается целиком.
const vm = require('node:vm');
const dictCtx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'locales', 'ru.js'), 'utf8'), dictCtx);
const T = dictCtx.LOCALES.ru;
function tr(key) { if (typeof T[key] !== 'string') throw new Error('Нет текста в locales/ru.js: ' + key); return T[key]; }
function gameId(p) { return p.path.split('/')[1]; }
const ABOUT_CSS = '<style>' +
  '.seo-about{box-sizing:border-box;max-width:680px;margin:0 auto;padding:28px 16px 36px;border-top:1px solid var(--line);color:var(--muted);font-size:14px;line-height:1.55;text-align:left}' +
  '.seo-about h2{margin:0 0 8px;color:var(--ink);font-size:18px;line-height:1.3}' +
  '.seo-about h3{margin:18px 0 6px;color:var(--ink);font-size:15px}' +
  '.seo-about p{margin:0 0 8px}.seo-about ol{margin:0;padding-left:20px}.seo-about li{margin:2px 0}' +
  '.seo-about .seo-links{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}' +
  '.seo-about .seo-links a{display:inline-block;padding:6px 12px;border:1px solid var(--line);border-radius:999px;color:var(--ink);text-decoration:none;background:var(--surface)}' +
  '.seo-about .seo-links a:hover{border-color:var(--accent)}.seo-about a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}' +
  'body.rw-on .seo-about{padding-bottom:96px}' +
  '</style>';
function about(p) {
  const out = ['<!-- about: создано tools/seo.js из словаря locales/ru.js (ключи seo.*), правьте там -->', '<section class="seo-about" aria-labelledby="seo-about-h">'];
  if (!p.game) {
    out.push('<h2 id="seo-about-h">' + esc(tr('seo.home.h')) + '</h2>', '<p>' + esc(tr('seo.home.p1')) + '</p>', '<p>' + esc(tr('seo.home.p2')) + '</p>');
  } else {
    const id = gameId(p), steps = [];
    for (let i = 1; T['seo.' + id + '.how' + i]; i++) steps.push('<li>' + esc(T['seo.' + id + '.how' + i]) + '</li>');
    out.push('<h2 id="seo-about-h">' + esc(tr('seo.' + id + '.h')) + '</h2>', '<p>' + esc(tr('seo.' + id + '.p')) + '</p>');
    if (steps.length) out.push('<h3>' + esc(tr('seo.how')) + '</h3>', '<ol>' + steps.join('') + '</ol>');
    const links = PAGES.filter((x) => x.game && x !== p).map((x) => '<li><a href="/' + x.path + '">' + esc(tr('games.' + gameId(x) + '.title')) + '</a></li>');
    links.push('<li><a href="/">' + esc(tr('seo.all')) + '</a></li>');
    out.push('<h3>' + esc(tr('seo.more')) + '</h3>', '<ul class="seo-links">' + links.join('') + '</ul>');
  }
  out.push('</section>', ABOUT_CSS, '<!-- /about -->');
  return out.join('\n');
}
PAGES.forEach((p) => {
  const file = path.join(root, p.path, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  const text = about(p);
  if (/<!-- about[^]*?<!-- \/about -->/.test(html)) html = html.replace(/<!-- about[^]*?<!-- \/about -->/, () => text);
  else if (!p.game) html = html.replace(/(\n\s*)(<footer)/, (m, sp, tag) => sp + text + sp + tag);
  else html = html.replace(/(<main class="app" id="app"><\/main>\n)/, (m) => m + text + '\n');
  if (!html.includes('<!-- /about -->')) throw new Error('Не нашлось места для текста: ' + file);
  fs.writeFileSync(file, html);
});

const day = new Date().toISOString().slice(0, 10);
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  PAGES.map((p) => '  <url><loc>' + BASE + p.path + '</loc><lastmod>' + day + '</lastmod><priority>' + (p.path ? '0.8' : '1.0') + '</priority></url>').join('\n') + '\n</urlset>\n';
fs.writeFileSync(path.join(root, 'sitemap.xml'), sitemap);
// запасная карта сайта простым списком адресов: Search Console иногда читает её, когда с XML сбоит
fs.writeFileSync(path.join(root, 'sitemap.txt'), PAGES.map((p) => BASE + p.path).join('\n') + '\n');
console.log('SEO: ' + PAGES.length + ' страниц, адрес ' + BASE + ', sitemap.xml и sitemap.txt обновлены');
