# Backend API для Verdant Launcher

В клиенте подготовлен Main-process адаптер. Он выполняет запросы из Electron Main, а не Renderer. Access/refresh tokens не пересекают IPC и при включённом «Запомнить меня» хранятся зашифрованными через системный `safeStorage`.

## Подключение адреса

В `.env` для разработки:

```dotenv
VITE_USE_MOCKS=false
VERDANT_API_BASE_URL=https://api.example.net/
```

Для локального backend разрешён `http://localhost:<port>`. На любом внешнем адресе обязателен HTTPS. Не добавляйте токены или пароль БД в `.env` лаунчера.

Для сборки Windows Installer можно записать URL в `.env` перед сборкой либо передать его процессу сборки: в PowerShell `$env:VERDANT_API_BASE_URL="https://api.example.net"; npm run build:win`. Electron Vite встраивает только публичный base URL в Main bundle; пароли и токены так передавать нельзя. Если URL не задан, приложение запускается в API OFFLINE.

Если `VERDANT_API_BASE_URL` не задан, launcher остаётся в режиме API OFFLINE. Если задан корректный URL, badge покажет «АДРЕС API ЗАДАН» — это означает, что адаптер сконфигурирован, но доступность сервера проверяется фактическим запросом, а не по наличию строки.

## Контракт v1

Все ответы JSON, даты — ISO 8601, ошибки — HTTP status + `{ "error": { "code": "...", "message": "..." } }`.

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/v1/auth/register` | Создание аккаунта (body: username, email, password, acceptedRules: true) |
| POST | `/v1/auth/login` | Вход по username/password |
| POST | `/v1/auth/refresh` | Обновление пары токенов |
| POST | `/v1/auth/logout` | Отзыв refresh-сессии |
| POST | `/v1/auth/password-reset` | Запрос сброса пароля |
| GET | `/v1/account/me` | Профиль текущей сессии |
| PATCH | `/v1/account/me` | Обновление username/email |
| GET | `/v1/news` | Массив статей или `{ "items": [...] }` |
| GET | `/v1/news/:id` | Одна статья или `null` |
| GET | `/v1/server/status` | Онлайн, players, capacity, latency |

Успешный ответ register/login:

```json
{
  "accessToken": "<opaque-or-jwt-access-token>",
  "refreshToken": "<opaque-rotating-refresh-token>",
  "expiresAt": "2026-11-02T22:00:00.000Z",
  "profile": {
    "id": "user_123",
    "username": "Wanderer",
    "email": "player@example.net",
    "registeredAt": "2026-11-02T18:00:00.000Z",
    "group": "Игрок",
    "status": "active",
    "minecraft": null
  }
}
```

Refresh request: `{ "refreshToken": "..." }`; response: `{ "accessToken": "...", "refreshToken": "...", "expiresAt": "..." }`. Refresh token должен ротироваться. Если токен отозван, endpoint возвращает 401.

Профиль соответствует полю `profile` из login response. Статья новости:

```json
{
  "id": "news_001",
  "title": "Открытие нового сезона",
  "excerpt": "Короткий анонс",
  "content": "Полный текст публикации",
  "category": "Объявления",
  "date": "2026-11-02T18:00:00.000Z",
  "image": "worlds/village-lake.webp",
  "pinned": true
}
```

Статус сервера:

```json
{ "online": true, "players": 38, "capacity": 120, "latency": 24, "message": "Online" }
```

## Безопасность, которую нужно обеспечить на backend

- Пароли хранить только как Argon2id hash (не plaintext, не обратимое шифрование).
- Access token короткоживущий; refresh token — случайный, ротируемый, хранить на сервере только hash.
- Проверять rate limits на login/register/password-reset, унифицировать ответы восстановления пароля.
- Подтверждать email и валидировать лимиты/уникальность username.
- Ограничить CORS не требуется для Electron Main как браузерной страницы, но HTTP API всё равно обязан иметь TLS, авторизацию и rate limits.
- Админские endpoints новостей/ролей отделить от публичных и проверять права на backend.
- Для статуса Minecraft backend сам опрашивает игровой сервер по адресу и query/status протоколу; клиенту не выдавать RCON пароль.
- Не принимать произвольные URL manifest. Файлы должны идти только с CDN allowlist, с SHA-256 и размером.
- Секреты — через environment/secret manager на сервере, не коммитить в Git и не вставлять в launcher `.env`.

## Что пока не подключено

- Minecraft Microsoft OAuth/link endpoints.
- Real Fabric/manifest/download/launch engine.
- Launcher auto-updater provider.
- RCON/admin/whitelist/game moderation endpoints.
- Загрузка картинок новости и отдельный CDN.

Существующий клиентский adapter уже содержит маршруты для регистрации/входа/профиля/новостей/статуса. Реальный backend должен реализовать этот контракт либо согласованно изменить схемы `src/shared/schemas/backend.ts`.

## Что нужно подготовить для подключения к живому серверу

1. VPS или backend-хостинг с Ubuntu 24.04 LTS, доступом к установке Docker и открытыми портами 80/443. Доступ к панели/SSH нужен тебе, но приватный ключ и пароли не отправляй в чат.
2. Домен или поддомен вида `api.твой-домен` с DNS A-записью на публичный IP VPS. TLS можно поднять через Caddy.
3. PostgreSQL 16+ (контейнер на том же VPS или управляемая БД), резервные копии и отдельный пользователь БД с минимальными правами.
4. Публичный адрес Minecraft Java сервера и порт статуса (обычно игровой TCP-порт). RCON password не нужен и никому не передавай.
5. Решение по регистрации: открытая или только по приглашениям; нужен ли email verification; какие группы/привилегии должны быть в первом релизе.

Когда будешь готов, пришли только публичные данные: провайдера/VPS, IP, домен API (или выбранное имя), адрес Minecraft Java сервера и порт, и ответ по регистрации. Не присылай SSH private key, пароль root, DB password, Microsoft client secret или RCON secret. По этим данным можно дать точные команды развёртывания и заполнить `.env` клиента.
