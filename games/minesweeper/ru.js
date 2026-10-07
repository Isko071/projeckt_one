// Русские тексты игры «Сапёр». Ключи games.minesweeper.* (название и описание для каталога лежат в locales/ru.js).
(function (root) {
  root.LOCALES = root.LOCALES || {};
  var p = 'games.minesweeper.';
  var texts = {
    'tagline': 'Откройте все клетки без мин. Спокойно и без спешки.',
    'toCatalog': 'В каталог',
    'play': 'Играть',
    'rules': 'Правила',
    'close': 'Закрыть',
    'cancel': 'Отмена',
    'best': 'Лучшее',
    'noBest': '—',

    'level.novice': 'Новичок',
    'level.amateur': 'Любитель',
    'level.expert': 'Эксперт',
    'level.sub': '{c} × {r} · {m} мин',
    'level.label': 'Сложность',
    'level.name': '{name} · {c}×{r}',

    'hud.mines': 'Мин осталось: {n}',
    'hud.time': 'Время: {t}',
    'face.restart': 'Начать заново',

    'mode.label': 'Режим нажатия',
    'mode.open': 'Открыть',
    'mode.flag': '⚑ Флажок',
    'hint.touch': 'Нажатие — открыть, долгое — флажок. Двойное на цифре — открыть соседей.',
    'hint.key1': 'ЛКМ — открыть',
    'hint.key2': 'ПКМ — флажок',
    'hint.key3': 'Стрелки — фокус',
    'hint.key4': 'Пробел / Enter — открыть',
    'hint.key5': 'F — флажок',
    'warn.small': 'Клетки мелковаты для узкого экрана. Попробуйте «Любитель» — там они крупнее.',

    'board.label': 'Игровое поле',
    'cell.closed': 'Закрыта',
    'cell.flag': 'Флажок',
    'cell.zero': 'Пусто',
    'cell.num': 'Цифра {n}',
    'cell.mine': 'Мина',
    'cell.boom': 'Взрыв',
    'cell.wrong': 'Неверный флажок',
    'cell.pos': '{state}, строка {r}, колонка {c}',

    'live.win': 'Победа! Время {t}.',
    'live.lose': 'Мина! Игра окончена.',

    'win.title': 'Победа!',
    'win.sub': '{name} · время',
    'win.record': '★ Новый рекорд!',
    'win.best': 'Лучший результат:',
    'lose.title': 'Бум! Попробуем ещё?',
    'lose.left': 'Осталось открыть клеток:',
    'lose.time': 'Время:',
    'reward.earned': 'Награда: +{n} {unit}',
    'reward.limit': 'Дневной лимит наград исчерпан, завтра снова.',
    'again': 'Играть снова',
    'changeLevel': 'Сменить сложность',

    'rules.title': 'Правила',
    'rules.goal.title': 'Цель',
    'rules.goal.text': 'Откройте все клетки без мин.',
    'rules.digits.title': 'Цифры',
    'rules.digits.text': 'Число — сколько мин в восьми соседних клетках. Ноль открывает соседей цепочкой.',
    'rules.flags.title': 'Флажки',
    'rules.flags.text': 'Помечайте клетки, где, по-вашему, мина. Флажок можно снять; под ним клетка не открывается.',
    'rules.controls.title': 'Управление',
    'rules.controls.text': 'Нажатие — открыть, долгое — флажок (или переключатель «Открыть / Флажок»). На компьютере: ЛКМ, ПКМ, стрелки, Пробел, F. Двойное нажатие на цифру с нужным числом флажков открывает остальных соседей.',
    'rules.first.title': 'Первое нажатие',
    'rules.first.text': 'Первое нажатие в партии всегда безопасно.',

    'confirmRestart.title': 'Начать заново?',
    'confirmRestart.ok': 'Начать заново',
    'confirmExit.title': 'Выйти в каталог?',
    'confirmExit.ok': 'Выйти в каталог',
    'confirm.text': 'Текущая партия будет потеряна.'
  };
  root.LOCALES.ru = root.LOCALES.ru || {};
  Object.keys(texts).forEach(function (k) { root.LOCALES.ru[p + k] = texts[k]; });
})(typeof window !== 'undefined' ? window : globalThis);
