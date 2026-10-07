// Русские тексты игры «Ятзи». Ключи games.yahtzee.* (название и описание для каталога лежат в locales/ru.js, там же games.yahtzee.title).
(function (root) {
  root.LOCALES = root.LOCALES || {};
  var p = 'games.yahtzee.';
  var texts = {
    'toCatalog': 'В каталог',
    'close': 'Закрыть',
    'cancel': 'Отмена',
    'turn': 'Ход',
    'newGame': 'Новая игра',
    'player1': 'Игрок 1',
    'player2': 'Игрок 2',
    'computer': 'Компьютер',
    'rollsLeft': 'Осталось бросков: {n}',

    'start.mode': 'Режим',
    'start.modeCpu': 'Против компьютера',
    'start.modeHot': 'Вдвоём на одном устройстве',
    'start.level': 'Сложность',
    'start.levelEasy': 'Лёгкий',
    'start.levelHard': 'Сильный',
    'start.players': 'Игроки',
    'start.name1': 'Имя первого игрока',
    'start.name2': 'Имя второго игрока',
    'start.play': 'Играть',

    'status.thinking': 'Компьютер думает…',
    'status.rolling': 'Бросок…',
    'status.first': 'Бросьте кубики',
    'status.pick': 'Выберите клетку для записи',
    'status.holdOrRoll': 'Зафиксируйте кубики или бросьте ещё',

    'roll.cpuTurn': 'Ход компьютера',
    'roll.first': 'Бросить',
    'roll.more': 'Бросить ещё ({n})',
    'roll.none': 'Бросков не осталось',

    'die.fresh': 'Кубик {n}, не брошен',
    'die.value': 'Кубик {n}: {v}',
    'die.held': 'Кубик {n}: {v}, зафиксирован',
    'die.tag': 'ДЕРЖУ',

    'cat.ones': 'Единицы', 'cat.twos': 'Двойки', 'cat.threes': 'Тройки',
    'cat.fours': 'Четвёрки', 'cat.fives': 'Пятёрки', 'cat.sixes': 'Шестёрки',
    'cat.threeKind': 'Сет', 'cat.fourKind': 'Каре', 'cat.fullHouse': 'Фулл-хаус',
    'cat.smallStraight': 'Малый стрит', 'cat.largeStraight': 'Большой стрит',
    'cat.yahtzee': 'Ятзи', 'cat.chance': 'Шанс',

    'cell.filled': '{name}: {v}',
    'cell.write': 'Записать в «{name}»: {v}',
    'cell.blocked': '{name}: недоступно (жокер)',
    'cell.empty': '{name}: пусто',

    'sheet.upper': 'Верхняя секция',
    'sheet.lower': 'Нижняя секция',
    'sheet.sum': 'Сумма',
    'sheet.bonus': 'Бонус +35',
    'sheet.yahtzeeBonus': 'Ятзи +100',
    'sheet.total': 'Итого',

    'over.title': 'Игра окончена',
    'over.aria': 'Конец игры',
    'over.draw': 'Ничья',
    'over.winner': 'Победил: {name}',
    'over.toMenu': 'В меню',
    'over.again': 'Играть снова',
    'reward.earned': 'Награда за победу: +{n} {unit}',
    'reward.limit': 'Дневной лимит наград исчерпан, завтра снова.',

    'rules.button': 'Правила',
    'rules.title': 'Правила',
    'rules.turn.title': 'Ход',
    'rules.turn.text': 'До трёх бросков за ход. Нажмите на кубик, чтобы зафиксировать его — он не перебрасывается. В конце хода запишите результат ровно в одну свободную клетку. Игра идёт, пока не заполнены все 13 клеток.',
    'rules.upper.title': 'Верхняя секция',
    'rules.upper.text': 'Единицы–шестёрки: сумма кубиков с нужной гранью. Если сумма секции 63 и больше — бонус +35.',
    'rules.lower.title': 'Нижняя секция',
    'rules.lower.text': 'Сет (3 одинаковых) и каре (4) — сумма всех кубиков. Фулл-хаус 3+2 — 25. Малый стрит (4 подряд) — 30. Большой стрит (5 подряд) — 40. Ятзи (5 одинаковых) — 50. Шанс — сумма всех кубиков. Не получилось — запишите 0.',
    'rules.joker.title': 'Повторный ятзи и жокер',
    'rules.joker.text': 'Если «Ятзи» уже стоит 50, каждый новый ятзи даёт +100. Когда клетка «Ятзи» занята, действует жокер: сначала верхняя клетка этой грани; если занята — любая свободная нижняя (фулл-хаус и стриты дают полные очки); если и их нет — любая верхняя.',
    'rules.total.title': 'Итог',
    'rules.total.text': 'Обе секции плюс бонусы. Побеждает больший счёт.',

    'confirm.aria': 'Новая игра',
    'confirm.title': 'Начать заново?',
    'confirm.text': 'Текущая партия будет потеряна.',
    'confirm.ok': 'Начать заново',

    'exit.aria': 'Выйти в каталог',
    'exit.title': 'Выйти в каталог?',
    'exit.stay': 'Остаться',
    'exit.ok': 'Выйти'
  };
  Object.keys(texts).forEach(function (k) { root.LOCALES.ru = root.LOCALES.ru || {}; root.LOCALES.ru[p + k] = texts[k]; });
})(typeof window !== 'undefined' ? window : globalThis);
