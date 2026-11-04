// Сообщения из браузера игрока в личный кабинет владельца: ошибки (вкладка «Ошибки») и отметка посещения (вкладка «Посетители»).
// Ловит необработанные ошибки и отклонённые промисы и тихо отправляет серверу игр (POST /report): текст, место (файл:строка), страницу.
// Личных данных не отправляет. Не больше 5 сообщений за загрузку страницы, одинаковые — один раз; шум (расширения, «Script error.») отбрасывается.
// Подключается в <head> раньше остальных скриптов, адрес сервера берёт из GAME_SERVER_URL в момент отправки.
(function (root) {
  if (!root.addEventListener) return;
  var sent = {}, count = 0, LIMIT = 5;
  function base() { return String(root.GAME_SERVER_URL || '').replace(/^ws/, 'http').replace(/\/+$/, ''); }
  // Место ошибки: путь файла от корня сайта без версии (?v=) и строка
  function where(file, line, col) {
    if (!file) return '';
    var f = String(file).split('#')[0].split('?')[0].replace(/^https?:\/\/[^/]+/, '');
    return f + (line ? ':' + line + (col ? ':' + col : '') : '');
  }
  function noise(msg, file, stack) {
    var s = msg + ' ' + (file || '') + ' ' + (stack || '');
    return /^Script error\.?$/.test(msg) || /extension:\/\/|moz-extension|safari-extension|webkit-masked-url/.test(s) || /ResizeObserver loop/.test(msg) || /gstatic\.com|googleapis\.com|cloudflareinsights/.test(file || '');
  }
  function report(msg, file, line, col, stack) {
    msg = String(msg || '').slice(0, 300);
    if (!msg || noise(msg, file, stack) || count >= LIMIT) return;
    var w = where(file, line, col), key = msg + '|' + w;
    if (sent[key]) return;
    sent[key] = true; count++;
    var url = base();
    if (!url) return;
    var body = JSON.stringify({ msg: msg, where: w, stack: String(stack || '').replace(/https?:\/\/[^/\s)]+/g, '').replace(/\?v=\d+/g, '').slice(0, 800), page: location.pathname.replace(/index\.html$/, '') });
    try {
      if (root.fetch) root.fetch(url + '/report', { method: 'POST', body: body, headers: { 'Content-Type': 'application/json' }, keepalive: true, mode: 'cors' }).catch(function () { /* не дошло — не страшно */ });
    } catch (e) { /* без отправки */ }
  }
  root.addEventListener('error', function (e) {
    if (!e || (e.target && e.target !== root && e.target.tagName)) return;      // не загрузилась картинка или скрипт — это не ошибка кода
    var err = e.error;
    report(e.message || (err && err.message), e.filename, e.lineno, e.colno, err && err.stack);
  });
  root.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    if (r && (r.code === 'offline' || r.code === 'timeout' || r.code === 'denied')) return;   // обрывы связи — не ошибки кода
    var msg = r && r.message ? r.message : String(r);
    report('Promise: ' + msg, r && r.fileName, r && r.lineNumber, null, r && r.stack);
  });
  // ---------- Отметка посещения (вкладка «Посетители» кабинета) ----------
  // Раз за загрузку страницы: случайный номер устройства (хранится в этом браузере), какая страница, uid, если игрок вошёл через Google,
  // и откуда пришли (поиск, Telegram…). Ни имени, ни адреса, ни почты. Кабинет и тесты не считаются
  function device() {
    try {
      var id = root.localStorage.getItem('platform:device');
      if (!/^[a-z0-9]{8,20}$/.test(id || '')) { id = ''; for (var i = 0; i < 12; i++) id += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36)); root.localStorage.setItem('platform:device', id); }
      return id;
    } catch (e) { return ''; }
  }
  function source() {
    var r = '';
    try { r = new URL(document.referrer).hostname; } catch (e) { return ''; }
    if (!r || r === location.hostname) return '';
    if (/(^|\.)google\./.test(r)) return 'google';
    if (/(^|\.)(yandex|ya)\./.test(r)) return 'yandex';
    if (/(^|\.)(t\.me|telegram\.org)$/.test(r) || /telegram/.test(r)) return 'telegram';
    if (/(^|\.)vk\.(com|ru)$/.test(r)) return 'vk';
    if (/whatsapp/.test(r)) return 'whatsapp';
    if (/(^|\.)bing\.com$/.test(r)) return 'bing';
    return 'other';
  }
  function sendVisit(game) {
    var url = base(), d = device();
    if (!url || !d || !root.fetch) return;
    var cloud = root.PlatformCloud && root.PlatformCloud.getState ? root.PlatformCloud.getState() : null;
    var m = location.pathname.match(/\/games\/([a-z0-9-]+)\//);
    var body = JSON.stringify(game ? { d: d, g: game, u: cloud && cloud.user ? cloud.user.uid : '' } : { d: d, p: m ? m[1] : '', u: cloud && cloud.user ? cloud.user.uid : '', s: source() });
    try { root.fetch(url + '/visit', { method: 'POST', body: body, headers: { 'Content-Type': 'application/json' }, keepalive: true, mode: 'cors' }).catch(function () { /* не дошло — не страшно */ }); } catch (e) { /* без отметки */ }
  }
  // Начал партию (вызывает кошелёк при подсчёте партии): в списке устройств кабинета показываются только гости, которые сыграли хотя бы раз.
  // Каждая игра отмечается один раз за загрузку страницы
  var playedSent = {}, counting = !/\/admin\//.test(location.pathname) && /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname);
  function played(game) {
    game = String(game || '').replace(/[^a-z0-9-]/g, '').slice(0, 24);
    if (!counting || !game || playedSent[game]) return;
    playedSent[game] = true;
    sendVisit(game);
  }
  if (counting && !/\/admin\//.test(location.pathname) && /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname)) {
    // Ждём, пока вход через Google восстановится (до 5 секунд), чтобы отметить, гость это или игрок
    var waited = 0, visited = false, timer = root.setInterval(function () {
      waited += 500;
      var c = root.PlatformCloud && root.PlatformCloud.getState ? root.PlatformCloud.getState() : null;
      if ((c && c.user) || (c && c.status === 'unsupported') || waited >= 5000) once();
    }, 500);
    var once = function () { if (visited) return; visited = true; root.clearInterval(timer); sendVisit(); };
    root.addEventListener('pagehide', once);           // ушли со страницы раньше — отмечаем сразу
  }

  root.PlatformErrorReport = { report: report, played: played };
})(typeof window !== 'undefined' ? window : globalThis);
