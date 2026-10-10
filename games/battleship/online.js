// ===== Морской бой онлайн: вход, список столов, комната ожидания, партия за столом на двоих =====
// Подключается после ui.js и использует его функции (esc, tr, render, startGame, themeButtonHtml, headHtml и др.).
// Столом занимается сервер игр (server/, shared/rooms-turns.js): здесь только экраны и контроллер стола в той же форме, что у локальной партии.
// Корабли и оружие соперника до конца партии по сети не приходят: у каждого игрока своя скрытая часть (mine), вид собирает Battleship.withMine.
(function () {
  var Cloud = window.PlatformCloud, P = window.PlatformProfile;
  var on = { screen: 'login', rooms: null, private: false, code: '', busy: false, loginError: null, tableError: null, codeError: null, copied: false, banner: null, invite: null };
  var G = null, wsApi = null, pollTimer = null, roomsTimer = null, failing = 0;

  function now() { return Date.now(); }
  function isOn() { return app.screen === 'online' || (app.screen === 'game' && !!G); }
  function myUid() { var u = Cloud.getState().user; return u ? u.uid : null; }
  var chat = window.PlatformChatUI.create({
    root: appEl,
    getView: function () { return G ? G.view : null; },
    myUid: myUid,
    send: function (text, cid) { return G ? G.room.send({ type: 'chat', text: text, cid: cid }) : false; },
    render: function () { render(); }
  });
  function chatMode(v) { return v && v.status === 'playing' ? 'game' : 'lobby'; }

  // ---------- Сеть ----------
  function stopTimers() {
    [pollTimer, roomsTimer].forEach(function (t) { if (t) clearInterval(t); });
    pollTimer = roomsTimer = null;
  }
  function isOwner() { var u = myUid(); return !!(G && G.view && u && G.view.owner === u); }
  function serverStatus(s) {
    if (!G && !on.busy) return;
    if (s === 'open') { if (on.banner === 'server') on.banner = 'back'; } else on.banner = 'server';
    if (isOn()) render();
  }
  function getRooms() {
    var st = Cloud.getState();
    if (!st.user) return null;
    if (!(window.GAME_SERVER_URL && window.PlatformRoomsWS)) return null;      // игра со скрытыми кораблями возможна только через сервер
    if (!wsApi || wsApi.uid !== st.user.uid) {
      if (wsApi) wsApi.shutdown();
      wsApi = window.PlatformRoomsWS.create({ url: window.GAME_SERVER_URL, getToken: function () { return Cloud.getToken(); }, uid: st.user.uid, engine: window.PlatformTurnRooms, engineEnv: { game: B, gameId: 'battleship' }, game: 'battleship' });
      wsApi.uid = st.user.uid; wsApi.onStatus(serverStatus);
    }
    return wsApi;
  }
  function errorKey(e) {
    var c = e && e.code;
    if (c === 'not-found') return 'notFound';
    if (c === 'full' || c === 'closed' || c === 'started' || c === 'denied' || c === 'missing') return c;
    if (!c || c === 'network' || c === 'offline' || c === 'timeout' || /^http-/.test(c)) return 'network';
    return 'other';
  }
  function loadRooms() {
    var api = getRooms();
    if (!api) { on.rooms = []; on.tableError = 'missing'; if (app.screen === 'online' && on.screen === 'tables') render(); return; }
    api.listRooms().then(function (list) { on.rooms = list; if (app.screen === 'online' && on.screen === 'tables') render(); },
      function (e) { on.rooms = on.rooms || []; on.tableError = errorKey(e); if (app.screen === 'online' && on.screen === 'tables') render(); });
  }
  function openTables() {
    stopTimers();
    on.screen = 'tables'; on.tableError = null; on.codeError = null; on.rooms = null; app.confirm = false; app.rules = false;
    render();
    loadRooms();
    roomsTimer = setInterval(function () { if (app.screen === 'online' && on.screen === 'tables') loadRooms(); }, 5000);
  }
  function flashBack() {
    on.banner = 'back'; render();
    setTimeout(function () { if (on.banner === 'back') { on.banner = null; render(); } }, 3000);
  }

  // ---------- Контроллер стола для экранов боя ----------
  function makeCtrl() {
    var c = {
      online: true,
      view: function () { var v = G && G.view; return B.withMine(v.state, v.mine, v.seat); },
      send: function (a) { return send(a); },
      subscribe: function () { /* перерисовку запускает online.js при каждом новом виде стола */ },
      again: function () { if (isOwner()) G.room.rematch(); else send({ type: 'again' }); },
      leave: function () { dispose(); }
    };
    Object.defineProperty(c, 'seat', { get: function () { return G && G.view ? G.view.seat : 0; } });
    return c;
  }
  function send(action) {
    if (!G) return false;
    var p = G.room.send(action);
    if (p && p.catch) p.catch(function () { on.banner = 'offline'; render(); });
    return true;
  }
  function dispose() {
    var g = G; chat.reset(); stopTimers(); G = null; failing = 0;
    if (g) { try { g.room.leave(); } catch (e) { /* уже закрыт */ } }
    on.banner = null;
  }
  function leaveToTables() {
    dispose();
    app.ctrl = null; app.screen = 'online'; app.confirm = false;
    openTables();
  }

  // Сервер обновляет документ и «пульсом» раз в несколько секунд: без изменений в самой игре экран не перерисовываем
  function signature(v) {
    return JSON.stringify([v.status, v.state, v.members, v.chat, v.mine, v.seat, v.owner, v.closed, v.hostGone, (v.timers || []).map(function (t) { return t.seat + t.stage; }), v.startIn >= 0]);
  }
  function onView(v) {
    if (!G) return;
    G.view = v; failing = 0;
    chat.update(v, chatMode(v));
    var sig = signature(v);
    if (sig === G.sig) return;
    G.sig = sig;
    if (v.closed || v.hostGone) {
      var wasGame = app.screen === 'game' && v.state && v.state.gameOver;
      if (!wasGame) { stopTimers(); chat.reset(); G = null; app.ctrl = null; app.screen = 'online'; on.screen = 'closed'; app.confirm = false; render(); return; }
    }
    if (v.status === 'lobby' && app.screen === 'game') { app.ctrl = null; app.screen = 'online'; on.screen = 'lobby'; on.banner = null; app.confirm = false; }
    if (v.status === 'playing' && v.state && v.seat !== null && v.seat !== undefined && app.screen !== 'game') {
      app.screen = 'online'; startGame(G.ctrl); on.banner = null;
    }
    render();
  }
  function attach(room, code) {
    stopTimers(); chat.reset();
    G = { room: room, view: room.getView(), code: code, ctrl: null };
    G.ctrl = makeCtrl();
    chat.update(G.view, 'lobby');
    room.onChange(onView);
    var poll = function () { room.poll().then(function () { if (failing) { failing = 0; flashBack(); } }, function () { if (++failing >= 3) { on.banner = 'offline'; render(); } }); };
    pollTimer = setInterval(poll, 1000);
    on.busy = false; on.screen = 'lobby'; on.copied = false; on.banner = null; on.tableError = null; app.confirm = false; app.screen = 'online';
    if (G.view) onView(G.view); else render();
  }

  function createTable() {
    var api = getRooms();
    if (!api || on.busy) { if (!api) { on.tableError = 'missing'; render(); } return; }
    on.busy = true; render();
    var prof = P.getProfile();
    api.createRoom({ size: 2, private: on.private, name: prof.name, avatar: prof.avatar }).then(function (res) { attach(res.host, res.code); },
      function (e) { on.busy = false; on.tableError = errorKey(e); on.screen = 'tables'; render(); });
  }
  function joinTable(code) {
    code = String(code || '').toUpperCase().trim();
    if (!/^[A-Z0-9]{5}$/.test(code)) { on.codeError = 'shortCode'; render(); return; }
    var api = getRooms();
    if (!api || on.busy) { if (!api) { on.tableError = 'missing'; render(); } return; }
    on.busy = true; on.codeError = null; render();
    var prof = P.getProfile();
    api.joinRoom(code, { name: prof.name, avatar: prof.avatar }).then(function (room) { attach(room, code); },
      function (e) { on.busy = false; on.tableError = errorKey(e); on.screen = 'tables'; render(); });
  }
  // Ссылка-приглашение вида …/battleship/#K7M4Q: после входа сразу заходим за стол, адрес очищается
  function consumeInvite() {
    var code = on.invite;
    if (!code || !Cloud.getState().user) return;
    on.invite = null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* адрес не обязателен */ }
    on.code = code; joinTable(code);
  }
  function signIn() {
    if (on.busy) return;
    on.busy = true; on.loginError = null; render();
    Cloud.signIn().then(function (r) {
      on.busy = false;
      if (r && r.cancelled) { render(); return; }
      openTables(); consumeInvite();
    }, function (e) {
      on.busy = false;
      var c = e && e.code;
      on.loginError = c === 'auth/unauthorized-domain' ? 'domain' : (c === 'auth/popup-blocked' ? 'popup' : (c === 'unsupported' ? 'unsupported' : 'error'));
      render();
    });
  }

  // ---------- Экраны ----------
  function pageHead(back, title, extra) {
    return '<div class="o-head"><button class="theme-btn" data-act="' + back + '" aria-label="' + esc(tr('o.back')) + '">←</button><h2>' + esc(title) + '</h2>' + (extra || '') + themeButtonHtml('theme-btn') + '</div>';
  }
  function tableErrorHtml() {
    var k = on.tableError;
    if (!k) return '';
    return '<div class="o-msg bad" role="alert"><b>' + esc(tr('o.err.' + k)) + '</b><span>' + esc(tr('o.err.' + k + 'Text')) + '</span></div>';
  }
  function bannerHtml() {
    if (G && !Cloud.getState().user && Cloud.getState().status !== 'unsupported') return '<div class="o-banner bad" role="alert"><span>' + esc(tr('o.banner.relogin')) + '</span><button class="btn-secondary small" data-act="relogin">' + esc(tr('o.banner.reloginBtn')) + '</button></div>';
    if (on.banner) return '<div class="o-banner" role="status"><span>' + esc(tr('o.banner.' + on.banner)) + '</span></div>';
    return '';
  }
  function loginHtml() {
    var st = Cloud.getState(), msg = '';
    if (st.status === 'unsupported') msg = tr('o.login.unsupported');
    else if (on.loginError) msg = tr('o.login.' + on.loginError);
    return '<div class="o-page">' + pageHead('toStart', tr('o.login.title')) +
      '<div class="card o-box"><p class="o-p">' + esc(tr('o.login.text')) + '</p>' +
      '<button class="btn-play" data-act="signin"' + (on.busy || st.status === 'unsupported' ? ' disabled' : '') + '>' + esc(tr(on.busy ? 'o.login.busy' : (on.loginError === 'error' ? 'o.login.retry' : 'o.login.btn'))) + '</button>' +
      (msg ? '<p class="o-err" role="alert">' + esc(msg) + '</p>' : '') +
      '<button class="btn-secondary wide" data-act="toStart">' + esc(tr('o.back')) + '</button></div></div>';
  }
  function tablesHtml() {
    var rooms = on.rooms, list;
    if (rooms === null) list = '<div class="card o-box" role="status" aria-label="' + esc(tr('o.tables.loading')) + '">' + [1, 2, 3].map(function () { return '<div class="o-row skel"><i class="av"></i><i class="ln"></i></div>'; }).join('') + '</div>';
    else if (!rooms.length) list = '<div class="o-dashed">' + esc(tr('o.tables.empty')) + '</div>';
    else list = '<div class="card o-box"><h3>' + esc(tr('o.tables.open')) + '</h3>' + rooms.map(function (r) {
      return '<div class="o-row"><span class="av">' + esc(P.initial(r.hostName)) + '</span><span class="who"><b>' + esc(r.hostName || r.code) + '</b></span>' +
        '<button class="btn-secondary small" data-act="joinRoom" data-v="' + esc(r.code) + '">' + esc(tr('o.tables.join')) + '</button></div>';
    }).join('') + '</div>';
    var prof = P.getProfile();
    return '<div class="o-page">' + pageHead('toStart', tr('o.tables.title'), '<span class="o-you"><span class="av">' + esc(P.initial(prof.name)) + '</span>' + esc(prof.name) + '</span>') +
      tableErrorHtml() +
      '<button class="btn-play" data-act="toCreate">' + esc(tr('o.tables.create')) + '</button>' +
      '<div class="card o-box"><h3>' + esc(tr('o.tables.codeTitle')) + '</h3><div class="o-code-row">' +
        '<input class="name-input o-code" id="ocode" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="5" value="' + esc(on.code) + '" aria-label="' + esc(tr('o.tables.codeLabel')) + '" placeholder="•••••">' +
        '<button class="btn-secondary small" data-act="paste">' + esc(tr('o.tables.paste')) + '</button></div>' +
        (on.codeError ? '<p class="o-err" role="alert">' + esc(tr('o.err.' + (on.codeError === 'shortCode' ? 'shortCode' : 'notFound'))) + '</p>' : '') +
        '<button class="btn-secondary wide" data-act="joinCode"' + (on.busy ? ' disabled' : '') + '>' + esc(tr('o.tables.join')) + '</button></div>' + list + '</div>';
  }
  function createHtml() {
    return '<div class="o-page">' + pageHead('toTables', tr('o.create.title')) +
      '<button class="mode-btn o-mode" data-act="private" aria-pressed="' + on.private + '"><b>' + esc(tr('o.create.private')) + '</b><small>' + esc(tr(on.private ? 'o.create.privateSub' : 'o.create.privateOff')) + '</small></button>' +
      tableErrorHtml() +
      '<button class="btn-play" data-act="create"' + (on.busy ? ' disabled' : '') + '>' + esc(tr(on.busy ? 'o.create.busy' : 'o.create.btn')) + '</button>' +
      '<button class="btn-secondary wide" data-act="toTables">' + esc(tr('o.back')) + '</button></div>';
  }
  function lobbyHtml() {
    var v = G && G.view, host = isOwner(), members = v ? v.members : [], size = v ? v.size : 2;
    var seats = members.map(function (m) {
      return '<div class="o-seat"><span class="av" style="background:' + P.avatarColor(m.avatar) + '">' + esc(P.initial(m.name)) + '</span><span class="nm">' + esc(m.name || tr('o.lobby.you')) + '</span><span class="tg">' + esc(v.owner === m.uid ? tr('o.lobby.creator') : '') + '</span></div>';
    });
    for (var i = members.length; i < size; i++) seats.push('<div class="o-seat empty"><span class="av">·</span><span class="nm">' + esc(tr('o.lobby.waiting')) + '</span></div>');
    var startLeft = v && v.startIn >= 0 ? Math.max(0, v.startIn - (now() - (v.receivedAt || now()))) : -1;
    var canStart = members.length >= B.CONFIG.minSeats && startLeft === 0;
    var autoHtml = startLeft > 0 ? '<div class="o-hint" role="status"><b>' + esc(tr('o.lobby.startIn', { n: Math.ceil(startLeft / 1000) })) + '</b></div>' : '';
    return '<div class="o-page"><div class="o-head"><button class="theme-btn" data-act="leaveLobby" aria-label="' + esc(tr('o.lobby.leave')) + '">←</button><h2>' + esc(tr('o.lobby.title')) + '</h2>' + themeButtonHtml('theme-btn') + '</div>' +
      '<div class="card o-box o-center"><small>' + esc(tr('o.lobby.code')) + '</small><div class="o-bigcode">' + esc(G ? G.code : '') + '</div>' +
        (v && v.private ? '<div class="o-mode-tag"><b>' + esc(tr('o.lobby.private')) + '</b></div>' : '') +
        '<div class="o-btns"><button class="btn-secondary small" data-act="copyCode">' + esc(tr(on.copied ? 'o.lobby.copied' : 'o.lobby.copy')) + '</button>' +
        '<button class="btn-secondary small" data-act="shareLink">' + esc(tr('o.lobby.share')) + '</button></div></div>' +
      '<div class="o-seats">' + seats.join('') + '</div>' + autoHtml + chat.panelHtml({ mode: 'lobby' }) + bannerHtml() +
      (host
        ? '<div class="o-btns"><button class="btn-play" style="flex:2" data-act="start"' + (canStart ? '' : ' disabled') + '>' + esc(tr('o.lobby.start')) + '</button><button class="btn-secondary wide" style="flex:1" data-act="leaveLobby">' + esc(tr('o.lobby.leave')) + '</button></div>' +
          '<div class="o-hint">' + esc(tr(members.length >= B.CONFIG.minSeats ? 'o.lobby.hint' : 'o.lobby.needMore')) + '</div>'
        : '<div class="o-p o-center"><b>' + esc(tr('o.lobby.waitHost')) + '</b></div><button class="btn-secondary wide" data-act="leaveLobby">' + esc(tr('o.lobby.leave')) + '</button>') + '</div>';
  }
  function messageHtml() {
    return '<div class="o-page"><div class="o-msg bad" role="alert"><b>' + esc(tr('o.err.gone')) + '</b>' +
      '<button class="btn-play" data-act="toTables">' + esc(tr('o.err.toTables')) + '</button></div></div>';
  }
  function html() {
    switch (on.screen) {
      case 'login': return loginHtml();
      case 'tables': return tablesHtml();
      case 'create': return createHtml();
      case 'lobby': return lobbyHtml();
      case 'closed': return messageHtml();
    }
    return '';
  }

  // Мой таймер неактивности: {stage: 'asking', ms} — вопрос «Вы ещё играете?»
  function myTimer() {
    var v = G && G.view, i;
    if (!v || v.seat === null || v.seat === undefined) return null;
    for (i = 0; i < (v.timers || []).length; i++) if (v.timers[i].seat === v.seat) return v.timers[i];
    return null;
  }
  function askHtml() {
    var v = G && G.view, t = myTimer();
    if (!v || !v.state || v.state.gameOver || !t || t.stage !== 'asking') return '';
    var left = Math.max(0, Math.ceil((t.ms - (now() - (v.receivedAt || now()))) / 1000));
    return '<div class="scrim"><div class="modal" role="alertdialog" aria-modal="true"><h2>' + esc(tr('o.ask.title')) + '</h2>' +
      '<div class="o-ask"><b>' + left + '</b><span>' + esc(tr('o.ask.secs')) + '</span></div>' +
      '<div class="row"><button class="btn primary" data-act="here">' + esc(tr('o.ask.yes')) + '</button><button class="btn" data-act="concede">' + esc(tr('o.ask.leave')) + '</button></div></div></div>';
  }
  function overlayHtml() {
    if (!G || !isOn()) return '';
    if (app.screen === 'game') return chat.panelHtml({ mode: 'game', myTurn: !!(G.view.state && G.view.state.current === G.view.seat) }) + chat.extraHtml();
    return '';
  }

  function enter() {
    app.screen = 'online'; app.confirm = false; app.rules = false;
    if (window.PlatformRoomsWS && window.GAME_SERVER_URL) window.PlatformRoomsWS.warm(window.GAME_SERVER_URL);
    if (Cloud.getState().user) openTables(); else { on.screen = 'login'; on.loginError = null; render(); }
  }

  function click(el) {
    var act = el.getAttribute('data-act'), v = el.getAttribute('data-v');
    switch (act) {
      case 'play': enter(); return true;
      case 'signin': signIn(); return true;
      case 'relogin': Cloud.signIn().then(function () { render(); }, function () { render(); }); return true;
      case 'toStart': stopTimers(); app.screen = 'start'; on.busy = false; on.tableError = null; render(); return true;
      case 'toTables': if (G) dispose(); app.ctrl = null; openTables(); return true;
      case 'toCreate': on.screen = 'create'; on.tableError = null; render(); return true;
      case 'private': on.private = !on.private; render(); return true;
      case 'create': createTable(); return true;
      case 'joinRoom': on.code = v; joinTable(v); return true;
      case 'joinCode': joinTable(on.code); return true;
      case 'paste':
        if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(function (t) { on.code = String(t || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5); on.codeError = null; render(); }, function () { /* буфер недоступен */ });
        return true;
      case 'copyCode':
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(G ? G.code : '').then(function () { on.copied = true; render(); }, function () { /* без буфера */ });
        return true;
      case 'shareLink': {
        var url = location.href.split('#')[0] + '#' + (G ? G.code : '');
        if (navigator.share) navigator.share({ url: url }).catch(function () { /* отменено */ });
        else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { on.copied = true; render(); }, function () { /* без буфера */ });
        return true;
      }
      case 'start': if (isOwner()) G.room.start(); return true;
      case 'leaveLobby': leaveToTables(); return true;
      case 'here': send({ type: 'here' }); return true;
    }
    return false;
  }

  appEl.addEventListener('input', function (e) {
    if (e.target.id === 'ocode') {
      var clean = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5);
      on.code = clean; on.codeError = null;
      if (e.target.value !== clean) e.target.value = clean;
    }
  });
  appEl.addEventListener('keydown', function (e) { if (e.target.id === 'ocode' && e.key === 'Enter') { e.preventDefault(); joinTable(on.code); } });
  window.addEventListener('pagehide', function () { if (G) { try { G.room.leave(); } catch (e) { /* закрываем страницу */ } } });
  Cloud.onChange(function () {
    if (app.screen !== 'online') return;
    if (on.screen === 'login' && Cloud.getState().status === 'signedIn' && !on.busy) { openTables(); consumeInvite(); }
    else if (on.screen === 'login' || on.screen === 'tables' || G) render();
  });
  // Обратный отсчёт в зале ожидания и в вопросе «Вы ещё играете?»
  setInterval(function () {
    if (!G) return;
    if ((app.screen === 'online' && on.screen === 'lobby') || (app.screen === 'game' && myTimer() && myTimer().stage === 'asking')) render();
  }, 1000);

  window.BattleshipOnline = {
    enter: enter, html: html, click: click, askHtml: askHtml, overlayHtml: overlayHtml, bannerHtml: bannerHtml,
    chatButtonHtml: function () { return G ? chat.buttonHtml() : ''; },
    afterRender: function () { chat.afterRender(); },
    active: function () { return app.screen === 'online'; }
  };
  // Ссылка вида …/battleship/#K7M4Q сразу ведёт на вход в стол
  (function () {
    var hash = (location.hash || '').replace('#', '').toUpperCase();
    if (/^[A-Z0-9]{5}$/.test(hash)) { on.invite = hash; on.code = hash; enter(); if (Cloud.getState().user) consumeInvite(); }
  })();
})();
