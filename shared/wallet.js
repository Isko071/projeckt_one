// Общий кошелёк платформы: виртуальные «аконы», только в этом браузере (platform:wallet), настоящих денег нет.
// Все игры работают с аконами только через этот модуль:
//   PlatformWallet.getBalance()            → число
//   PlatformWallet.canAfford(n)            → хватает ли
//   PlatformWallet.spend(n, source)        → true/false (ставка, списание)
//   PlatformWallet.add(n, source)          → пополнение (выигрыш в игре на аконы)
//   PlatformWallet.earn(source, n, now)    → награда за одиночную игру с дневным лимитом → { granted, capped }
//   PlatformWallet.dailyStatus(now), claimDaily(now)   — ежедневный бонус и серия дней
//   PlatformWallet.reliefStatus(now), claimRelief(now) — помощь, когда аконов не хватает на минимальную ставку
//   PlatformWallet.reset()                 → стартовое состояние
// Когда появятся настоящие аккаунты, изменится только внутренность этого файла.
(function (root) {
  var KEY = 'platform:wallet';
  var CONFIG = {
    start: 5000,
    minBet: 25,
    bets: [25, 50, 100, 250, 500],
    dailyBase: 500,     // бонус в первый день серии
    dailyStep: 250,     // прибавка за каждый следующий день подряд
    dailyMax: 2000,     // потолок (достигается на 7-й день)
    earnDailyCap: 1500, // сколько можно заработать в одиночных играх за день
    relief: 500,        // помощь при нехватке на минимальную ставку (раз в день)
    logSize: 20
  };

  var listeners = [];
  var memory = null; // запасной вариант при недоступном хранилище: до перезагрузки страницы

  function num(v, fallback) {
    return typeof v === 'number' && isFinite(v) && v % 1 === 0 && v >= 0 ? v : fallback;
  }
  function day(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }

  function fresh() {
    return { balance: CONFIG.start, streak: 0, lastClaim: null, earnDay: null, earned: 0, reliefDay: null, log: [] };
  }

  // Приводит произвольные данные к корректному состоянию
  function sanitize(raw) {
    var base = fresh();
    if (!raw || typeof raw !== 'object') return base;
    var log = Array.isArray(raw.log) ? raw.log.filter(function (e) {
      return e && typeof e.source === 'string' && typeof e.amount === 'number' && isFinite(e.amount) && e.amount % 1 === 0;
    }).slice(0, CONFIG.logSize).map(function (e) { return { source: e.source.slice(0, 40), amount: e.amount, time: num(e.time, 0) }; }) : [];
    return {
      balance: num(raw.balance, base.balance), streak: Math.min(num(raw.streak, 0), 7), lastClaim: day(raw.lastClaim),
      earnDay: day(raw.earnDay), earned: num(raw.earned, 0), reliefDay: day(raw.reliefDay), log: log
    };
  }

  function load() {
    var stored = root.PlatformStorage ? root.PlatformStorage.get(KEY, null) : null;
    return sanitize(stored || memory);
  }
  function save(state) {
    memory = state;
    if (root.PlatformStorage) root.PlatformStorage.set(KEY, state);
    listeners.forEach(function (fn) { try { fn(state.balance); } catch (e) { /* подписчик не должен ломать остальных */ } });
    return state;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // Календарный день по местному времени
  function dayOf(now) {
    var d = new Date(now === undefined ? Date.now() : now);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  // Сколько дней между двумя днями (b − a); полдень убирает влияние перехода на летнее время
  function daysBetween(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    var da = new Date(+pa[0], +pa[1] - 1, +pa[2], 12), db = new Date(+pb[0], +pb[1] - 1, +pb[2], 12);
    return Math.round((db - da) / 86400000);
  }

  function record(state, source, amount, now) {
    state.log.unshift({ source: String(source), amount: amount, time: now === undefined ? Date.now() : now });
    if (state.log.length > CONFIG.logSize) state.log.length = CONFIG.logSize;
  }

  function getBalance() { return load().balance; }
  function canAfford(n) { return num(n, -1) >= 0 && getBalance() >= n; }

  function spend(n, source, now) {
    var s = load();
    if (num(n, -1) < 1 || s.balance < n) return false;
    s.balance -= n;
    record(s, source || 'spend', -n, now);
    save(s);
    return true;
  }
  function add(n, source, now) {
    if (num(n, -1) < 1) return false;
    var s = load();
    s.balance += n;
    record(s, source || 'add', n, now);
    save(s);
    return true;
  }

  // Награда за одиночную игру: не больше earnDailyCap в день
  function earn(source, n, now) {
    var s = load(), today = dayOf(now);
    if (num(n, -1) < 1) return { granted: 0, capped: false };
    if (s.earnDay !== today) { s.earnDay = today; s.earned = 0; }
    var room = Math.max(0, CONFIG.earnDailyCap - s.earned);
    var granted = Math.min(n, room);
    if (granted > 0) {
      s.earned += granted;
      s.balance += granted;
      record(s, source || 'earn', granted, now);
    }
    save(s);
    return { granted: granted, capped: granted < n };
  }

  function dailyAmount(dayNumber) {
    return Math.min(CONFIG.dailyMax, CONFIG.dailyBase + CONFIG.dailyStep * (dayNumber - 1));
  }

  // available — можно ли забрать бонус сегодня; day — номер дня серии (1..7), amount — сумма
  function dailyStatus(now) {
    var s = load(), today = dayOf(now);
    if (s.lastClaim === today) return { available: false, day: s.streak, amount: dailyAmount(Math.min(7, s.streak + 1)), streak: s.streak };
    var continues = s.lastClaim !== null && daysBetween(s.lastClaim, today) === 1;
    var next = continues ? Math.min(7, s.streak + 1) : 1;
    return { available: true, day: next, amount: dailyAmount(next), streak: continues ? s.streak : 0 };
  }

  function claimDaily(now) {
    var st = dailyStatus(now);
    if (!st.available) return { claimed: false, amount: 0, day: st.day };
    var s = load();
    s.streak = st.day;
    s.lastClaim = dayOf(now);
    s.balance += st.amount;
    record(s, 'daily', st.amount, now);
    save(s);
    return { claimed: true, amount: st.amount, day: st.day };
  }

  function reliefStatus(now) {
    var s = load();
    return { available: s.balance < CONFIG.minBet && s.reliefDay !== dayOf(now), amount: CONFIG.relief };
  }
  function claimRelief(now) {
    if (!reliefStatus(now).available) return { claimed: false, amount: 0 };
    var s = load();
    s.reliefDay = dayOf(now);
    s.balance += CONFIG.relief;
    record(s, 'relief', CONFIG.relief, now);
    save(s);
    return { claimed: true, amount: CONFIG.relief };
  }

  function getLog() { return load().log; }
  function reset() { return save(fresh()).balance; }
  function onChange(fn) { listeners.push(fn); }

  root.PlatformWallet = {
    KEY: KEY, CONFIG: CONFIG, sanitize: sanitize,
    getBalance: getBalance, canAfford: canAfford, spend: spend, add: add, earn: earn,
    dailyStatus: dailyStatus, claimDaily: claimDaily, reliefStatus: reliefStatus, claimRelief: claimRelief,
    getLog: getLog, reset: reset, onChange: onChange
  };
})(typeof window !== 'undefined' ? window : globalThis);
