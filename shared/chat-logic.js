// Логика чата за онлайн-столом: очистка текста, ограничение частоты, журнал последних сообщений.
// Чистая (без window и document), тестируется в node (tests/chat-logic.test.js).
// Чат едет через хоста стола: игрок шлёт действие { type: 'chat', text, cid }, хост очищает текст, проверяет частоту,
// кладёт сообщение в журнал (последние 20) и публикует его в документе комнаты вместе с остальным состоянием стола
// (см. docs/chat-plan.md, shared/rooms.js и shared/rooms-turns.js). Отдельных чтений Firestore чат не требует.
//
// Сообщение журнала:
//   { id, kind: 'msg', uid, seat, name, text, ts, cid }   текст игрока
//   { id, kind: 'sys', code, name, ts }                    системное: code = 'join' | 'leave' | 'start' | 'out'
(function (root) {
  var CONFIG = { maxLen: 200, gapMs: 800, perMinute: 20, keep: 20 };

  // Управляющие и невидимые символы (в том числе управляющие направлением текста), которые нельзя пускать в чат
  var BAD = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g;

  // Текст сообщения: без управляющих символов, переносы и подряд идущие пробелы становятся одним пробелом, не длиннее maxLen символов
  function clean(text) {
    var s = String(text === undefined || text === null ? '' : text).replace(/[\r\n\t]+/g, ' ').replace(BAD, '').replace(/\s+/g, ' ').trim();
    var chars = Array.from(s);
    return chars.length > CONFIG.maxLen ? chars.slice(0, CONFIG.maxLen).join('').trim() : s;
  }

  // Журнал последних сообщений: id растёт без пропусков, лишнее старое отбрасывается
  function createLog(opts) {
    var keep = (opts && opts.keep) || CONFIG.keep, list = [], seq = 0;
    return {
      add: function (msg) {
        var m = Object.assign({}, msg, { id: ++seq });
        list.push(m);
        if (list.length > keep) list = list.slice(list.length - keep);
        return m;
      },
      list: function () { return list.slice(); },
      last: function () { return seq; }
    };
  }

  // Ограничение частоты по ключу (uid игрока): не чаще одного сообщения в gapMs и не больше perMinute за минуту
  function createLimiter(opts) {
    var gap = (opts && opts.gapMs) || CONFIG.gapMs, per = (opts && opts.perMinute) || CONFIG.perMinute, hist = {};
    return {
      allow: function (key, now) {
        var h = (hist[key] || []).filter(function (t) { return now - t < 60000; });
        if (h.length && now - h[h.length - 1] < gap) { hist[key] = h; return false; }
        if (h.length >= per) { hist[key] = h; return false; }
        h.push(now); hist[key] = h;
        return true;
      }
    };
  }

  root.PlatformChat = { CONFIG: CONFIG, clean: clean, createLog: createLog, createLimiter: createLimiter };
})(typeof window !== 'undefined' ? window : globalThis);
