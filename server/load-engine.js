// Загрузка общего кода игр и комнат (shared/*, games/*/logic.js): это обычные браузерные файлы без сборки,
// поэтому сервер выполняет их в отдельном контексте vm. Так правила игр, таймеры и чат у сервера и у браузера один и тот же код.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'shared/chat-logic.js',
  'games/blackjack/logic.js',
  'games/yahtzee/logic.js',
  'games/yahtzee/table.js',
  'games/poker/logic.js',
  'shared/rooms.js',
  'shared/rooms-turns.js',
  'shared/rooms-poker.js'
];

function loadEngine() {
  const ctx = vm.createContext({ JSON, Promise, Math, Object, Array, Number, String, Error, Date, Boolean, RegExp, parseInt, parseFloat, isNaN });
  FILES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  return {
    Blackjack: vm.runInContext('Blackjack', ctx),
    YahtzeeTable: ctx.YahtzeeTable,
    PlatformRooms: ctx.PlatformRooms,
    Poker: ctx.Poker,
    PlatformTurnRooms: ctx.PlatformTurnRooms,
    PlatformPokerRooms: ctx.PlatformPokerRooms,
    PlatformChat: ctx.PlatformChat
  };
}

module.exports = { loadEngine };
