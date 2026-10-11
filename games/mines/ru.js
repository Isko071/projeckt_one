// Русские тексты игры «Мины». Ключи games.mines.* (название и описание для каталога лежат в locales/ru.js).
(function (root) {
  root.LOCALES = root.LOCALES || {};
  var p = 'games.mines.';
  var texts = {
    'toCatalog': 'В каталог',
    'sub': 'Открывайте клетки и не наступите на мину. Чем больше мин, тем больше аконов за каждую клетку.',
    'start.count': 'Сколько мин',
    'start.perCell': '+{n} за клетку',
    'start.minus': 'Меньше мин',
    'start.plus': 'Больше мин',
    'start.play': 'Играть',
    'rules.button': 'Правила',
    'rules.title': 'Правила',
    'rules.close': 'Понятно',
    'rules.step1': 'Поле из 25 клеток. Вы выбираете, сколько на нём мин: от 1 до 24.',
    'rules.step2': 'Открывайте клетки по одной. За каждую безопасную клетку вы получаете аконы: 10 умножить на число мин.',
    'rules.step3': 'Попали на мину: всё накопленное за раунд сгорает.',
    'rules.step4': 'Нажмите «Забрать» в любой момент после первой клетки, чтобы получить накопленное.',
    'rules.step5': 'Открыли все безопасные клетки: накопленное забирается само.',
    'mines': 'Мин',
    'earned': 'Накоплено',
    'next': 'Следующая клетка',
    'plus': '+{n}',
    'take': 'Забрать {n}',
    'take.none': 'Откройте клетку',
    'cell.aria': 'Клетка {n}',
    'cell.mine': 'мина',
    'cell.safe': 'безопасная клетка',
    'result.cashed': 'Вы забрали +{n}',
    'result.cleared': 'Все клетки открыты! +{n}',
    'result.lost': 'Мина! Накопленное сгорело',
    'cap.cut': 'Дневной предел наград: начислено только +{n}.',
    'cap.reached': 'Дневной предел наград достигнут: награда не начислена.',
    'again': 'Ещё раз',
    'menu': 'В меню',
    'exit.aria': 'Выйти в меню',
    'confirm.title': 'Выйти из раунда?',
    'confirm.text': 'Накопленное за раунд сгорит. Чтобы его получить, нажмите «Забрать».',
    'confirm.stay': 'Остаться',
    'confirm.ok': 'Выйти'
  };
  Object.keys(texts).forEach(function (k) { root.LOCALES.ru = root.LOCALES.ru || {}; root.LOCALES.ru[p + k] = texts[k]; });
})(typeof window !== 'undefined' ? window : globalThis);
