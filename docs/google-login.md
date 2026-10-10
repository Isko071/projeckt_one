# Вход через Google и облачное сохранение

Единственный способ войти на сайт: Google-аккаунт (Firebase Authentication). Без входа можно играть как гость, прогресс тогда хранится только в этом браузере. Своего сервера нет: браузер обращается к Firebase сам.

## Как это устроено

- `shared/cloud.js` (`PlatformCloud`): вход через окно Google (`signInWithPopup`), чтение и запись записи `users/<uid>` в Firestore по REST с токеном игрока. Подключается на каталоге и на страницах игр.
- `shared/progress.js` (`PlatformProgress`): снимок прогресса (ключи `platform:profile`, `platform:wallet` и все `game:*`), его применение, отпечаток, проверка «чистый гость».
- `shared/sync-logic.js`: чистая функция `decide`: загрузить в облако, взять из облака, ничего не делать или спросить игрока.
- `catalog/account-ui.js`: пункты меню аватара «Войти через Google» / «Выйти из аккаунта», статус облака, окно выбора прогресса при конфликте.
- `shared/firebase-config.js`: публичные настройки проекта и имя базы (`(default)`).

## Правила синхронизации

Устройство помнит отпечаток последней синхронизации (`platform:sync`). Сверка идёт при входе, каждые 15 секунд (если прогресс изменился) и при уходе со страницы:

| Ситуация | Что происходит |
|---|---|
| В облаке пусто | прогресс устройства загружается |
| Одинаково | ничего |
| Устройство — чистый гость | берётся облако, страница перезагружается |
| Здесь не менялось, в облаке новее | берётся облако |
| В облаке не менялось, здесь новее | загружается прогресс устройства |
| Изменились обе стороны (или раньше не синхронизировались) | окно «Какой прогресс оставить?» |

На странице игры облако не подменяет прогресс: он обновится при открытии каталога. Имя из Google подставляется, пока в профиле стоит имя по умолчанию.

**Выход** сначала отправляет несохранённое, затем стирает прогресс на устройстве (в облаке он остаётся). Если отправить не удалось, выход отменяется, пока игрок не согласится потерять несохранённое.

## Настройка Firebase (сделана для проекта `igroteka-29263`)

1. Authentication → Sign-in method → Google включён.
2. Authentication → Settings → Authorized domains: домен сайта (например `isko071.github.io`).
3. Firestore: база `(default)` (именованной базы `igroteka-db` в проекте нет, запросы к ней дают 404), правила:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
      // Личный кабинет владельца (docs/admin.md): читать записи всех игроков может только его аккаунт Google
      allow read: if request.auth != null && request.auth.token.email == 'АДРЕС_ВЛАДЕЛЬЦА@gmail.com' && request.auth.token.email_verified == true;
    }

    // Рейтинг игроков (docs/rating.md): свою строку пишет сам игрок, читают все вошедшие
    match /ratings/{uid} {
      allow read: if request.auth != null;
      allow create, update: if request.auth != null && request.auth.uid == uid
        && request.resource.data.balance is int && request.resource.data.balance >= 0
        && request.resource.data.name is string && request.resource.data.name.size() <= 20;
    }

    // Онлайн-столы (блэкджек и другие игры), подробности: online-tables.md
    match /rooms/{code} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.resource.data.hostUid == request.auth.uid;
      allow update: if request.auth != null && resource.data.hostUid == request.auth.uid
                       && request.resource.data.hostUid == request.auth.uid;
      allow delete: if request.auth != null && resource.data.hostUid == request.auth.uid;

      match /actions/{id} {
        allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
        allow read, delete: if request.auth != null
          && get(/databases/$(database)/documents/rooms/$(code)).data.hostUid == request.auth.uid;
      }
    }
  }
}
```
Блок `rooms` нужен только для онлайн-столов; без него вход и прогресс работают, а онлайн нет.
4. Сайт публикуется по https (GitHub Pages). С `file://` вход не работает, прогресс остаётся локальным.

## Аватар профиля

В окне «Профиль» можно выбрать: **фото Google-аккаунта** (появляется после входа), один из 24 **эмодзи** (повторное нажатие снимает выбор) и цвет кружка (по умолчанию в кружке первая буква имени). Приоритет: фото Google, затем эмодзи, затем буква. После первого входа имя и фото из Google подставляются сами, если профиль ещё не настроен (в профиле «Игрок»); выбранный эмодзи фото не вытесняет. Выбор хранится в профиле (`icon`, `google`) и синхронизируется с облаком. Сам файл фото не копируется: оно показывается по ссылке Google, а если не загрузилось, показывается эмодзи или буква.

## Ограничения

- Игры считают аконы в браузере, значит их можно подправить вручную. Пока аконы ничего не стоят, это допустимо; для мультиплеера и рейтингов проверки нужно переносить на сервер (см. [заготовку под мультиплеер](multiplayer.md)).
- В базе хранятся имя профиля и прогресс, в аккаунте Firebase — имя и почта Google. Нужна страница о конфиденциальности (открытый вопрос в [дорожной карте](roadmap.md)).
- Все сайты `isko071.github.io/<проект>` одного владельца делят один `localStorage`; наши ключи имеют префиксы `platform:` и `game:`.
