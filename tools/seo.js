// Запуск: node tools/seo.js [адрес сайта]
// Для поисковиков и превью ссылок (Google, Яндекс, Telegram, WhatsApp): в <head> каждой страницы вписывает заголовок, описание,
// канонический адрес, Open Graph (картинка и текст превью) и разметку schema.org; создаёт sitemap.xml.
// Блок в <head> между <!-- seo --> и <!-- /seo --> переписывается целиком, остальное не трогается.
// Сменился адрес сайта (свой домен, Cloudflare Pages) — запустить с новым адресом.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const BASE = (process.argv[2] || 'https://isko071.github.io/projeckt_one/').replace(/\/?$/, '/');
const SITE = 'Игротека';
// Коды подтверждения владельца сайта из Google Search Console и Яндекс Вебмастера (метатег, способ «HTML-тег»): только содержимое content="…"
const VERIFY = { google: '', yandex: '' };

// path — страница; og — картинка превью 1200×630 (jpg); game — для разметки VideoGame
const PAGES = [
  { path: '', og: 'assets/og.jpg', title: 'Игротека — бесплатные игры онлайн: шашки, ятзи, сапёр, 2048, покер',
    desc: 'Бесплатные игры в браузере без установки: шашки, ятзи, сапёр, 2048, блоки, блэкджек, покер, морской бой и мины. Играйте с ботами или онлайн с друзьями, собирайте аконы и попадайте в рейтинг.' },
  { path: 'games/checkers/', og: 'games/checkers/og.jpg', game: 'Шашки', genre: ['Настольная игра', 'Шашки'], modes: ['SinglePlayer', 'MultiPlayer'],
    title: 'Шашки онлайн бесплатно — с ботом и с другом | Игротека',
    desc: 'Русские шашки онлайн: бот трёх уровней (лёгкий, средний, сложный) или игра с другом по ссылке. Обязательное взятие, дамки, серии взятий — всё по правилам. Бесплатно, без регистрации.' },
  { path: 'games/yahtzee/', og: 'games/yahtzee/og.jpg', game: 'Ятзи', genre: ['Игра в кости'], modes: ['SinglePlayer', 'MultiPlayer'],
    title: 'Ятзи онлайн бесплатно — игра в кости с друзьями | Игротека',
    desc: 'Ятзи (покер на костях) онлайн: против компьютера, вдвоём на одном телефоне или с друзьями до 6 человек по ссылке. Таблица очков, бонус и подсказки правил. Бесплатно.' },
  { path: 'games/minesweeper/', og: 'games/minesweeper/og.jpg', game: 'Сапёр', genre: ['Головоломка'], modes: ['SinglePlayer'],
    title: 'Сапёр онлайн бесплатно — классическая игра | Игротека',
    desc: 'Классический сапёр онлайн: три уровня (новичок, любитель, эксперт), флажки, рекорды по времени и рейтинг быстрых побед. Первое нажатие всегда безопасно. Удобно на телефоне.' },
  { path: 'games/2048/', og: 'games/2048/og.jpg', game: '2048', genre: ['Головоломка'], modes: ['SinglePlayer'],
    title: '2048 онлайн бесплатно — играть в браузере | Игротека',
    desc: 'Игра 2048 онлайн: сдвигайте плитки свайпом или стрелками, складывайте числа и соберите 2048. Рекорд и сохранение партии. Бесплатно, без установки.' },
  { path: 'games/blocks/', og: 'games/blocks/og.jpg', game: 'Блоки', genre: ['Головоломка'], modes: ['SinglePlayer'],
    title: 'Блоки — головоломка с кубиками онлайн бесплатно | Игротека',
    desc: 'Головоломка с блоками онлайн: перетаскивайте фигуры на поле 8×8, собирайте целые ряды и столбцы, делайте комбо. Бесплатно в браузере на телефоне и компьютере.' },
  { path: 'games/blackjack/', og: 'games/blackjack/og.jpg', game: 'Блэкджек', genre: ['Карточная игра'], modes: ['SinglePlayer', 'MultiPlayer'],
    title: 'Блэкджек онлайн бесплатно — с ботом и с друзьями | Игротека',
    desc: 'Блэкджек (21 очко) онлайн без реальных денег: против дилера или за одним столом с друзьями по ссылке. Удвоение, сплит, подсказки правил. Бесплатно.' },
  { path: 'games/poker-simple/', og: 'games/poker-simple/og.jpg', game: 'Покер: Чожук', genre: ['Карточная игра', 'Покер'], modes: ['SinglePlayer', 'MultiPlayer'],
    title: 'Покер онлайн бесплатно — с ботами и друзьями | Игротека',
    desc: 'Покер «Чожук» онлайн без реальных денег: стол с ботами разных характеров или игра с друзьями по ссылке до 6 человек. Комбинации и правила под рукой. Бесплатно.' },
  { path: 'games/battleship/', og: 'games/battleship/og.jpg', game: 'Морской бой', genre: ['Стратегия'], modes: ['SinglePlayer', 'MultiPlayer'],
    title: 'Морской бой онлайн — с ботом и с другом бесплатно | Игротека',
    desc: 'Морской бой онлайн: против бота или с другом по ссылке. Расставьте флот и топите корабли соперника, используйте радар, подлодку и бомбардировщик. Бесплатно.' },
  { path: 'games/mines/', og: 'games/mines/og.jpg', game: 'Мины', genre: ['Головоломка'], modes: ['SinglePlayer'],
    title: 'Мины онлайн бесплатно — открывай клетки и не попадись | Игротека',
    desc: 'Игра «Мины» онлайн: выберите число мин на поле 5×5 и открывайте клетки — чем дальше, тем больше награда. Вовремя заберите выигрыш. Без реальных денег, бесплатно.' }
];

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function block(p) {
  const url = BASE + p.path, img = BASE + p.og;
  const ld = p.game
    ? { '@context': 'https://schema.org', '@type': 'VideoGame', name: p.game, description: p.desc, url, image: img, inLanguage: 'ru', genre: p.genre, playMode: p.modes,
        applicationCategory: 'Game', gamePlatform: 'Web browser', operatingSystem: 'Any', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        isPartOf: { '@type': 'WebSite', name: SITE, url: BASE } }
    : { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE, url: BASE, description: p.desc, inLanguage: 'ru',
        hasPart: PAGES.filter((x) => x.game).map((x) => ({ '@type': 'VideoGame', name: x.game, url: BASE + x.path })) };
  return [
    '<!-- seo: создано tools/seo.js, правьте там -->',
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

const day = new Date().toISOString().slice(0, 10);
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  PAGES.map((p) => '  <url><loc>' + BASE + p.path + '</loc><lastmod>' + day + '</lastmod><priority>' + (p.path ? '0.8' : '1.0') + '</priority></url>').join('\n') + '\n</urlset>\n';
fs.writeFileSync(path.join(root, 'sitemap.xml'), sitemap);
console.log('SEO: ' + PAGES.length + ' страниц, адрес ' + BASE + ', sitemap.xml обновлён');
