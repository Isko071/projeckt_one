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
//   PlatformWalletSync.call(op, args, holdFor, beforeHold) → Promise<{ state, result }>  запрос к серверу напрямую (только в режиме 'server'); holdFor(ответ) — через сколько мс показать новый баланс
//   PlatformWalletSync.blocked(game)      → true, если игра сейчас недоступна: пока ждём сервер, а при серверном балансе — игры, которые пока считают аконы в браузере (сейчас таких нет)
(function (root) {
  var W = root.PlatformWallet, Cloud = root.PlatformCloud, Store = root.PlatformStorage;
  var QKEY = 'platform:wallet-queue', KKEY = 'platform:wallet-server';
  var CALL_MS = 20000, CONNECT_MS = 15000;
  var status = 'local', fns = [], ws = null, uid = null, running = false, flushing = false, pend = {}, seq = 0, retry = 0, retryTimer = null, openTimer = null, lastState = null;
  var queue = [];
  var synced = false;                        // сервер уже ответил на этой странице: до этого число баланса — копия из браузера, и экран показывает его притушенным
  var SERVER_GAMES = ['mines', 'poker-simple', 'poker'];              // игры, которые уже умеют работать на серверном балансе

  var connectingSince = 0, UNREACHABLE_MS = 45000;
  function setStatus(s) {
    if (status === s) return;
    status = s;
    if (s === 'connecting') { connectingSince = Date.now(); setTimeout(function () { if (status === 'connecting') fns.forEach(function (fn) { try { fn(status); } catch (e) { /* подписчик не должен ломать остальных */ } }); }, UNREACHABLE_MS + 100); }
    fns.forEach(function (fn) { try { fn(s); } catch (e) { /* подписчик не должен ломать остальных */ } }); }
  function store(k, d) { try { return Store ? Store.get(k, d) : d; } catch (e) { return d; } }
  function save(k, v) { try { if (Store) Store.set(k, v); } catch (e) { /* без хранилища очередь живёт до перезагрузки */ } }
  // Очередь лежит под ключом игрока: вошёл другой аккаунт в том же браузере, награды предыдущего не уйдут на его счёт
  function qkey() { return QKEY + ':' + uid; }
  function loadQueue() { var q = store(qkey(), []); queue = Array.isArray(q) ? q.filter(function (x) { return x && typeof x.op === 'string'; }).slice(-200) : []; }
  function saveQueue() { if (uid) save(qkey(), queue); }
  // Идентификатор запроса: сервер не применит один и тот же запрос дважды (вторая вкладка, потерянный ответ, повтор из очереди)
  function newRid() {
    try { var a = new Uint32Array(3); root.crypto.getRandomValues(a); return Array.prototype.map.call(a, function (x) { return x.toString(36); }).join('') + Date.now().toString(36); }
    catch (e) { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  }
  function fail(code) { var e = new Error(code); e.code = code; return e; }

  // ---------- Соединение ----------
  function url() { return root.GAME_SERVER_URL; }
  function wanted() { var st = Cloud && Cloud.getState && Cloud.getState(); return !!(st && st.status === 'signedIn' && st.user && url() && root.WebSocket); }

  function connect() {
    if (ws || !running) return;
    var forUid = uid;
    Cloud.getToken().then(function (token) {
      var cur = Cloud.getState().user;
      if (!running || ws || !cur || cur.uid !== forUid) return;       // за время получения токена игрок мог смениться
      var sock;
      try { sock = new root.WebSocket(url()); } catch (e) { scheduleRetry(); return; }
      ws = sock;
      var opened = false;
      openTimer = setTimeout(function () { if (!opened) { try { sock.close(); } catch (e) { /* уже закрыт */ } } }, CONNECT_MS);
      sock.onopen = function () { sock.send(JSON.stringify({ t: 'auth', token: token })); };
      sock.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'ready') { opened = true; clearTimeout(openTimer); onReady(m); }
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
      // tz — часовой пояс игрока: сервер считает дни серии по его часам. seed (только при первой синхронизации) — прогресс игрока, с которого сервер начнёт его кошелёк
      var out = Object.assign({ id: id, t: 'wallet', tz: new Date().getTimezoneOffset() }, msg);
      if (msg.op === 'sync' && W.exportState) { var st = W.exportState(); if (st.streak || st.best || st.playDay || (st.days && st.days.length) || Object.keys(st.wins || {}).length || Object.keys(st.plays || {}).length || st.balance !== W.CONFIG.start) out.seed = st; }
      try { ws.send(JSON.stringify(out)); } catch (e) { delete pend[id]; rej(fail('offline')); }
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
      var item = withSync ? { op: 'sync' } : (queue[0] || null);       // первым всегда sync: только он несёт прогресс устройства (seed) для нового кошелька
      if (!item) return Promise.resolve();
      withSync = false;
      return rawCall(item).then(function (r) {
        if (queue[0] === item) { queue.shift(); saveQueue(); }
        lastState = r.state;
        return next();
      }, function (e) {
        var code = e && e.code;
        if (code === 'bad-request') { if (queue[0] === item) { queue.shift(); saveQueue(); } return next(); }      // сервер такой запрос не принимает: выбрасываем, не зацикливаемся
        // Ошибка самого сервера (не обрыв связи): после нескольких попыток запрос выбрасывается, иначе он блокировал бы всю очередь
        if (code !== 'offline' && code !== 'timeout' && item.rid) { item.tries = (item.tries || 0) + 1; if (item.tries >= 5 && queue[0] === item) { queue.shift(); saveQueue(); return next(); } saveQueue(); }
        throw e;
      });
    }
    return next().then(function () {
      flushing = false;
      if (lastState) { retry = 0; W.applyServer(lastState); setStatus('server'); }
    }, function () {
      flushing = false;
      if (status === 'server') setStatus('connecting');
      // Соединение закрываем: сработает обычное переподключение с паузой и всё продолжится (без этого статус «ждём сервер» оставался бы навсегда)
      try { ws && ws.close(); } catch (e) { /* уже закрыт */ }
    });
  }

  // ---------- Для кошелька ----------
  // Запросы кошелька: в режимах «ждём сервер» и «сервер» становятся в очередь
  // active — серверный баланс работает (add/spend в браузере запрещены); queueing — запросы копятся в очереди и при ожидании сервера
  // (пока неизвестно, включён ли серверный баланс, add/spend ещё запрещать рано)
  var driver = {
    active: function () { return status === 'server'; },
    queueing: function () { return running || status !== 'local'; },
    claim: function (msg) { msg.rid = newRid(); msg.tries = 0; queue.push(msg); if (queue.length > 200) queue.shift(); saveQueue(); if (status === 'server') flush(false); }
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
    ws = null; lastState = null; synced = false;
    setStatus('local');
  }
  function refresh() { if (!wanted()) { if (running) stop(); return; } if (!running || (uid && Cloud.getState().user.uid !== uid)) { if (running) stop(); start(); } }

  var api = {
    status: function () { return status; },
    onStatus: function (fn) { fns.push(fn); },
    start: start, stop: stop,
    // Сервер не отвечает дольше 45 с: игры, которым он нужен, показывают «сервер недоступен» вместо вечного «подключаемся»
    unreachable: function () { return status === 'connecting' && connectingSince > 0 && Date.now() - connectingSince > UNREACHABLE_MS; },
    // Игры, которые пока считают аконы в браузере, при серверном балансе (и пока он неизвестен) недоступны; «Мины» и «Покер» работают на сервере и ждут только ответа
    blocked: function (game) { if (status === 'server') return SERVER_GAMES.indexOf(game) < 0; return status !== 'local'; },
    // holdFor(ответ) → через сколько мс показать на экране новый баланс (игра сначала доигрывает анимацию); 0 или не задано — как обычно
    // beforeHold(ответ) → баланс, который на экране должен стать сразу (например, после ставки), пока выигрыш ещё ждёт конца анимации
    call: function (op, args, holdFor, beforeHold) {
      if (status !== 'server') return Promise.reject(fail('offline'));
      return rawCall(Object.assign({ op: op }, args || {})).then(function (r) {
        var ms = holdFor ? holdFor(r) : 0;
        if (ms > 0 && beforeHold) { var pre = beforeHold(r); if (typeof pre === 'number' && isFinite(pre) && pre >= 0 && pre !== r.state.balance) W.applyServer(Object.assign({}, r.state, { balance: pre })); }
        if (ms > 0 && W.holdShown) W.holdShown(ms);
        W.applyServer(r.state);
        return r;
      });
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
