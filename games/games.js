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
      id: 'yahtzee', status: 'available', path: 'games/yahtzee/', cover: 'games/yahtzee/cover.webp',
      titleKey: 'games.yahtzee.title', descriptionKey: 'games.yahtzee.description'
    },
    {
      id: 'minesweeper', status: 'available', path: 'games/minesweeper/', cover: 'games/minesweeper/cover.webp',
      titleKey: 'games.minesweeper.title', descriptionKey: 'games.minesweeper.description'
    },
    {
      id: 'blackjack', status: 'available', path: 'games/blackjack/', cover: 'games/blackjack/cover.webp',
      titleKey: 'games.blackjack.title', descriptionKey: 'games.blackjack.description'
    },
    {
      id: 'poker-simple', status: 'available', path: 'games/poker-simple/', cover: 'games/poker-simple/cover.webp',
      titleKey: 'games.poker-simple.title', descriptionKey: 'games.poker-simple.description'
    },
    {
      id: 'battleship', status: 'available', path: 'games/battleship/', cover: 'games/battleship/cover.webp',
      titleKey: 'games.battleship.title', descriptionKey: 'games.battleship.description'
    },
    {
      id: 'mines', status: 'available', path: 'games/mines/', cover: 'games/mines/cover.webp',
      titleKey: 'games.mines.title', descriptionKey: 'games.mines.description'
    },
    {
      id: 'checkers', status: 'available', path: 'games/checkers/', cover: 'games/checkers/cover.webp',
      titleKey: 'games.checkers.title', descriptionKey: 'games.checkers.description'
    },
    {
      id: '2048', status: 'available', path: 'games/2048/', cover: 'games/2048/cover.webp',
      titleKey: 'games.2048.title', descriptionKey: 'games.2048.description'
    },
    {
      id: 'blocks', status: 'available', path: 'games/blocks/', cover: 'games/blocks/cover.webp',
      titleKey: 'games.blocks.title', descriptionKey: 'games.blocks.description'
    },
    {
      id: 'next', status: 'soon', path: 'games/next/', cover: 'assets/covers/soon.webp',
      titleKey: 'games.next.title', descriptionKey: 'games.next.description'
    }
  ];
})(typeof window !== 'undefined' ? window : globalThis);
