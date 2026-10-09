// Связь покера с сервером столов: один клиент на игрока и игру, общий для экранов обоих покеров.
//   PokerNet.create({ gameId: 'poker' | 'poker-simple', variant, Cloud, onStatus })
//   → { available(), api() }   api() — shared/rooms-ws.js для текущего игрока (null без входа или без адреса сервера)
(function (root) {
  function create(cfg) {
    var api = null, uid = null;
    function available() { return !!(root.GAME_SERVER_URL && root.PlatformRoomsWS && root.PlatformPokerRooms && root.Poker); }
    function get() {
      var u = cfg.Cloud.getState().user;
      if (!u || !available()) return null;
      if (!api || uid !== u.uid) {
        if (api) api.shutdown();
        api = root.PlatformRoomsWS.create({
          url: root.GAME_SERVER_URL, getToken: function () { return cfg.Cloud.getToken(); }, uid: u.uid, game: cfg.gameId,
          engine: root.PlatformPokerRooms, engineEnv: { game: root.Poker, gameId: cfg.gameId, gameOptions: { variant: cfg.variant } }
        });
        if (cfg.onStatus) api.onStatus(cfg.onStatus);
        uid = u.uid;
      }
      return api;
    }
    return { available: available, api: get };
  }
  root.PokerNet = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
