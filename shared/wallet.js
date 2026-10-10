// Общий кошелёк платформы: виртуальные «аконы», только в этом браузере (platform:wallet), настоящих денег нет.
// Все игры работают с аконами только через этот модуль:
//   PlatformWallet.getBalance()            → число
//   PlatformWallet.canAfford(n)            → хватает ли
//   PlatformWallet.spend(n, source)        → true/false (ставка, списание)
//   PlatformWallet.add(n, source)          → пополнение (выигрыш в игре на аконы)
//   PlatformWallet.capStatus(now)          → { limit, used, left }: сколько ещё можно выиграть сегодня в игре с ограничением (половина баланса на начало дня)
//   PlatformWallet.onlineStatus(now) / onlineWin(source, profit, now) → дневной предел выигрыша за онлайн-столом (onlineCap): { granted, capped, left }
//   PlatformWallet.capStart(now)           → зафиксировать баланс на начало дня (вызывать перед первой ставкой дня)
//   PlatformWallet.capPayout(source, payout, bet, now) → выплата с ограничением выигрыша → { paid, net, granted, capped, left }
//   PlatformWallet.countPlay(source)       → записать начатую партию в счётчик по играм (для личного кабинета)
//   PlatformWallet.countWin(source)        → засчитать победу в рекордах (для игр на ставки)
//   PlatformWallet.earn(source, n, now)    → награда за одиночную игру с дневным лимитом → { granted, capped }
//   PlatformWallet.markPlayed(now)         → отметить, что сегодня сыграли (продлевает серию, открывает бонус дня)
//   PlatformWallet.dailyStatus(now), claimDaily(now)   — серия дней и ежедневный бонус
//   PlatformWallet.records()               → { peak, bestStreak, wins } для таблицы рекордов
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
    rewards: { minesweeper: { novice: 100, amateur: 250, expert: 400 }, yahtzee: { easy: 100, hard: 250 } }, // награды за победу в одиночных играх
    onlineCap: 5000,    // в онлайн-блэкджеке за день можно выиграть (чистыми) не больше этой суммы
    capShare: 0.5,      // в игре с ботом за день можно выиграть не больше этой доли баланса (на начало дня)
    rewardCaps: { blackjack: 3000, 'battleship-easy': 2500, 'battleship-expert': 5000 }, // игры без ставок: сколько наград можно получить за день (по играм)
    earnDailyCap: 1500, // сколько можно заработать в одиночных играх за день
    milestones: { 3: 250, 7: 1000, 14: 3000, 30: 10000, 60: 25000, 100: 50000 }, // разовые бонусы за длину серии
    logSize: 20
  };

  var listeners = [];
  var memory = null; // запасной вариант при недоступном хранилище: до перезагрузки страницы

  function num(v, fallback) {
    return typeof v === 'number' && isFinite(v) && v % 1 === 0 && v >= 0 ? v : fallback;
  }
  function day(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }

  function fresh() {
    return { balance: CONFIG.start, streak: 0, best: 0, playDay: null, pending: null, earnDay: null, earned: 0, peak: CONFIG.start, wins: {}, plays: {}, capDay: null, capBase: 0, capUsed: 0, onDay: null, onUsed: 0, log: [], days: [], rw: { day: null, used: {} } };
  }

  // Приводит произвольные данные к корректному состоянию
  function sanitize(raw) {
    var base = fresh();
    if (!raw || typeof raw !== 'object') return base;
    var log = Array.isArray(raw.log) ? raw.log.filter(function (e) {
      return e && typeof e.source === 'string' && typeof e.amount === 'number' && isFinite(e.amount) && e.amount % 1 === 0;
    }).slice(0, CONFIG.logSize).map(function (e) { return { source: e.source.slice(0, 40), amount: e.amount, time: num(e.time, 0) }; }) : [];
    var streak = Math.min(num(raw.streak, 0), 100000);
    var p = raw.pending;
    var pending = p && typeof p === 'object' && num(p.amount, -1) >= 1 ? { amount: num(p.amount, 0), bonus: num(p.bonus, 0), streak: Math.min(num(p.streak, 1), 100000) } : null;
    var balance = num(raw.balance, base.balance);
    var wins = {};
    if (raw.wins && typeof raw.wins === 'object' && !Array.isArray(raw.wins)) {
      Object.keys(raw.wins).slice(0, 20).forEach(function (k) {
        var v = num(raw.wins[k], 0);
        if (v > 0) wins[k.slice(0, 40)] = Math.min(v, 1000000);
      });
    }
    var plays = {};
    if (raw.plays && typeof raw.plays === 'object' && !Array.isArray(raw.plays)) {
      Object.keys(raw.plays).slice(0, 20).forEach(function (k) {
        var v = num(raw.plays[k], 0);
        if (v > 0) plays[k.slice(0, 40)] = Math.min(v, 10000000);
      });
    }
    return {
      balance: balance, streak: streak, best: Math.max(streak, Math.min(num(raw.best, 0), 100000)),
      playDay: day(raw.playDay), pending: pending, earnDay: day(raw.earnDay), earned: num(raw.earned, 0),
      peak: Math.max(balance, num(raw.peak, 0)), wins: wins, plays: plays, capDay: day(raw.capDay), capBase: num(raw.capBase, 0), capUsed: num(raw.capUsed, 0), onDay: day(raw.onDay), onUsed: num(raw.onUsed, 0), log: log, days: cleanDays(raw.days), rw: cleanRw(raw.rw)
    };
  }

  // Дни, когда играли (для календаря серии): последние 92 (около трёх месяцев), без повторов
  function cleanDays(v) {
    var out = [];
    (Array.isArray(v) ? v : []).forEach(function (d) { var x = day(d); if (x && out.indexOf(x) < 0) out.push(x); });
    out.sort();
    return out.slice(-92);
  }

  function cleanRw(v) {
    var out = { day: null, used: {} };
    if (v && typeof v === 'object') {
      out.day = day(v.day);
      if (v.used && typeof v.used === 'object' && !Array.isArray(v.used)) Object.keys(v.used).slice(0, 20).forEach(function (k) { out.used[String(k).slice(0, 40)] = num(v.used[k], 0); });
    }
    return out;
  }

  function load() {
    var stored = root.PlatformStorage ? root.PlatformStorage.get(KEY, null) : null;
    return sanitize(stored || memory);
  }
  function save(state) {
    if (state.balance > state.peak) state.peak = state.balance;
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

  // Ограничение выигрыша в игре с ботом: за день не больше capShare баланса, каким он был перед первой ставкой дня
  function capOf(s, today) {
    var base = s.capDay === today ? s.capBase : s.balance, used = s.capDay === today ? s.capUsed : 0;
    var limit = Math.floor(base * CONFIG.capShare);
    return { limit: limit, used: used, left: Math.max(0, limit - used) };
  }
  function capStatus(now) { return capOf(load(), dayOf(now)); }
  function capStart(now) {
    var s = load(), today = dayOf(now);
    if (s.capDay === today) return;
    s.capDay = today; s.capBase = s.balance; s.capUsed = 0;
    save(s);
  }
  function capPayout(source, payout, bet, now) {
    var s = load(), today = dayOf(now), profit = payout - bet;
    if (s.capDay !== today) { s.capDay = today; s.capBase = s.balance + bet; s.capUsed = 0; } // день сменился посреди раздачи: база — баланс до ставки
    var left = capOf(s, today).left, granted = profit > 0 ? Math.min(profit, left) : 0;
    var paid = profit > 0 ? bet + granted : payout;
    if (profit > 0) s.capUsed += granted;
    if (paid > 0) { s.balance += paid; record(s, source || 'win', paid, now); }
    save(s);
    return { paid: paid, net: paid - bet, granted: granted, capped: profit > 0 && granted < profit, left: Math.max(0, left - granted) };
  }

  // Ограничение выигрыша за онлайн-столом: чистый выигрыш за день не больше CONFIG.onlineCap; проигрыши лимит не возвращают
  function onlineStatus(now) {
    var s = load(), used = s.onDay === dayOf(now) ? s.onUsed : 0;
    return { limit: CONFIG.onlineCap, used: used, left: Math.max(0, CONFIG.onlineCap - used) };
  }
  // profit — чистый выигрыш раздачи; начисляется не больше остатка предела → { granted, capped, left }
  function onlineWin(source, profit, now) {
    var s = load(), today = dayOf(now);
    if (s.onDay !== today) { s.onDay = today; s.onUsed = 0; }
    var left = Math.max(0, CONFIG.onlineCap - s.onUsed), granted = profit > 0 ? Math.min(Math.floor(profit), left) : 0;
    if (granted > 0) { s.onUsed += granted; s.balance += granted; record(s, source || 'win', granted, now); }
    save(s);
    return { granted: granted, capped: profit > 0 && granted < profit, left: Math.max(0, left - granted) };
  }

  // Засчитать победу в игре, где выигрыш идёт через add (например, блэкджек): попадает в таблицу рекордов
  function countWin(source) {
    var s = load(), key = String(source || 'win').slice(0, 40);
    s.wins[key] = (s.wins[key] || 0) + 1;
    save(s);
  }

  // Партия начата: счётчик «сыграно» по играм (виден владельцу платформы в личном кабинете, на экранах игроков не показывается)
  function countPlay(source) {
    var s = load(), key = String(source || 'game').slice(0, 40);
    s.plays[key] = (s.plays[key] || 0) + 1;
    save(s);
  }

  // Награда за одиночную игру: не больше earnDailyCap в день
  function earn(source, n, now) {
    var s = load(), today = dayOf(now);
    if (num(n, -1) < 1) return { granted: 0, capped: false };
    var key = String(source || 'earn').slice(0, 40);
    s.wins[key] = (s.wins[key] || 0) + 1; // победа засчитывается, даже если дневной лимит наград исчерпан
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

  // Серия, как она выглядит сегодня: если вчера не играли, она сгорела
  function liveStreak(s, today) {
    if (!s.playDay) return 0;
    var gap = daysBetween(s.playDay, today);
    return gap === 0 || gap === 1 ? s.streak : 0;
  }

  // Отметка «сегодня сыграли»: первая за день продлевает серию и готовит бонус дня
  function markPlayed(now) {
    var s = load(), today = dayOf(now);
    if (s.playDay === today) return { counted: false, streak: s.streak };
    if (s.pending) { // старый неполученный бонус не пропадает
      s.balance += s.pending.amount + s.pending.bonus;
      record(s, 'daily', s.pending.amount + s.pending.bonus, now);
      s.pending = null;
    }
    s.streak = liveStreak(s, today) + 1;
    s.best = Math.max(s.best, s.streak);
    s.playDay = today;
    if (s.days.indexOf(today) < 0) s.days = cleanDays(s.days.concat([today]));
    s.pending = { amount: dailyAmount(Math.min(7, s.streak)), bonus: CONFIG.milestones[s.streak] || 0, streak: s.streak };
    save(s);
    return { counted: true, streak: s.streak, amount: s.pending.amount, bonus: s.pending.bonus };
  }

  // Состояние для интерфейса
  // День на n дней раньше (n ≥ 0), строкой ГГГГ-ММ-ДД
  function dayBefore(d, n) {
    var p = d.split('-'), t = new Date(+p[0], +p[1] - 1, +p[2] - n, 12);
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }
  // Дни, в которые играли: записанные и дни текущей серии (она идёт подряд до последнего игрового дня)
  function playedDays() {
    var s = load(), set = {};
    s.days.forEach(function (d) { set[d] = true; });
    if (s.playDay) for (var i = 0; i < s.streak; i++) set[dayBefore(s.playDay, i)] = true;
    return set;
  }

  // Награды в играх без ставок (блэкджек): за день не больше CONFIG.rewardCaps[источник]
  function rewardStatus(source, now) {
    var s = load(), today = dayOf(now), cap = CONFIG.rewardCaps[source] || 0, used = s.rw.day === today ? num(s.rw.used[source], 0) : 0;
    return { limit: cap, used: used, left: Math.max(0, cap - used) };
  }
  function reward(source, amount, now) {
    var s = load(), today = dayOf(now), cap = CONFIG.rewardCaps[source] || 0;
    if (s.rw.day !== today) s.rw = { day: today, used: {} };
    var used = num(s.rw.used[source], 0), amt = Math.max(0, Math.floor(amount)), granted = Math.min(amt, Math.max(0, cap - used));
    if (granted > 0) { s.rw.used[source] = used + granted; s.balance += granted; record(s, source, granted, now); }
    save(s);
    return { granted: granted, capped: granted < amt, left: Math.max(0, cap - used - granted) };
  }

  function dailyStatus(now) {
    var s = load(), today = dayOf(now);
    var streak = liveStreak(s, today), playedToday = s.playDay === today;
    var next = Math.min(7, streak + 1);
    var milestones = Object.keys(CONFIG.milestones).map(Number).sort(function (a, b) { return a - b; });
    var upcoming = milestones.filter(function (m) { return m > streak; })[0] || null;
    return {
      streak: streak, best: s.best, playedToday: playedToday,
      atRisk: streak > 0 && !playedToday,       // вчера играли, сегодня ещё нет
      pending: s.pending ? { amount: s.pending.amount, bonus: s.pending.bonus, streak: s.pending.streak } : null,
      nextAmount: dailyAmount(next),            // бонус за следующий день серии
      nextMilestone: upcoming, milestoneBonus: upcoming ? CONFIG.milestones[upcoming] : 0
    };
  }

  // Забрать бонус дня (доступен после первой игры за день)
  function claimDaily() {
    var s = load();
    if (!s.pending) return { claimed: false, amount: 0, bonus: 0, streak: s.streak };
    var p = s.pending, total = p.amount + p.bonus;
    s.balance += total;
    record(s, 'daily', p.amount, undefined);
    if (p.bonus) record(s, 'milestone', p.bonus, undefined);
    s.pending = null;
    save(s);
    return { claimed: true, amount: p.amount, bonus: p.bonus, streak: p.streak };
  }

  function getLog() { return load().log; }
  // Рекорды для таблицы: больше всего аконов, лучшая серия, победы по играм
  function records() {
    var s = load();
    return { peak: s.peak, bestStreak: s.best, wins: JSON.parse(JSON.stringify(s.wins)) };
  }
  function onChange(fn) { listeners.push(fn); }
  // Забыть копию в памяти (после смены или очистки прогресса из другого модуля)
  function forget() { memory = null; }

  root.PlatformWallet = {
    KEY: KEY, CONFIG: CONFIG, sanitize: sanitize,
    getBalance: getBalance, canAfford: canAfford, spend: spend, add: add, earn: earn, countWin: countWin, countPlay: countPlay,
    capStatus: capStatus, capStart: capStart, capPayout: capPayout, onlineStatus: onlineStatus, onlineWin: onlineWin,
    markPlayed: markPlayed, playedDays: playedDays, reward: reward, rewardStatus: rewardStatus, dailyStatus: dailyStatus, claimDaily: claimDaily,
    getLog: getLog, records: records, onChange: onChange, forget: forget
  };
})(typeof window !== 'undefined' ? window : globalThis);
