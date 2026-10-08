// Интерфейс чата за онлайн-столом: кнопка «💬» в шапке, панель (в зале ожидания и во время игры), плашка о новом сообщении.
// Общий для «Блэкджека» и «Ятзи»; тексты в locales/ru.js (chat.*), стили в shared/chat.css, логика сообщений в shared/chat-logic.js.
//
//   var chat = PlatformChatUI.create({ root, getView, myUid, send, render });
//     root     — элемент приложения (на нём ловятся нажатия и прокрутка)
//     getView  — () → текущее представление стола { chat: [...], seat } или null
//     myUid    — () → uid игрока (чтобы отличать свои сообщения)
//     send     — (text, cid) → Promise или булево: отправить сообщение; ошибка или false = «Не отправлено»
//     render   — () → перерисовать экран игры (вызывается при любых изменениях чата)
//   chat.update(view, mode)   — вызывать при каждом новом представлении; mode: 'lobby' | 'game'
//   chat.buttonHtml()         — кнопка «💬» для шапки (только в игре)
//   chat.panelHtml(opts)      — панель; opts: { mode: 'lobby' | 'game', myTurn }
//   chat.extraHtml()          — плашка о новом сообщении и затемнение за панелью (кладётся рядом с экраном)
//   chat.afterRender()        — вызывать после каждой перерисовки (прокрутка ленты)
//   chat.reset()              — вызывать при выходе из-за стола
(function (root) {
  var ST = { hidden: 'platform:chat:hidden', hints: 'platform:chat:hints' };

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function t(key, params) { return root.I18n.t('chat.' + key, params); }
  function read(key, fallback) { try { var v = root.localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch (e) { return fallback; } }
  function write(key, val) { try { root.localStorage.setItem(key, val ? '1' : '0'); } catch (e) { /* без сохранения */ } }
  function hue(name) { var h = 0, s = String(name || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function initial(name) { var c = Array.from(String(name || '?'))[0] || '?'; return c.toUpperCase(); }
  function hhmm(ts) { var d = new Date(ts || Date.now()); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function isDesktop() { return (document.documentElement.clientWidth || root.innerWidth) >= 700; }

  function create(opts) {
    var Chat = root.PlatformChat, MAX = Chat ? Chat.CONFIG.maxLen : 200, GAP = Chat ? Chat.CONFIG.gapMs : 800;
    var st = {
      open: false, settings: false, hidden: read(ST.hidden, false), hints: read(ST.hints, true), unread: 0, seenId: null, mode: null,
      toast: null, toastTimer: null, menuId: null, pending: [], cool: false, stick: true, below: false, draft: '', copied: null
    };
    var cid = 0;

    function view() { return opts.getView ? opts.getView() : null; }
    function list() { var v = view(); return v && Array.isArray(v.chat) ? v.chat : []; }
    function visible() { return !st.hidden && (st.mode === 'lobby' || (st.mode === 'game' && st.open)); }
    function nowMs() { return Date.now(); }
    function rerender() { if (opts.render) opts.render(); }

    // ---------- Новое представление стола ----------
    function update(v, mode) {
      st.mode = mode || st.mode;
      var msgs = v && Array.isArray(v.chat) ? v.chat : [];
      var maxId = msgs.length ? msgs[msgs.length - 1].id : 0, me = opts.myUid && opts.myUid();
      // свои сообщения, дошедшие до хоста, перестают быть «отправляемыми»
      st.pending = st.pending.filter(function (p) { return !msgs.some(function (m) { return m.cid && m.cid === p.cid; }); });
      if (st.seenId === null) { st.seenId = maxId; return; }       // история, которая была до входа, непрочитанной не считается
      var fresh = msgs.filter(function (m) { return m.id > st.seenId && m.kind === 'msg' && m.uid !== me; });
      if (fresh.length) {
        if (visible()) { /* читаем прямо сейчас */ }
        else {
          st.unread += fresh.length;
          var last = fresh[fresh.length - 1];
          if (st.mode === 'game' && st.hints && !st.hidden && !st.open) showToast(last.name, last.text);
        }
        if (visible() && !st.stick) st.below = true;
      }
      if (maxId > st.seenId) { st.seenId = maxId; if (visible() && st.stick) { /* прокрутит afterRender */ } }
    }

    function showToast(name, text) {
      st.toast = { name: name, text: text };
      clearTimeout(st.toastTimer);
      st.toastTimer = setTimeout(function () { st.toast = null; rerender(); }, 3000);
    }

    function markRead() { st.unread = 0; st.toast = null; clearTimeout(st.toastTimer); var l = list(); if (l.length) st.seenId = l[l.length - 1].id; }

    // ---------- Разметка ----------
    function buttonHtml() {
      var label = st.unread ? t('openUnread', { n: st.unread }) : t('open');
      return '<button class="ch-btn" data-ch="toggle" data-chatbtn="1" data-key="chatBtn" aria-label="' + esc(label) + '" aria-expanded="' + st.open + '">💬' +
        (st.unread ? '<span class="ch-badge" data-key="chatBadge">' + (st.unread > 9 ? '9+' : st.unread) + '</span>' : '') + '</button>';
    }

    function rowsHtml() {
      var me = opts.myUid && opts.myUid(), rows = list().slice();
      st.pending.forEach(function (p) { rows.push({ id: 'p' + p.cid, kind: 'msg', uid: me, name: t('you'), text: p.text, ts: p.ts, status: p.status, cid: p.cid }); });
      if (!rows.length) return '<div class="ch-empty">' + esc(t('empty')).replace(/\n/g, '<br>') + '</div>';
      var prev = null;
      return rows.map(function (m) {
        var out;
        if (m.kind === 'sys') {
          out = '<div class="ch-row" data-key="m' + m.id + '"><div class="ch-sys">' + esc(t('sys.' + m.code, { name: m.name || '' })) + '</div></div>';
          prev = m; return out;
        }
        var mine = m.uid === me, err = m.status === 'error', head = !prev || prev.kind === 'sys' || prev.uid !== m.uid;
        var meta = (m.status === 'sending' ? t('sending') : (err ? t('failed') : '')), menu = st.menuId === m.id;
        out = '<div class="ch-row ' + (mine ? 'mine' : 'other') + (err ? ' err' : '') + '" data-key="m' + m.id + '">' +
          (head ? '<div class="ch-from">' + (mine ? '' : '<span class="ch-av" style="--ch-hue:' + hue(m.name) + '">' + esc(initial(m.name)) + '</span>') + '<span class="ch-name">' + esc(mine ? t('you') : m.name) + '</span></div>' : '') +
          '<div class="ch-line"><div class="ch-bubble"><div class="ch-text">' + esc(m.text) + '</div><div class="ch-meta"><span>' + esc(meta) + '</span><span>' + esc(hhmm(m.ts)) + '</span></div></div>' +
          '<button class="ch-dots" data-ch="menu" data-v="' + esc(m.id) + '" aria-label="' + esc(t('menu')) + '">⋯</button></div>' +
          (err ? '<button class="ch-retry" data-ch="retry" data-v="' + esc(m.cid) + '">' + esc(t('retry')) + '</button>' : '') +
          (menu ? '<button class="ch-copy" data-ch="copy" data-v="' + esc(m.id) + '">' + esc(st.copied === m.id ? t('copied') : t('copy')) + '</button>' : '') + '</div>';
        prev = m; return out;
      }).join('');
    }

    function formHtml() {
      var n = Array.from(st.draft).length, off = !st.draft.trim() || st.cool, warn = n >= 180;
      var counter = n >= MAX ? t('counterMax') : (warn ? t('counterLeft', { left: MAX - n, n: n }) : t('counter', { n: n }));
      return '<div class="ch-form"><div class="ch-inputrow"><input class="ch-input' + (warn ? ' warn' : '') + '" id="chInput" data-key="chInput" type="text" maxlength="' + MAX + '" aria-label="' + esc(t('placeholder')) + '" placeholder="' + esc(t('placeholder')) + '" autocomplete="off" enterkeyhint="send">' +
        '<button class="ch-send" data-ch="send" data-key="chSend" aria-label="' + esc(t('send')) + '" aria-disabled="' + off + '">➤</button></div>' +
        '<div class="ch-foot"><span>' + esc(t('polite')) + '</span><span class="ch-counter' + (warn ? ' warn' : '') + '" id="chCounter">' + esc(counter) + '</span></div></div>';
    }

    function panelHtml(o) {
      o = o || {};
      var lobby = o.mode === 'lobby', desk = isDesktop();
      if (!lobby && !st.open) return '';
      var cls = 'ch-panel ' + (lobby ? 'in-lobby' : (desk ? 'as-side' : 'as-sheet' + (o.myTurn ? ' turn' : '')));
      var closeText = desk ? t('closeSide') : t('closeSheet');
      var head = '<div class="ch-head"><div class="ch-title">' + esc(t('title')) + '</div>' +
        '<button class="ch-icon" data-ch="settings" data-key="chSettings" aria-label="' + esc(t('settings')) + '" aria-expanded="' + st.settings + '">⚙</button>' +
        (lobby ? '<button class="ch-link" data-ch="hide" data-key="chHide">' + esc(t('hide')) + '</button>'
               : '<button class="ch-link" data-ch="close" data-key="chClose" aria-label="' + esc(t('closeLabel')) + '">' + esc(closeText) + '</button>') + '</div>';
      var settings = st.settings ? '<div class="ch-settings"><button class="ch-switch" role="switch" aria-checked="' + st.hints + '" data-ch="hints"><span>' + esc(t('hints')) + '</span><b>' + esc(t(st.hints ? 'on' : 'off')) + '</b></button>' +
        '<button class="ch-link" data-ch="hide">' + esc(t('hideChat')) + '</button></div>' : '';
      var body;
      if (st.hidden) {
        body = '<div class="ch-hidden"><div>' + esc(t('hiddenNote', { note: st.unread ? t('hiddenUnread', { n: st.unread }) : t('hiddenDot') })) + '</div><button class="ch-primary" data-ch="show">' + esc(t('show')) + '</button></div>';
      } else {
        body = '<div class="ch-body"><div class="ch-log" data-ch-log="1" role="log" aria-live="polite" aria-label="' + esc(t('log')) + '" tabindex="0">' + rowsHtml() + '</div>' +
          (st.below ? '<button class="ch-below" data-ch="bottom">' + esc(t('newMessages')) + '</button>' : '') + '</div>' + formHtml();
      }
      return '<section class="' + cls + '" role="region" aria-label="' + esc(t('region')) + '" data-key="chatPanel">' + head + settings + body + '</section>';
    }

    function extraHtml() {
      var out = '';
      if (st.mode === 'game' && st.open && !isDesktop()) out += '<div class="ch-scrim" data-ch="close" data-key="chScrim"></div>';
      if (st.mode === 'game' && st.toast && !st.open && st.hints && !st.hidden) out += '<button class="ch-toast" data-ch="toggle" data-key="chToast"><b>' + esc(st.toast.name) + ':</b> ' + esc(st.toast.text) + '</button>';
      return out;
    }

    // ---------- Действия ----------
    function openChat() { st.open = true; st.settings = false; markRead(); st.stick = true; st.below = false; rerender(); }
    function closeChat(focusBtn) {
      st.open = false; st.settings = false; st.menuId = null; rerender();
      if (focusBtn) { var b = opts.root.querySelector('[data-chatbtn]'); if (b) b.focus(); }
    }

    function submit(text, previousCid) {
      var clean = Chat ? Chat.clean(text) : String(text).trim();
      if (!clean) return;
      var id = previousCid || ('c' + (++cid) + nowMs().toString(36).slice(-5));
      st.pending = st.pending.filter(function (p) { return p.cid !== previousCid; });
      var p = { cid: id, text: clean, ts: nowMs(), status: 'sending' };
      st.pending.push(p); st.stick = true; st.below = false;
      var fail = function () { p.status = 'error'; rerender(); };
      var timer = setTimeout(function () { if (st.pending.indexOf(p) >= 0 && p.status === 'sending') fail(); }, 8000);
      var res;
      try { res = opts.send(clean, id); } catch (e) { clearTimeout(timer); fail(); return; }
      if (res === false) { clearTimeout(timer); fail(); return; }
      if (res && typeof res.then === 'function') res.then(function () { /* дождёмся подтверждения в журнале */ }, function () { clearTimeout(timer); fail(); });
    }

    function sendDraft() {
      var input = opts.root.querySelector('#chInput'), text = input ? input.value : st.draft;
      if (!text.trim() || st.cool) return;
      submit(text);
      st.draft = ''; if (input) input.value = '';
      st.cool = true;
      setTimeout(function () { st.cool = false; rerender(); }, GAP);
      rerender();
    }

    function onClick(e) {
      var el = e.target.closest ? e.target.closest('[data-ch]') : null;
      if (!el || !opts.root.contains(el)) return;
      var act = el.getAttribute('data-ch'), v = el.getAttribute('data-v');
      switch (act) {
        case 'toggle': if (st.open) closeChat(false); else openChat(); break;
        case 'close': closeChat(true); break;
        case 'settings': st.settings = !st.settings; rerender(); break;
        case 'hints': st.hints = !st.hints; write(ST.hints, st.hints); rerender(); break;
        case 'hide': st.hidden = true; st.settings = false; write(ST.hidden, true); rerender(); break;
        case 'show': st.hidden = false; markRead(); st.stick = true; write(ST.hidden, false); rerender(); break;
        case 'send': sendDraft(); break;
        case 'bottom': st.stick = true; st.below = false; rerender(); break;
        case 'menu': st.menuId = String(st.menuId) === String(v) ? null : (isNaN(Number(v)) ? v : Number(v)); st.copied = null; rerender(); break;
        case 'copy': {
          var m = list().filter(function (x) { return String(x.id) === String(v); })[0] || st.pending.filter(function (p) { return 'p' + p.cid === String(v); })[0];
          try { if (m && navigator.clipboard) navigator.clipboard.writeText(m.text); } catch (err) { /* без буфера */ }
          st.copied = m ? m.id : null; rerender();
          setTimeout(function () { st.menuId = null; st.copied = null; rerender(); }, 900);
          break;
        }
        case 'retry': {
          var p = st.pending.filter(function (x) { return x.cid === v; })[0];
          if (p) submit(p.text, v);
          rerender();
          break;
        }
      }
    }

    function onInput(e) {
      if (e.target.id !== 'chInput') return;
      st.draft = e.target.value;
      var n = Array.from(st.draft).length, c = opts.root.querySelector('#chCounter'), send = opts.root.querySelector('.ch-send');
      if (c) { c.textContent = n >= MAX ? t('counterMax') : (n >= 180 ? t('counterLeft', { left: MAX - n, n: n }) : t('counter', { n: n })); c.classList.toggle('warn', n >= 180); }
      e.target.classList.toggle('warn', n >= 180);
      if (send) send.setAttribute('aria-disabled', String(!st.draft.trim() || st.cool));
    }
    function onKey(e) {
      if (e.target.id === 'chInput' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendDraft(); }
      else if (e.key === 'Escape' && st.mode === 'game' && st.open) { e.stopPropagation(); closeChat(true); }
    }
    function onScroll(e) {
      var el = e.target;
      if (!el || !el.getAttribute || el.getAttribute('data-ch-log') !== '1') return;
      var near = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      st.stick = near;
      if (near && st.below) { st.below = false; st.seenId = list().length ? list()[list().length - 1].id : st.seenId; rerender(); }
    }

    opts.root.addEventListener('click', onClick);
    opts.root.addEventListener('input', onInput);
    opts.root.addEventListener('keydown', onKey, true);
    opts.root.addEventListener('scroll', onScroll, true);

    function afterRender() {
      var log = opts.root.querySelector('[data-ch-log="1"]');
      if (log && st.stick) log.scrollTop = log.scrollHeight;
      var input = opts.root.querySelector('#chInput');
      if (input && document.activeElement !== input && input.value !== st.draft) input.value = st.draft;
      if (st.mode === 'game' && st.open && isDesktop()) opts.root.classList.add('ch-side'); else opts.root.classList.remove('ch-side');
      if (visible() && list().length) { var lastId = list()[list().length - 1].id; if (st.stick && lastId > (st.seenId || 0)) st.seenId = lastId; }
    }

    function reset() {
      st.open = false; st.settings = false; st.unread = 0; st.seenId = null; st.mode = null; st.toast = null; clearTimeout(st.toastTimer);
      st.menuId = null; st.pending = []; st.cool = false; st.stick = true; st.below = false; st.draft = '';
      opts.root.classList.remove('ch-side');
    }

    return { update: update, buttonHtml: buttonHtml, panelHtml: panelHtml, extraHtml: extraHtml, afterRender: afterRender, reset: reset,
      isOpen: function () { return st.open; }, state: st,
      // ширина боковой колонки чата на десктопе (игры с вёрсткой от ширины окна вычитают её из доступной)
      sideWidth: function () { return st.mode === 'game' && st.open && isDesktop() ? 356 : 0; } };
  }

  root.PlatformChatUI = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
