// Связь кошелька с сервером (серверный баланс). Подключается после shared/wallet.js, shared/cloud.js; сервер: server/wallet-service.js.
//
// Когда игрок вошёл через Google и задан GAME_SERVER_URL, браузер держит соединение с сервером столов и спрашивает у него настоящий баланс.
// Если сервер не включил серверный баланс (нет ключа сервисного аккаунта), всё остаётся как раньше: кошелёк в браузере.
// Если включил, баланс на экране это копия серверного: награды считаются сразу (чтобы экран ответил мгновенно) и уходят серверу запросами,
// а его ответ заменяет копию. Пока сервер просыпается, запросы ждут в очереди (она хранится в браузере, ничего не теряется).
//
//   PlatformWalletSync.status()    → 'local' (кошелёк в браузере) | 'connecting' (ждём сервер) | 'server' (серверный баланс работает)
//   PlatformWalletSync.onStatus(fn)
//   PlatformWalletSync.start() / stop()   — вызываются сами по входу и выходу из аккаунта
//   PlatformWalletSync.call(op, args)     → Promise<{ state, result }>  запрос к серверу напрямую (только в режиме 'server')
//   PlatformWalletSync.blocked()          → true, если игра, которая пока считает аконы в браузере (покер, «Мины»), сейчас недоступна
(function (root) {
  var W = root.PlatformWallet, Cloud = root.PlatformCloud, Store = root.PlatformStorage;
  var QKEY = 'platform:wallet-queue', KKEY = 'platform:wallet-server';
  var CALL_MS = 20000, CONNECT_MS = 15000;
  var status = 'local', fns = [], ws = null, uid = null, running = false, flushing = false, pend = {}, seq = 0, retry = 0, retryTimer = null, openTimer = null, lastState = null;
  var queue = [];

  function setStatus(s) { if (status === s) return; status = s; fns.forEach(function (fn) { try { fn(s); } catch (e) { /* подписчик не должен ломать остальных */ } }); }
  function store(k, d) { try { return Store ? Store.get(k, d) : d; } catch (e) { return d; } }
  function save(k, v) { try { if (Store) Store.set(k, v); } catch (e) { /* без хранилища очередь живёт до перезагрузки */ } }
  function loadQueue() { var q = store(QKEY, []); queue = Array.isArray(q) ? q.filter(function (x) { return x && typeof x.op === 'string'; }).slice(-200) : []; }
  function saveQueue() { save(QKEY, queue); }
  function fail(code) { var e = new Error(code); e.code = code; return e; }

  // ---------- Соединение ----------
  function url() { return root.GAME_SERVER_URL; }
  function wanted() { var st = Cloud && Cloud.getState && Cloud.getState(); return !!(st && st.status === 'signedIn' && st.user && url() && root.WebSocket); }

  function connect() {
    if (ws || !running) return;
    Cloud.getToken().then(function (token) {
      if (!running || ws) return;
      var sock;
      try { sock = new root.WebSocket(url()); } catch (e) { scheduleRetry(); return; }
      ws = sock;
      var opened = false;
      openTimer = setTimeout(function () { if (!opened) { try { sock.close(); } catch (e) { /* уже закрыт */ } } }, CONNECT_MS);
      sock.onopen = function () { sock.send(JSON.stringify({ t: 'auth', token: token })); };
      sock.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'ready') { opened = true; clearTimeout(openTimer); retry = 0; onReady(m); }
        else if (m.t === 'denied') { opened = true; clearTimeout(openTimer); running = false; setStatus('local'); }
        else if (m.t === 'wallet' && m.state) { lastState = m.state; if (!queue.length && !flushing) W.applyServer(m.state); }
        else if (m.id && pend[m.id]) { var p = pend[m.id]; delete pend[m.id]; clearTimeout(p.timer); if (m.ok) p.res(m); else p.rej(fail(m.error || 'error')); }
      };
      sock.onclose = function () {
        clearTimeout(openTimer);
        if (ws === sock) ws = null;
        Object.keys(pend).forEach(function (id) { var p = pend[id]; delete pend[id]; clearTimeout(p.timer); p.rej(fail('offline')); });
        if (running) { if (status === 'server') setStatus('connecting'); scheduleRetry(); }
      };
      sock.onerror = function () { /* закрытие обработает onclose */ };
    }, function () { scheduleRetry(); });
  }
  function scheduleRetry() {
    if (!running || retryTimer) return;
    var wait = Math.min(15000, 1000 * Math.pow(2, retry++));
    retryTimer = setTimeout(function () { retryTimer = null; connect(); }, wait);
  }
  function rawCall(msg) {
    return new Promise(function (res, rej) {
      if (!ws || ws.readyState !== 1) { rej(fail('offline')); return; }
      var id = ++seq;
      pend[id] = { res: res, rej: rej, timer: setTimeout(function () { delete pend[id]; rej(fail('timeout')); }, CALL_MS) };
      try { ws.send(JSON.stringify(Object.assign({ id: id, t: 'wallet' }, msg))); } catch (e) { delete pend[id]; rej(fail('offline')); }
    });
  }

  // Сервер ответил на вход: включён ли у него серверный баланс
  function onReady(m) {
    save(KKEY, { enabled: !!m.wallet });
    if (!m.wallet) { queue = []; saveQueue(); running = false; try { ws.close(); } catch (e) { /* уже закрыт */ } setStatus('local'); return; }
    flush(true);
  }

  // Очередь запросов: по одному, по порядку; когда пуста — копия заменяется последним ответом сервера
  function flush(withSync) {
    if (flushing) return Promise.resolve();
    flushing = true;
    function next() {
      var item = queue[0] || (withSync ? { op: 'sync' } : null);
      if (!item) return Promise.resolve();
      withSync = false;
      return rawCall(item).then(function (r) {
        if (queue[0] === item || (queue[0] && JSON.stringify(queue[0]) === JSON.stringify(item))) { queue.shift(); saveQueue(); }
        lastState = r.state;
        return next();
      }, function (e) {
        if (e && e.code === 'bad-request') { queue.shift(); saveQueue(); return next(); }      // сервер такой запрос не принимает: выбрасываем, не зацикливаемся
        throw e;
      });
    }
    return next().then(function () {
      flushing = false;
      if (lastState) { W.applyServer(lastState); setStatus('server'); }
    }, function () { flushing = false; if (status === 'server') setStatus('connecting'); });
  }

  // ---------- Для кошелька ----------
  // Запросы кошелька: в режимах «ждём сервер» и «сервер» становятся в очередь
  // active — серверный баланс работает (add/spend в браузере запрещены); queueing — запросы копятся в очереди и при ожидании сервера
  // (пока неизвестно, включён ли серверный баланс, add/spend ещё запрещать рано)
  var driver = {
    active: function () { return status === 'server'; },
    queueing: function () { return status !== 'local'; },
    claim: function (msg) { queue.push(msg); if (queue.length > 200) queue.shift(); saveQueue(); if (status === 'server') flush(false); }
  };
  function applyDriver() { W.setServer(status === 'local' ? null : driver); }

  function start() {
    if (running || !wanted()) return;
    var known = store(KKEY, null);
    uid = Cloud.getState().user.uid;
    running = true;
    loadQueue();
    // Сервер ещё ни разу не отвечал или включал баланс: ждём ответа; если когда-то выключал, остаёмся на кошельке в браузере, пока не придёт ответ
    setStatus(known && known.enabled === false ? 'local' : 'connecting');
    connect();
  }
  function stop() {
    running = false; uid = null;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    try { ws && ws.close(); } catch (e) { /* уже закрыт */ }
    ws = null; lastState = null;
    setStatus('local');
  }
  function refresh() { if (!wanted()) { if (running) stop(); return; } if (!running || (uid && Cloud.getState().user.uid !== uid)) { if (running) stop(); start(); } }

  var api = {
    status: function () { return status; },
    onStatus: function (fn) { fns.push(fn); },
    start: start, stop: stop,
    // «Покер» и «Мины» пока считают аконы в браузере, поэтому при серверном балансе (и пока он неизвестен) недоступны
    blocked: function () { return status !== 'local'; },
    call: function (op, args) {
      if (status !== 'server') return Promise.reject(fail('offline'));
      return rawCall(Object.assign({ op: op }, args || {})).then(function (r) { W.applyServer(r.state); return r; });
    }
  };
  fns.push(applyDriver);
  root.PlatformWalletSync = api;

  if (Cloud && Cloud.onChange) {
    Cloud.onChange(refresh);
    // После загрузки облачной копии прогресса кошелёк в браузере мог перезаписаться старым: просим сервер подтвердить
    var resyncTimer = null;
    Cloud.onChange(function () { if (status !== 'server' || resyncTimer) return; resyncTimer = setTimeout(function () { resyncTimer = null; if (status === 'server' && !flushing) flush(true); }, 2000); });
  }
  if (root.addEventListener) root.addEventListener('online', function () { if (running && !ws) connect(); });
  refresh();
})(typeof window !== 'undefined' ? window : globalThis);
