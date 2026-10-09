// Реестр игр: каталог строит весь вид из этого списка.
// Чтобы добавить игру, добавьте запись сюда, тексты в locales/ru.js и обложку (подробнее: docs/adding-a-game.md).
//   id            — латиницей; для настоящих игр совпадает с именем папки games/<id>/
//   status        — 'available' (можно играть) или 'soon' (в списке с пометкой «Скоро»)
//   path          — папка игры; кнопка «Играть» ведёт на path + 'index.html'
//   cover         — картинка обложки (пропорции 4:5)
//   titleKey, descriptionKey — ключи словаря с названием и описанием
(function (root) {
  root.GAMES = [
    {
      id: 'yahtzee', status: 'available', path: 'games/yahtzee/', cover: 'games/yahtzee/cover.svg',
      titleKey: 'games.yahtzee.title', descriptionKey: 'games.yahtzee.description'
    },
    {
      id: 'minesweeper', status: 'available', path: 'games/minesweeper/', cover: 'games/minesweeper/cover.svg',
      titleKey: 'games.minesweeper.title', descriptionKey: 'games.minesweeper.description'
    },
    {
      id: 'blackjack', status: 'available', path: 'games/blackjack/', cover: 'games/blackjack/cover.svg',
      titleKey: 'games.blackjack.title', descriptionKey: 'games.blackjack.description'
    },
    {
      id: 'poker-simple', status: 'available', path: 'games/poker-simple/', cover: 'games/poker-simple/cover.svg',
      titleKey: 'games.poker-simple.title', descriptionKey: 'games.poker-simple.description'
    },
    {
      id: 'next', status: 'soon', path: 'games/next/', cover: 'assets/covers/soon.svg',
      titleKey: 'games.next.title', descriptionKey: 'games.next.description'
    }
  ];
})(typeof window !== 'undefined' ? window : globalThis);
