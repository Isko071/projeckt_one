// Сообщения об ошибках из браузера игрока в личный кабинет владельца (вкладка «Ошибки»).
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
  root.PlatformErrorReport = { report: report };
})(typeof window !== 'undefined' ? window : globalThis);
