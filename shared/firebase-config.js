// Настройки Firebase для входа через Google и облачного сохранения.
// Это публичные значения (они видны любому сайту в браузере): защиту дают правила базы Firestore и список разрешённых доменов.
var root = typeof window !== 'undefined' ? window : globalThis;
root.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDmQQX3omdd32VDo-BQZBM0mbf90bEkMtQ',
  authDomain: 'igroteka-29263.firebaseapp.com',
  projectId: 'igroteka-29263',
  storageBucket: 'igroteka-29263.firebasestorage.app',
  messagingSenderId: '830740979850',
  appId: '1:830740979850:web:f0921df69204ef1cc68d73'
};
// Имя базы Firestore: в проекте есть только база «(default)» (базы с именем igroteka-db нет, запросы к ней дают 404)
root.FIREBASE_DATABASE = '(default)';
// Адрес сервера столов (WebSocket), например 'wss://igroteka-server.onrender.com'. Пусто — столы работают по-старому, через Firestore
// (хост — браузер создателя). Инструкция по запуску сервера: docs/game-server.md
// Токен Cloudflare Web Analytics (статистика посещений, см. docs/admin.md). Пусто — статистика выключена
root.CF_ANALYTICS_TOKEN = '';
root.GAME_SERVER_URL = 'wss://igroteka-server.onrender.com';
