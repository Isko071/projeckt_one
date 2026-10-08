// ===== Ятзи онлайн: вход, столы, комната ожидания, игра за столом на 2–6 игроков =====
// Подключается после ui.js и использует его функции (esc, tr, render, catalogLinkHtml, themeButtonHtml, morph и др.).
// Все надписи берутся из словаря (games/yahtzee/ru.js). Правила и логика стола: table.js, комнаты: shared/rooms-turns.js, docs/online-tables.md.
(function () {
  var Cloud = window.PlatformCloud, T = window.YahtzeeTable, P = window.PlatformProfile;
  var DIE_FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  var on = {
    screen: 'login', rooms: null, size: 4, mode: 'sync', code: '', busy: false, loginError: null, tableError: null, codeError: null,
    copied: false, banner: null, pending: false, held: [false, false, false, false, false], heldKey: '', notice: null, noticeUntil: 0, openSheets: {}
  };
  var G = null, roomsApi = null, hostTimer = null, pollTimer = null, roomsTimer = null;

  function now() { return Date.now(); }
  function mine() { return G && G.view && G.view.state && G.view.seat !== null && G.view.seat !== undefined ? G.view.state.players[G.view.seat] : null; }
  function notify(text, ms) { on.notice = text; on.noticeUntil = now() + (ms || 4000); }
  function activeNotice() { if (on.notice && now() > on.noticeUntil) on.notice = null; return on.notice; }

  // ---------- Сеть ----------
  function stopTimers() {
    [hostTimer, pollTimer, roomsTimer].forEach(function (t) { if (t) clearInterval(t); });
    hostTimer = pollTimer = roomsTimer = null;
  }
  function getRooms() {
    var st = Cloud.getState();
    if (!st.user) return null;
    roomsApi = window.PlatformTurnRooms.create({
      fetch: function (u, i) { return window.fetch(u, i); }, getToken: function () { return Cloud.getToken(); }, uid: st.user.uid,
      projectId: window.FIREBASE_CONFIG.projectId, db: window.FIREBASE_DATABASE, game: T, gameId: 'yahtzee'
    });
    return roomsApi;
  }
  function errorKey(e) {
    var c = e && e.code;
    if (c === 'not-found') return 'notFound';
    if (c === 'full') return 'full';
    if (c === 'closed') return 'closed';
    if (c === 'started') return 'started';
    if (c === 'denied') return 'denied';
    if (c === 'missing') return 'missing';
    if (!c || c === 'network' || /^http-/.test(c)) return 'network';
    return 'other';
  }
  function loadRooms() {
    var api = getRooms();
    if (!api) return;
    api.listRooms().then(function (list) { on.rooms = list; if (isOn() && on.screen === 'tables') render(); }, function (e) { on.rooms = on.rooms || []; if (e && (e.code === 'missing' || e.code === 'denied')) on.tableError = errorKey(e); if (isOn() && on.screen === 'tables') render(); });
  }
  function openTables() {
    stopTimers();
    on.screen = 'tables'; on.tableError = null; on.codeError = null; on.rooms = null; app.modal = null;
    render();
    loadRooms();
    roomsTimer = setInterval(function () { if (isOn() && on.screen === 'tables') loadRooms(); }, 5000);
  }
  function isOn() { return app.screen === 'online'; }

  function backOnline() {
    on.banner = 'back'; render();
    setTimeout(function () { if (on.banner === 'back') { on.banner = null; render(); } }, 3000);
  }

  function onView(v) {
    if (!G) return;
    G.view = v; on.pending = false;
    if (v.closed || v.hostGone) { stopTimers(); on.closedReason = v.hostGone ? 'hostGone' : 'closed'; G = null; on.screen = 'closed'; app.modal = null; render(); return; }
    if (v.status === 'playing' && v.state) {
      if (on.screen === 'lobby') { on.screen = 'game'; window.PlatformWallet.markPlayed(); on.banner = null; on.held = [false, false, false, false, false]; if (G.role === 'host') notify(tr('online.creatorNote'), 6000); }
      var me = v.seat, p = v.state.players[me];
      if (me === null || me === undefined || !p || !p.active) {
        if (!v.state.gameOver && !G.left) { G.left = true; stopTimers(); if (G.role === 'player') G.ctrl.stop(); G = null; on.screen = 'out'; app.modal = null; }
      } else {
        var key = T.progressKey(v.state, me);
        if (key !== on.heldKey) { on.heldKey = key; on.held = p.held.slice(); }
        if (v.state.gameOver && !G.counted) { G.counted = true; app.modal = null; }
      }
    }
    render();
  }

  function createTable() {
    var api = getRooms();
    if (!api || on.busy) return;
    on.busy = true; render();
    var prof = P.getProfile();
    api.createRoom({ size: on.size, mode: on.mode, name: prof.name, avatar: prof.avatar }).then(function (res) {
      stopTimers();
      var host = res.host, failing = 0;
      G = { role: 'host', ctrl: host, view: host.getView(), code: res.code };
      host.onChange(onView);
      hostTimer = setInterval(function () {
        host.tick().then(function () { if (failing) { failing = 0; backOnline(); } }, function () { if (++failing >= 3) { on.banner = 'offline'; render(); } });
      }, 1000);
      on.busy = false; on.screen = 'lobby'; on.copied = false; on.banner = null; app.modal = null;
      render();
    }, function (e) { on.busy = false; on.tableError = errorKey(e); on.screen = 'tables'; render(); });
  }
  function joinTable(code) {
    code = String(code || '').toUpperCase().trim();
    if (!/^[A-Z0-9]{5}$/.test(code)) { on.codeError = 'shortCode'; render(); return; }
    var api = getRooms();
    if (!api || on.busy) return;
    on.busy = true; on.codeError = null; render();
    var prof = P.getProfile();
    api.joinRoom(code, { name: prof.name, avatar: prof.avatar }).then(function (ctrl) {
      stopTimers();
      var failing = 0;
      G = { role: 'player', ctrl: ctrl, view: null, code: code };
      ctrl.onChange(onView);
      var poll = function () { ctrl.poll().then(function () { if (failing) { failing = 0; backOnline(); } }, function () { if (++failing >= 3) { on.banner = 'offline'; render(); } }); };
      pollTimer = setInterval(poll, 1000); poll();
      on.busy = false; on.screen = 'lobby'; on.banner = null; on.tableError = null; app.modal = null;
      render();
    }, function (e) { on.busy = false; on.tableError = errorKey(e); render(); });
  }
  function send(action) {
    if (!G) return;
    G.lastAction = now();
    if (G.role === 'host') { G.ctrl.send(action); G.ctrl.tick().catch(function () { /* повторит таймер */ }); render(); return; }
    on.pending = true; render();
    G.ctrl.send(action).catch(function () { on.pending = false; on.banner = 'offline'; render(); });
  }
  function leaveGame(toScreen) {
    var g = G;
    stopTimers();
    G = null;
    if (g) { if (g.role === 'host') g.ctrl.close(); else g.ctrl.leave(); }
    app.modal = null; on.banner = null; on.pending = false;
    if (toScreen === 'tables') openTables(); else { app.screen = 'start'; render(); }
  }
  function signIn() {
    if (on.busy) return;
    on.busy = true; on.loginError = null; render();
    Cloud.signIn().then(function (r) {
      on.busy = false;
      if (r && r.cancelled) { render(); return; }
      var hash = (location.hash || '').replace('#', '').toUpperCase();
      if (/^[A-Z0-9]{5}$/.test(hash)) { on.code = hash; openTables(); joinTable(hash); return; }
      openTables();
    }, function (e) {
      on.busy = false;
      var c = e && e.code;
      on.loginError = c === 'auth/unauthorized-domain' ? 'domain' : (c === 'auth/popup-blocked' ? 'popup' : (c === 'unsupported' ? 'unsupported' : 'error'));
      render();
    });
  }

  // ---------- Экраны входа ----------
  function pageHead(back, title, extra) {
    return '<div class="o-head"><button class="theme-btn" data-act="' + back + '" data-key="back" aria-label="' + esc(tr('online.back')) + '">←</button><h2>' + esc(title) + '</h2>' + (extra || '') + themeButtonHtml() + '</div>';
  }
  function modeName(m) { return tr(m === 'sync' ? 'online.modeSync' : 'online.modeTurns'); }

  function loginHtml() {
    var st = Cloud.getState(), msg = '';
    if (st.status === 'unsupported') msg = tr('online.login.unsupported');
    else if (on.loginError) msg = tr('online.login.' + on.loginError);
    return '<div class="o-page">' + pageHead('toStart', tr('online.login.title')) +
      '<div class="card o-box"><p class="o-p">' + esc(tr('online.login.text')) + '</p>' +
      '<button class="btn-play" data-act="signin" data-key="signin"' + (on.busy || st.status === 'unsupported' ? ' disabled' : '') + '>' + esc(tr(on.busy ? 'online.login.busy' : (on.loginError === 'error' ? 'online.login.retry' : 'online.login.btn'))) + '</button>' +
      (msg ? '<p class="o-err" role="alert">' + esc(msg) + '</p>' : '') +
      '<button class="btn-secondary wide" data-act="toStart" data-key="loginBack">' + esc(tr('online.back')) + '</button></div></div>';
  }

  function tableErrorHtml() {
    var k = on.tableError;
    if (!k) return '';
    return '<div class="o-msg bad" role="alert"><b>' + esc(tr('online.err.' + k)) + '</b><span>' + esc(tr('online.err.' + k + 'Text')) + '</span></div>';
  }

  function tablesHtml() {
    var rooms = on.rooms, list;
    if (rooms === null) list = '<div class="card o-box" role="status" aria-label="' + esc(tr('online.tables.loading')) + '">' + [1, 2, 3].map(function (k) { return '<div class="o-row skel" data-key="sk' + k + '"><i class="av"></i><i class="ln"></i></div>'; }).join('') + '</div>';
    else if (!rooms.length) list = '<div class="o-dashed">' + esc(tr('online.tables.empty')) + '</div>';
    else list = '<div class="card o-box"><h3>' + esc(tr('online.tables.open')) + '</h3>' + rooms.map(function (r) {
      return '<div class="o-row" data-key="room-' + esc(r.code) + '"><span class="av">' + esc(P.initial(r.hostName)) + '</span><span class="who"><b>' + esc(r.hostName || r.code) + '</b><small>' +
        esc(tr('online.tables.of', { n: r.players, m: r.size })) + ' · ' + esc(modeName(r.mode)) + '</small></span>' +
        '<button class="btn-secondary small" data-act="joinRoom" data-v="' + esc(r.code) + '">' + esc(tr('online.tables.join')) + '</button></div>';
    }).join('') + '</div>';
    var prof = P.getProfile();
    return '<div class="o-page">' + pageHead('toStart', tr('online.tables.title'), '<span class="o-you"><span class="av">' + esc(P.initial(prof.name)) + '</span>' + esc(tr('online.tables.you', { name: prof.name })) + '</span>') +
      tableErrorHtml() +
      '<button class="btn-play" data-act="toCreate" data-key="create">' + esc(tr('online.tables.create')) + '</button>' +
      '<div class="card o-box"><h3>' + esc(tr('online.tables.codeTitle')) + '</h3><div class="o-code-row">' +
        '<input class="name-input o-code" id="ocode" data-key="code" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="5" value="' + esc(on.code) + '" aria-label="' + esc(tr('online.tables.codeLabel')) + '" placeholder="•••••">' +
        '<button class="btn-secondary small" data-act="paste" data-key="paste">' + esc(tr('online.tables.paste')) + '</button></div>' +
        (on.codeError ? '<p class="o-err" role="alert">' + esc(tr(on.codeError === 'shortCode' ? 'online.err.shortCode' : 'online.err.notFound')) + '</p>' : '') +
        '<button class="btn-secondary wide" data-act="joinCode" data-key="joinCode"' + (on.busy ? ' disabled' : '') + '>' + esc(tr('online.tables.join')) + '</button></div>' + list + '</div>';
  }

  function createHtml() {
    var n = on.size, seats = '';
    for (var i = 0; i < n; i++) seats += '<span class="o-pv-seat' + (i === 0 ? ' me' : '') + '">' + esc(i === 0 ? tr('online.create.you') : '?') + '</span>';
    return '<div class="o-page">' + pageHead('toTables', tr('online.create.title')) +
      '<div class="o-field"><div class="field-title">' + esc(tr('online.create.seats')) + '</div><div class="o-seg" role="group" aria-label="' + esc(tr('online.create.seats')) + '">' +
        [2, 3, 4, 5, 6].map(function (k) { return '<button data-act="size" data-v="' + k + '" data-key="size' + k + '" aria-pressed="' + (on.size === k) + '">' + k + '</button>'; }).join('') + '</div>' +
        '<div class="o-pv" aria-hidden="true">' + seats + '</div></div>' +
      '<div class="o-field"><div class="field-title">' + esc(tr('online.create.mode')) + '</div>' +
        ['sync', 'turns'].map(function (m) {
          return '<button class="mode-btn o-mode" data-act="setMode" data-v="' + m + '" data-key="mode-' + m + '" aria-pressed="' + (on.mode === m) + '"><b>' + esc(modeName(m)) + '</b><small>' + esc(tr('online.create.' + m + 'Sub')) + '</small></button>';
        }).join('') + '</div>' +
      tableErrorHtml() +
      '<button class="btn-play" data-act="create" data-key="createGo"' + (on.busy ? ' disabled' : '') + '>' + esc(tr(on.busy ? 'online.create.busy' : 'online.create.btn')) + '</button>' +
      '<button class="btn-secondary wide" data-act="toTables" data-key="createBack">' + esc(tr('online.back')) + '</button></div>';
  }

  function lobbyHtml() {
    var v = G && G.view, host = G && G.role === 'host', myUid = Cloud.getState().user && Cloud.getState().user.uid;
    var members = v ? v.members : [], size = v ? v.size : on.size, mode = v ? v.mode : on.mode;
    var seats = members.map(function (m) {
      var tags = [];
      if (m.uid === myUid) tags.push(tr('online.lobby.you'));
      if (m.seat === 0) tags.push(tr('online.lobby.creator'));
      return '<div class="o-seat" data-key="m-' + esc(m.uid) + '"><span class="av" style="background:' + P.avatarColor(m.avatar) + '">' + esc(P.initial(m.name)) + '</span><span class="nm">' + esc(m.name || tr('online.lobby.you')) + '</span><span class="tg">' + esc(tags.join(' · ')) + '</span></div>';
    });
    for (var i = members.length; i < size; i++) seats.push('<div class="o-seat empty" data-key="e-' + i + '"><span class="av">·</span><span class="nm">' + esc(tr('online.lobby.waiting')) + '</span></div>');
    var canStart = members.length >= T.CONFIG.minSeats;
    return '<div class="o-page"><div class="o-head"><h2>' + esc(tr('online.lobby.title')) + '</h2>' + themeButtonHtml() + '</div>' +
      '<div class="card o-box o-center"><small>' + esc(tr('online.lobby.code')) + '</small><div class="o-bigcode" data-key="codeBig">' + esc(G ? G.code : '') + '</div>' +
        '<div class="o-mode-tag">' + esc(modeName(mode)) + ' · ' + esc(tr('online.lobby.seats', { n: size })) + '</div>' +
        '<div class="o-btns"><button class="btn-secondary small" data-act="copyCode" data-key="copy">' + esc(tr(on.copied ? 'online.lobby.copied' : 'online.lobby.copy')) + '</button>' +
        '<button class="btn-secondary small" data-act="shareLink" data-key="share">' + esc(tr('online.lobby.share')) + '</button></div></div>' +
      '<div class="o-seats">' + seats.join('') + '</div>' +
      bannerHtml() +
      (host
        ? '<div class="o-btns"><button class="btn-play" style="flex:2" data-act="start" data-key="start"' + (canStart ? '' : ' disabled') + '>' + esc(tr('online.lobby.start')) + '</button><button class="btn-secondary wide" style="flex:1" data-act="closeTable" data-key="closeTable">' + esc(tr('online.lobby.close')) + '</button></div>' +
          '<div class="o-hint">' + esc(tr(canStart ? 'online.lobby.hostHint' : 'online.lobby.needMore')) + '</div>'
        : '<div class="o-p o-center"><b>' + esc(tr(members.length >= size ? 'online.lobby.full' : 'online.lobby.waitHost')) + '</b></div><button class="btn-secondary wide" data-act="leaveLobby" data-key="leaveLobby">' + esc(tr('online.lobby.leave')) + '</button>') +
      '</div>';
  }

  function messageHtml(titleKey, textKey, btnKey) {
    return '<div class="o-page"><div class="o-msg bad" role="alert"><b>' + esc(tr(titleKey)) + '</b>' + (textKey ? '<span>' + esc(tr(textKey)) + '</span>' : '') +
      '<button class="btn-play" data-act="toTables" data-key="msgBtn">' + esc(tr(btnKey)) + '</button></div></div>';
  }

  function bannerHtml() {
    var user = Cloud.getState().user;
    if (G && !user && Cloud.getState().status !== 'unsupported') return '<div class="o-banner bad" role="alert"><span>' + esc(tr('online.banner.relogin')) + '</span><button class="btn-secondary small" data-act="relogin" data-key="relogin">' + esc(tr('online.banner.reloginBtn')) + '</button></div>';
    if (on.banner === 'offline') return '<div class="o-banner" role="status"><span>' + esc(tr('online.banner.offline')) + '</span></div>';
    if (on.banner === 'back') return '<div class="o-banner" role="status"><span>' + esc(tr('online.banner.back')) + '</span></div>';
    return '';
  }

  // ---------- Игра за столом ----------
  function timerFor(seat) {
    var v = G.view, t = (v.timers || []).filter(function (x) { return x.seat === seat; })[0];
    if (!t) return null;
    var cfg = window.PlatformTurnRooms.DEFAULTS;
    var left = Math.max(0, t.ms - (G.role === 'player' ? now() - v.receivedAt : 0));
    return { stage: t.stage, left: left, total: t.stage === 'idle' ? cfg.idleMs : cfg.askMs, sec: Math.ceil(left / 1000) };
  }
  function filledCount(p) { return Yahtzee.CATEGORIES.length - Yahtzee.openCategories(p).length; }

  function seatStatus(st, i) {
    var p = st.players[i];
    if (!p.active) return tr('online.st.left');
    if (st.gameOver) return tr('online.st.finished');
    var tm = timerFor(i);
    if (tm && tm.stage === 'asking') return tr('online.st.silent');
    if (st.mode === 'turns') {
      if (st.current === i) return tm && tm.stage === 'idle' && tm.left < 15000 ? tr('online.st.thinksSec', { n: tm.sec }) : tr('online.st.rolls', { n: p.rollsUsed });
      return tr('online.st.waits');
    }
    if (p.done) return tr('online.st.scored');
    return p.rollsUsed ? tr('online.st.rolls', { n: p.rollsUsed }) : tr('online.st.thinks');
  }
  function miniDice(p) {
    if (!p.rollsUsed) return '';
    return '<span class="o-mini" aria-hidden="true">' + p.dice.map(function (d) { return DIE_FACE[d]; }).join('') + '</span>';
  }

  function playersHtml(st, me) {
    return '<div class="o-players" role="list">' + st.players.map(function (p, i) {
      var cur = st.mode === 'turns' ? st.current === i : (p.active && !p.done && !st.gameOver);
      return '<div class="o-pl' + (i === me ? ' me' : '') + (cur ? ' cur' : '') + (p.active ? '' : ' gone') + '" role="listitem" data-key="pl' + i + '">' +
        '<span class="n">' + esc(p.name || tr('online.lobby.you')) + (i === me ? ' <small>' + esc(tr('online.lobby.you')) + '</small>' : '') + '</span><b>' + Yahtzee.totalScore(p) + '</b>' +
        '<span class="s">' + esc(seatStatus(st, i)) + '</span>' + (p.active && !st.gameOver && (st.mode === 'sync' || cur) ? miniDice(p) : '') + '</div>';
    }).join('') + '</div>';
  }

  function statusLine(st, me, p) {
    if (st.gameOver) return tr('online.over.title');
    if (on.pending) return tr('online.sent');
    if (on.banner === 'offline') return tr('online.waitConn');
    if (st.mode === 'turns') {
      if (st.current !== me) return tr('online.turnOf', { name: st.players[st.current] ? st.players[st.current].name : '' });
    } else if (p.done) {
      var wait = st.players.filter(function (q, i) { return q.active && !q.done; }).length;
      return tr('online.waitOthers', { n: wait });
    }
    if (p.rollsUsed === 0) return tr('status.first');
    if (p.rollsUsed >= Yahtzee.MAX_ROLLS) return tr('status.pick');
    return tr('status.holdOrRoll');
  }

  function diceHtml(p, canAct) {
    var fresh = p.rollsUsed === 0, canToggle = canAct && p.rollsUsed > 0 && p.rollsUsed < Yahtzee.MAX_ROLLS && !on.pending;
    return p.dice.map(function (v, i) {
      var held = canToggle || (canAct && p.rollsUsed > 0) ? on.held[i] : p.held[i];
      var dieLabel = fresh ? tr('die.fresh', { n: i + 1 }) : tr(held ? 'die.held' : 'die.value', { n: i + 1, v: v });
      var pips = '';
      for (var k = 0; k < 9; k++) pips += '<span><i class="' + (!fresh && PIPS[v].indexOf(k) >= 0 ? 'on' : (fresh && k === 4 ? 'ph' : '')) + '"></i></span>';
      return '<button class="die-btn" data-key="die-' + i + '" data-odie="' + i + '" aria-pressed="' + !!held + '" aria-label="' + esc(dieLabel) + '"' + (canToggle ? '' : ' disabled') + '>' +
        '<span class="die' + (fresh ? ' fresh' : '') + (held ? ' held' : '') + '">' + pips + '</span><span class="die-tag">' + (held ? esc(tr('die.tag')) : '') + '</span></button>';
    }).join('');
  }

  // Таблица очков: колонка игрока (с подсказками) и колонки остальных
  function sheetHtml(st, me, canAct) {
    var order = [me].concat(st.players.map(function (_, i) { return i; }).filter(function (i) { return i !== me; }));
    var p = st.players[me], cols = 'minmax(104px,1fr) 80px' + (order.length > 1 ? ' repeat(' + (order.length - 1) + ', 60px)' : '');
    var allowed = canAct && p.rollsUsed > 0 && !on.pending ? Yahtzee.allowedCategories(p, p.dice) : null, best = null, bestPts = 0;
    if (allowed) allowed.forEach(function (c) { var pts = Yahtzee.possibleScore(p, c, p.dice); if (pts > bestPts) { bestPts = pts; best = c; } });
    function cell(pi, cat) {
      var q = st.players[pi], v = q.scores[cat], name = label(cat);
      if (v !== null) return '<span class="cell filled' + (v === 0 ? ' zero' : '') + '" aria-label="' + esc(tr('cell.filled', { name: name, v: v })) + '">' + v + '</span>';
      if (pi === me && allowed) {
        if (allowed.indexOf(cat) >= 0) {
          var pts = Yahtzee.possibleScore(p, cat, p.dice);
          return '<button class="cell hint' + (cat === best ? ' best' : '') + '" data-key="cat-' + cat + '" data-ocat="' + cat + '" aria-label="' + esc(tr('cell.write', { name: name, v: pts })) + '">' + pts + '</button>';
        }
        return '<span class="cell blocked" aria-label="' + esc(tr('cell.blocked', { name: name })) + '">—</span>';
      }
      return '<span class="cell" aria-label="' + esc(tr('cell.empty', { name: name })) + '"></span>';
    }
    function row(cls, lab, sub, cells) { return '<div class="grid row ' + cls + '" style="grid-template-columns:' + cols + '"><span class="label">' + lab + (sub ? '<small>' + sub + '</small>' : '') + '</span>' + cells + '</div>'; }
    function info(fn) { return order.map(function (i) { return fn(st.players[i]); }).join(''); }
    var head = '<div class="grid sheet-head" style="grid-template-columns:' + cols + '"><span></span>' + order.map(function (i) {
      return '<span class="head-name' + (i === me ? ' current' : '') + '">' + esc(st.players[i].name || '') + '</span>';
    }).join('') + '</div>';
    var html = head + row('section', esc(tr('sheet.upper')), '', '');
    Yahtzee.UPPER.forEach(function (cat) { html += row('', esc(label(cat)), SUBS[cat], order.map(function (i) { return cell(i, cat); }).join('')); });
    html += row('info', esc(tr('sheet.sum')), '', info(function (q) { return plainCell(Yahtzee.upperSum(q), 'muted'); }));
    html += row('info', esc(tr('sheet.bonus')), '', info(function (q) { var u = Yahtzee.upperSum(q); return u >= 63 ? plainCell('+35', 'accent') : plainCell(u + '/63', 'muted'); }));
    html += row('section', esc(tr('sheet.lower')), '', '');
    Yahtzee.LOWER.forEach(function (cat) { html += row('', esc(label(cat)), SUBS[cat], order.map(function (i) { return cell(i, cat); }).join('')); });
    html += row('info top-line', esc(tr('sheet.yahtzeeBonus')), '', info(function (q) { return q.yahtzeeBonuses ? plainCell('+' + q.yahtzeeBonuses * 100, 'accent') : plainCell('—', 'muted'); }));
    html += row('total', esc(tr('sheet.total')), '', info(function (q) { return plainCell(Yahtzee.totalScore(q)); }));
    return html;
  }

  function overHtml(st, me) {
    var rows = T.standings(st), winners = rows.filter(function (r) { return r.winner; });
    var title = winners.length > 1 ? tr('over.draw') : tr('over.winner', { name: winners[0] ? winners[0].name : '' });
    var list = rows.map(function (r) {
      return '<div class="result' + (r.winner ? ' win' : '') + '"><span>' + esc(r.name) + (r.seat === me ? ' (' + esc(tr('online.lobby.you')) + ')' : '') + (r.active ? '' : ' · ' + esc(tr('online.st.left'))) + '</span><b>' + r.total + '</b></div>';
    }).join('');
    return '<div class="overlay" role="dialog" aria-label="' + esc(tr('over.aria')) + '"><div class="dialog"><div><small>' + esc(st.reason === 'alone' ? tr('online.over.alone') : tr('over.title')) + '</small><h2>' + esc(title) + '</h2></div>' +
      '<div class="results">' + list + '</div>' +
      '<div class="dialog-actions"><button class="btn-secondary" data-act="exitTable" data-key="overExit">' + esc(tr('online.over.leave')) + '</button></div></div></div>';
  }

  function askHtml(me) {
    var tm = timerFor(me);
    if (!tm || tm.stage !== 'asking') return '';
    var pct = Math.round(100 * tm.left / tm.total);
    return '<div class="overlay" role="alertdialog" aria-modal="true" aria-label="' + esc(tr('online.ask.title')) + '"><div class="dialog"><h2>' + esc(tr('online.ask.title')) + '</h2>' +
      '<div class="o-ask"><b role="timer">' + tm.sec + '</b><span>' + esc(tr('online.ask.secs')) + '</span></div><div class="o-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="dialog-actions"><button class="btn-play" data-act="here" data-autofocus data-key="here">' + esc(tr('online.ask.yes')) + '</button><button class="btn-secondary" data-act="askLeave" data-key="askLeave">' + esc(tr('online.ask.leave')) + '</button></div></div></div>';
  }

  function gameHtml() {
    var v = G && G.view, st = v && v.state;
    if (!st) return '<div class="o-page"><div class="o-dashed">…</div></div>';
    var me = v.seat, p = st.players[me];
    if (!p) return '<div class="o-page"><div class="o-dashed">…</div></div>';
    var canAct = T.canAct(st, me) && !on.pending, left = Yahtzee.MAX_ROLLS - p.rollsUsed;
    var dots = '';
    for (var i = 0; i < Yahtzee.MAX_ROLLS; i++) dots += '<i class="' + (i < left ? 'on' : '') + '"></i>';
    var rollLabel = on.pending ? tr('online.sent') : (p.rollsUsed === 0 ? tr('roll.first') : (left > 0 ? tr('roll.more', { n: left }) : tr('roll.none')));
    var notice = activeNotice();
    var mineActive = T.canAct(st, me);
    return '<div class="topbar"><div class="topbar-head"><div class="turn"><small>' + esc(modeName(st.mode)) + ' · ' + esc(tr('online.round', { n: st.round, m: Yahtzee.CATEGORIES.length })) + '</small><strong>' +
        esc(st.gameOver ? tr('online.over.title') : (st.mode === 'turns' && st.current === me ? tr('online.yourTurn') : tr('online.table', { code: G.code }))) + '</strong></div>' + themeButtonHtml() + '</div>' +
      '<div class="topbar-actions"><button class="btn-secondary small" data-act="rules" data-key="rules">' + esc(tr('rules.button')) + '</button>' +
      '<button class="btn-secondary small" data-act="exitTable" data-key="exit">' + esc(tr('online.leave')) + '</button></div></div>' +
      bannerHtml() + (notice ? '<div class="o-notice" role="status">' + esc(notice) + '</div>' : '') +
      playersHtml(st, me) +
      '<div class="layout"><section class="card play"><div class="status-row"><span class="status" aria-live="polite">' + esc(statusLine(st, me, p)) + '</span>' +
        '<span class="roll-dots" role="img" aria-label="' + esc(tr('rollsLeft', { n: left })) + '">' + dots + '</span></div>' +
        '<div class="dice">' + diceHtml(p, mineActive) + '</div>' +
        '<button class="roll-btn" data-key="roll" data-act="oroll"' + (canAct && left > 0 && !st.gameOver ? '' : ' disabled') + '>' + esc(rollLabel) + '</button></section>' +
      '<section class="card sheet o-sheet">' + sheetHtml(st, me, mineActive) + '</section></div>' +
      (st.gameOver ? overHtml(st, me) : '');
  }

  function rulesBlock() { return typeof rulesHtml === 'function' ? rulesHtml() : ''; }

  function html() {
    switch (on.screen) {
      case 'login': return loginHtml();
      case 'tables': return tablesHtml();
      case 'create': return createHtml();
      case 'lobby': return lobbyHtml();
      case 'closed': return messageHtml('online.err.hostGone', '', 'online.err.toTables');
      case 'out': return messageHtml('online.out.title', 'online.out.text', 'online.out.btn');
      case 'game': return gameHtml();
    }
    return '';
  }
  function modalHtml() {
    if (app.modal === 'rules') return rulesBlock();
    if (app.modal === 'leaveOnline') {
      var host = G && G.role === 'host';
      return '<div class="overlay" role="alertdialog" aria-modal="true" aria-label="' + esc(tr(host ? 'online.confirmClose.title' : 'online.confirmLeave.title')) + '"><div class="dialog"><h2>' + esc(tr(host ? 'online.confirmClose.title' : 'online.confirmLeave.title')) + '</h2>' +
        '<span class="muted-text">' + esc(tr(host ? 'online.confirmClose.text' : 'online.confirmLeave.text')) + '</span>' +
        '<div class="dialog-actions"><button class="btn-secondary" data-act="close" data-autofocus data-key="stay">' + esc(tr('online.stay')) + '</button><button class="btn-primary" data-act="confirmLeave" data-key="ok">' + esc(tr(host ? 'online.lobby.close' : 'online.leave')) + '</button></div></div></div>';
    }
    if (G && on.screen === 'game' && G.view && G.view.state && G.view.seat !== null && !G.view.state.gameOver) return askHtml(G.view.seat);
    return '';
  }

  // ---------- Вход в режим и обработка нажатий ----------
  function enter() {
    app.screen = 'online'; app.modal = null;
    var st = Cloud.getState();
    if (st.user) openTables(); else { on.screen = 'login'; on.loginError = null; render(); }
  }

  function click(btn) {
    var act = btn.getAttribute('data-act'), v = btn.getAttribute('data-v');
    if (btn.hasAttribute('data-odie')) {
      var i = Number(btn.getAttribute('data-odie'));
      on.held[i] = !on.held[i]; render();
      return true;
    }
    if (btn.hasAttribute('data-ocat')) { send({ type: 'score', cat: btn.getAttribute('data-ocat') }); return true; }
    switch (act) {
      case 'oroll': {
        var p = mine();
        send(p && p.rollsUsed > 0 ? { type: 'roll', held: on.held.slice() } : { type: 'roll' });
        return true;
      }
      case 'signin': signIn(); return true;
      case 'relogin': Cloud.signIn().then(function () { render(); }, function () { render(); }); return true;
      case 'toStart': stopTimers(); app.screen = 'start'; on.busy = false; on.tableError = null; render(); return true;
      case 'toTables': stopTimers(); G = null; openTables(); return true;
      case 'toCreate': on.screen = 'create'; on.tableError = null; render(); return true;
      case 'size': on.size = Number(v); render(); return true;
      case 'setMode': on.mode = v === 'turns' ? 'turns' : 'sync'; render(); return true;
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
      case 'start': if (G && G.role === 'host') G.ctrl.start().then(function () { G.ctrl.tick(); }); return true;
      case 'closeTable': case 'leaveLobby': leaveGame('tables'); return true;
      case 'here': send({ type: 'here' }); return true;
      case 'exitTable': case 'askLeave': {
        var st = G && G.view && G.view.state;
        if (st && st.gameOver) leaveGame('tables'); else { app.modal = 'leaveOnline'; render(); }
        return true;
      }
      case 'confirmLeave': leaveGame('tables'); return true;
    }
    return false;
  }

  // Поле кода стола
  appEl.addEventListener('input', function (e) {
    if (e.target.id === 'ocode') {
      var clean = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5);
      on.code = clean; on.codeError = null;
      if (e.target.value !== clean) e.target.value = clean;
    }
  });
  appEl.addEventListener('keydown', function (e) { if (e.target.id === 'ocode' && e.key === 'Enter') { e.preventDefault(); joinTable(on.code); } });
  window.addEventListener('pagehide', function () { if (G) { try { if (G.role === 'host') G.ctrl.close(); else G.ctrl.leave(); } catch (e) { /* закрываем страницу */ } } });
  Cloud.onChange(function () {
    if (!isOn()) return;
    if (on.screen === 'login' && Cloud.getState().status === 'signedIn' && !on.busy) openTables();
    else if (on.screen === 'login' || on.screen === 'tables' || G) render();
  });
  // Ссылка вида …/yahtzee/#K7M4Q сразу ведёт на вход в стол
  (function () {
    var hash = (location.hash || '').replace('#', '').toUpperCase();
    if (/^[A-Z0-9]{5}$/.test(hash)) { on.code = hash; app.mode = 'online'; enter(); }
  })();
  // Таймеры на экране обновляются раз в секунду, пока идёт игра
  setInterval(function () { if (isOn() && G && (on.screen === 'game' || on.screen === 'lobby')) render(); }, 1000);

  window.YahtzeeOnlineUI = { enter: enter, html: html, modalHtml: modalHtml, click: click, isActive: function () { return isOn(); } };
  render();
})();
