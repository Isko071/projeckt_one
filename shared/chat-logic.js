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
    return censor(chars.length > CONFIG.maxLen ? chars.slice(0, CONFIG.maxLen).join('').trim() : s);
  }

  // Грубый мат: корень слова закрывается звёздочками (первая буква остаётся: «х**», «п***ец»). Обычные слова не задеваются:
  // «е*» ловится только в начале слова (иначе «хлеба», «небо»), «бля» — только отдельно или как «блядь» (иначе «употребляю»),
  // «ху*» — только в начале слова или после «на/по/ни/о/а» (иначе «застрахуй»). Латинские буквы-двойники (a, e, o, p, c, x, y) читаются как русские
  var LOOK = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', b: 'в', h: 'н', 'ё': 'е', '0': 'о', '3': 'з' };
  var SWEAR = [
    /(^|[^а-я])((?:на|по|ни|о|а|от|до)?ху[йеяиюё])/g,
    /(^|[^а-я])?([а-я]*?пизд)/g,
    /(^|[^а-я])((?:за|вы|на|по|у|от|до|раз|рас|съ|въ|объ|пере|при|про|из|изъ|недо)?еб(?:а|у(?!р)|л|ну|ыв|ись|ет|ош|ан|ен|ук|ок|ик|ал|он))/g,
    /(^|[^а-я])(бля(?:дь|ди|дск|дин|дств|ть|т)?)(?=$|[^а-я])/g,
    /(^|[^а-я])(муд(?:ак|ил|оз|ох))/g,
    /(^|[^а-я])(пид[оа]?р)/g,
    /(^|[^а-я])(залуп)/g
  ];
  function censor(text) {
    var low = String(text).toLowerCase(), norm = '', i;
    for (i = 0; i < low.length; i++) norm += LOOK[low[i]] || low[i];
    if (norm.length !== text.length) return text;                         // на всякий случай: длина должна совпадать посимвольно
    var hide = [];
    SWEAR.forEach(function (re) {
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(norm))) {
        var start = m.index + (m[1] ? m[1].length : 0), word = m[2];
        for (i = start + 1; i < start + word.length; i++) hide[i] = true;
        if (re.lastIndex === m.index) re.lastIndex++;
      }
    });
    if (!hide.length) return text;
    var out = '';
    for (i = 0; i < text.length; i++) out += hide[i] && /[^\s]/.test(text[i]) ? '*' : text[i];
    return out;
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

  root.PlatformChat = { CONFIG: CONFIG, clean: clean, censor: censor, createLog: createLog, createLimiter: createLimiter };
})(typeof window !== 'undefined' ? window : globalThis);
