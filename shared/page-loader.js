// Мини-загрузка при каждом переходе между страницами сайта (каталог ↔ игры): ровно 2,5 секунды с анимацией вместо мгновенного перехода.
// Пока идёт загрузка, будится сервер столов (он на бесплатном хостинге засыпает). Переход начинается через 2,5 секунды после нажатия
// (2,25 с экран закрыт и ещё 0,25 с уходит на уход со страницы); если сервер ещё просыпается, его дожидаются уже в игре.
//   PlatformLoader.go(url)   — перейти на страницу с загрузкой (ссылки перехватываются сами; не нужно только для a[data-no-loader])
//   PlatformLoader.cover({ build, reveal, done, ms }) — закрыть экран загрузкой, когда игрок садится за стол: на закрытом экране (через 0,3 с) вызывается build
//                            (собрать стол), когда загрузка начинает таять, reveal (показать стол и начать раздачу), через ms (по умолчанию 1,38 с, всего загрузка 1,7 с) загрузка исчезает, и когда экран полностью открылся, вызывается done (можно раздавать карты)
// Стили: shared/theme.css (.pl, html.pl-arrive). Тексты: locales/ru.js (loader.text).
(function (root) {
  var MIN = 2250, MAX = 2250, FLAG = 'pl:arrive', FADE = 320, COVER_MS = 1380;      // посадка за стол: загрузка идёт ровно 1,7 с (появление 0,3 + 1,38 + исчезновение 0,3)
  var doc = root.document, going = false, timers = [];
  function later(fn, ms) { var id = setTimeout(fn, ms); timers.push(id); return id; }

  // На новой странице: если пришли через загрузку, закрываем её плавным исчезновением (до первой отрисовки, без вспышки)
  try {
    var at = Number(root.sessionStorage.getItem(FLAG));
    root.sessionStorage.removeItem(FLAG);
    if (at && Date.now() - at < 20000) {
      doc.documentElement.classList.add('pl-arrive');
      setTimeout(function () { doc.documentElement.classList.remove('pl-arrive'); }, 900);
    }
  } catch (e) { /* без хранилища просто без плавного появления */ }

  var script = doc.currentScript, logoUrl = script && script.src ? script.src.replace(/shared\/page-loader\.js.*$/, 'assets/logo.svg') : '';
  function text() { return root.I18n ? root.I18n.t('loader.text') : 'Загрузка…'; }

  function overlay() {
    var el = doc.createElement('div');
    el.className = 'pl';
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="pl-box"><img class="pl-logo" alt="" src="' + logoUrl + '"><p class="pl-text"></p></div>';
    el.querySelector('.pl-text').textContent = text();
    doc.body.appendChild(el);
    void el.offsetWidth;                       // чтобы появление было плавным
    el.classList.add('show');
    return el;
  }

  // Будим сервер столов: ответ не нужен (no-cors), важно только, что он пришёл или запрос завершился ошибкой
  function warm(done) {
    var url = root.GAME_SERVER_URL;
    if (!url || typeof root.fetch !== 'function') { done(); return; }
    try { root.fetch(String(url).replace(/^ws/, 'http').replace(/\/+$/, '') + '/healthz', { mode: 'no-cors', cache: 'no-store' }).then(done, done); }
    catch (e) { done(); }
  }

  // Загрузка при посадке за стол: стол собирается под закрытым экраном, карты раздаются только когда экран полностью открылся
  function cover(o) {
    o = o || {};
    var el = overlay(), ms = o.ms || COVER_MS;
    later(function () { if (o.build) { try { o.build(); } catch (e) { /* загрузка всё равно закроется */ } } }, FADE);
    later(function () {
      el.classList.remove('show');                    // загрузка начинает таять: экран открывается
      if (o.reveal) { try { o.reveal(); } catch (e) { /* ничего */ } }
      later(function () { el.remove(); if (o.done) { try { o.done(); } catch (e) { /* ничего */ } } }, FADE);
    }, ms);
  }

  function go(url) {
    if (going) return;
    going = true;
    var el = overlay(), t0 = Date.now(), warmed = false, left = false;
    function leave() {
      if (left) return;
      left = true;
      el.classList.add('done');
      try { root.sessionStorage.setItem(FLAG, String(Date.now())); } catch (e) { /* не страшно */ }
      later(function () { root.location.href = url; }, 250);
    }
    function check() { if (warmed && Date.now() - t0 >= MIN) leave(); }
    warm(function () { warmed = true; check(); });
    later(check, MIN);
    later(leave, MAX);
  }

  // Перехватываем переходы по ссылкам на страницы этого же сайта
  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.hasAttribute('data-leave') || a.hasAttribute('data-no-loader') || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    var u;
    try { u = new URL(a.href, root.location.href); } catch (err) { return; }
    var same = function (p) { return p.replace(/index\.html$/, ''); };
    if (u.origin !== root.location.origin || (same(u.pathname) === same(root.location.pathname) && u.search === root.location.search)) return;
    e.preventDefault();
    go(u.href);
  });
  // Вернулись кнопкой «Назад» на страницу из кеша: закрываем загрузку
  root.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    going = false;
    timers.forEach(function (id) { clearTimeout(id); });         // отложенный переход из прошлого визита не должен сработать после «Вперёд»
    timers = [];
    var old = doc.querySelectorAll('.pl');
    for (var i = 0; i < old.length; i++) old[i].remove();
  });

  root.PlatformLoader = { go: go, cover: cover };
})(window);
