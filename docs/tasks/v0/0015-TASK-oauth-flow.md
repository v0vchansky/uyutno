# 0015 · TASK · OAuth Yandex ID + VK ID

- Статус: [ ]
- Эпик: 0005
- Зависит от: 0011, 0010
- Спека: docs/product/features/auth.md#вход-регистрация-через-yandex-id-и-vk-id
- PR: —

## Описание

Реализация OAuth-flow для Yandex ID и VK ID: старт авторизации, callback-эндпоинт, обмен кода на профиль, вход или регистрация, обработка коллизии email. Одна задача на двух провайдеров — они отличаются только URL-эндпоинтами и парсингом ответа, скелет общий.

### Backend (`src/server/auth/oauth/`)

- Абстракция `OAuthProvider`:
  ```ts
  interface OAuthProvider {
    id: 'yandex' | 'vk';
    getAuthorizeUrl(state: string, redirectUri: string): string;
    exchangeCode(code: string, redirectUri: string): Promise<{ providerUserId: string; email: string | null }>;
  }
  ```
- Реализации `YandexProvider` и `VkProvider` — используют креды из `process.env` (0010). Особенности VK (email в теле token-response, у некоторых пользователей email может отсутствовать — в этом случае возвращаем ошибку с сообщением «У вашего аккаунта VK нет привязанного email, войдите через email/пароль»).
- Контроллеры:
  - `GET /api/v1/auth/oauth/:provider/start`:
    1. Генерирует случайный `state` (≥32 байта).
    2. Кладёт в short-lived cookie `oauth_state` (`HttpOnly`, `Secure`, `SameSite=Lax`, TTL 10 мин) значение `{ state, from }` (JSON или подписанная строка).
    3. Делает `res.redirect(provider.getAuthorizeUrl(state, redirectUri))`.
  - `GET /auth/callback/:provider`:
    1. Читает cookie `oauth_state`, парсит; при отсутствии или несовпадении с `req.query.state` — 400.
    2. `provider.exchangeCode(code, redirectUri)` → `{ providerUserId, email }`.
    3. Ищет запись в `oauth_accounts` по `(provider, providerUserId)`:
       - **есть** → берём `user_id`, `sessionService.issueSession`, редирект на `from` (если валиден) или `/projects`.
       - **нет** и email **не занят** → создаём `user` с `password_hash = NULL`, создаём запись в `oauth_accounts`, `sessionService.issueSession`, редирект.
       - **нет** и email **занят** локальной учёткой → редирект на `/login?error=oauth_email_taken&from=…` (без создания записей). На `/login` эта ошибка отрисовывается как плашка «Этот email уже зарегистрирован. Войдите паролем и привяжите Yandex/VK из настроек».
       - email пуст (случай VK) → редирект на `/login?error=oauth_no_email&from=…`.
    4. В любом случае — удаляем cookie `oauth_state` после обработки.
- Rate limit на `/oauth/:provider/start`: 20 / час на IP.
- Валидация `from` — та же helper из 0011 (`normalizeFromParam`).

### Frontend

- В `LoginPage` и `RegisterPage` (задачи 0012, 0013): кнопки Yandex ID и VK ID из макета теперь становятся ссылками на `/api/v1/auth/oauth/:provider/start?from=<current-from>`. Помечены официальными SVG из 0010.
- В `LoginPage` — обработка `?error=oauth_email_taken` и `?error=oauth_no_email` (плашка над кнопкой с соответствующим текстом).

### Приёмка UI (Playwright MCP)

Полный e2e с реальными Yandex/VK-аккаунтами через Playwright автоматизировать невозможно (нужен вход в чужие сервисы). Приёмка — вручную:

- Пройти вход через тестовый Yandex ID (у @v0vchansky есть).
- Пройти вход через тестовый VK ID.
- Проверить сценарий коллизии email: зарегистрировать `test@…` паролем, затем попытаться зайти через Yandex ID с тем же email — увидеть плашку на `/login`.
- Проверить, что `from` доживает до конца flow.

## Приёмка

- [ ] Кнопки Yandex ID и VK ID на `/login` и `/register` ведут в OAuth-flow и завершаются установкой сессии + редиректом на `from` (или `/projects`).
- [ ] Существующий OAuth-пользователь входит без создания нового `user` (проверка по `oauth_accounts`).
- [ ] Новый OAuth-пользователь (email не занят) создаёт учётку с `password_hash = NULL` + запись в `oauth_accounts`.
- [ ] Коллизия email (email занят локальной учёткой) редиректит на `/login` с плашкой и не создаёт записей.
- [ ] Отсутствие email от провайдера (сценарий VK) обрабатывается плашкой на `/login`.
- [ ] `state` проверяется, при подделке — 400; cookie `oauth_state` удаляется после обработки.
- [ ] `?from` доживает через весь flow (start → провайдер → callback → редирект).
- [ ] Токены провайдера не сохраняются в БД (ADR 0005) — проверяется ревью кода.

## Заметки

—
