// Статистика посещений: Cloudflare Web Analytics (без cookie, без отслеживания между сайтами).
// Включается, когда в shared/firebase-config.js задан CF_ANALYTICS_TOKEN; пустой токен = ничего не загружается.
// Подключается на каталоге и страницах игр, но не на странице владельца (/admin/), чтобы свои заходы не считались.
(function (root) {
  var token = root.CF_ANALYTICS_TOKEN;
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{16,64}$/i.test(token) || !root.document) return;
  var s = root.document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token: token }));
  root.document.head.appendChild(s);
  var note = root.document.getElementById('footer-stats');   // строка в подвале каталога про обезличенную статистику
  if (note) note.hidden = false;
})(typeof window !== 'undefined' ? window : globalThis);
