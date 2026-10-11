// Мини-загрузка при каждом переходе между страницами сайта (каталог ↔ игры): 1–4 секунды с анимацией вместо мгновенного перехода.
// Пока идёт загрузка, будится сервер столов (он на бесплатном хостинге засыпает): переход случается, когда сервер ответил,
// но не раньше чем через 1 секунду и не позже чем через 4.
//   PlatformLoader.go(url)   — перейти на страницу с загрузкой (ссылки перехватываются сами; не нужно только для a[data-no-loader])
//   PlatformLoader.cover({ build, done, ms }) — закрыть экран загрузкой, когда игрок садится за стол: на закрытом экране (через 0,3 с) вызывается build
//                            (собрать стол), через ms (по умолчанию 1,4 с) загрузка исчезает, и когда экран полностью открылся, вызывается done (можно раздавать карты)
// Стили: shared/theme.css (.pl, html.pl-arrive). Тексты: locales/ru.js (loader.text).
(function (root) {
  var MIN = 1000, MAX = 4000, FLAG = 'pl:arrive', FADE = 320, COVER_MS = 1400;
  var doc = root.document, going = false;

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
    setTimeout(function () { if (o.build) { try { o.build(); } catch (e) { /* загрузка всё равно закроется */ } } }, FADE);
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); if (o.done) { try { o.done(); } catch (e) { /* ничего */ } } }, FADE);
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
      setTimeout(function () { root.location.href = url; }, 250);
    }
    function check() { if (warmed && Date.now() - t0 >= MIN) leave(); }
    warm(function () { warmed = true; check(); });
    setTimeout(check, MIN);
    setTimeout(leave, MAX);
  }

  // Перехватываем переходы по ссылкам на страницы этого же сайта
  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.hasAttribute('data-leave') || a.hasAttribute('data-no-loader') || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    var u;
    try { u = new URL(a.href, root.location.href); } catch (err) { return; }
    if (u.origin !== root.location.origin || (u.pathname === root.location.pathname && u.search === root.location.search)) return;
    e.preventDefault();
    go(u.href);
  });
  // Вернулись кнопкой «Назад» на страницу из кеша: закрываем загрузку
  root.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    going = false;
    var old = doc.querySelectorAll('.pl');
    for (var i = 0; i < old.length; i++) old[i].remove();
  });

  root.PlatformLoader = { go: go, cover: cover };
})(window);
