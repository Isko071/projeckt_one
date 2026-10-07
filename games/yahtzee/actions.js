// Ятзи как набор «действий»: единственный способ изменить партию, пригодный и для игры по сети.
// Подключается после logic.js и дополняет объект Yahtzee функциями reduce и view.
//   Yahtzee.reduce(state, action, rng) → { ok: true, state, events } | { ok: false, error }
// Состояние не меняется на месте: возвращается новая копия. Действие приходит от места за столом (seat),
// и reduce сам проверяет, чей сейчас ход, поэтому серверу достаточно переслать действие и не доверять клиенту.
// Действия: { type: 'roll', seat } · { type: 'toggleHold', seat, index } · { type: 'score', seat, category }
(function () {
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function reduce(state, action, rng) {
    if (!state || !action || typeof action.type !== 'string') return { ok: false, error: 'bad-action' };
    if (state.gameOver) return { ok: false, error: 'game-over' };
    if (action.seat !== state.current) return { ok: false, error: 'not-your-turn' };
    var next = clone(state), events = [];
    if (action.type === 'roll') {
      if (!Yahtzee.roll(next, rng)) return { ok: false, error: 'no-rolls-left' };
      events.push({ type: 'rolled', seat: action.seat, dice: next.dice.slice() });
    } else if (action.type === 'toggleHold') {
      if (!Number.isInteger(action.index) || !Yahtzee.toggleHold(next, action.index)) return { ok: false, error: 'cannot-hold' };
      events.push({ type: 'held', seat: action.seat, index: action.index });
    } else if (action.type === 'score') {
      var points = Yahtzee.possibleScore(next.players[next.current], action.category, next.dice);
      if (typeof action.category !== 'string' || !Yahtzee.scoreCategory(next, action.category)) return { ok: false, error: 'cannot-score' };
      events.push({ type: 'scored', seat: action.seat, category: action.category, points: points });
      if (next.gameOver) events.push({ type: 'gameOver' });
    } else return { ok: false, error: 'unknown-action' };
    return { ok: true, state: next, events: events };
  }

  // В «Ятзи» скрытой информации нет: все видят всё. Функция есть для единообразия с картами.
  function view(state) { return clone(state); }

  Yahtzee.reduce = reduce;
  Yahtzee.view = view;
})();
