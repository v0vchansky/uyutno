# 0015 · TASK · OAuth Yandex ID

- Статус: [ ]
- Эпик: 0005
- Зависит от: 0011, 0010
- Спека: docs/product/features/auth.md#вход-регистрация-через-yandex-id-и-vk-id
- PR: —

## Описание

Реализация OAuth-flow для Yandex ID: старт авторизации, callback-эндпоинт, обмен кода на профиль, вход или регистрация, обработка коллизии email.

VK ID вынесен в 0022 — здесь про VK ничего не пишем, но абстракцию `OAuthProvider` проектируем сразу так, чтобы 0022 добавил вторую реализацию без переделки скелета.

### Backend (`src/server/auth/oauth/`)

- Абстракция `OAuthProvider`:
  ```ts
  interface OAuthProvider {
    id: 'yandex' | 'vk';
    getAuthorizeUrl(state: string, redirectUri: string): string;
    exchangeCode(code: string, redirectUri: string): Promise<{ providerUserId: string; email: string | null }>;
  }
  ```
- Реализация `YandexProvider` — использует креды из `process.env` (0010).
- Контроллеры:
  - `GET /api/v1/auth/oauth/:provider/start` (`:provider` пока принимает только `yandex`; для `vk` — 404 до 0022):
    1. Генерирует случайный `state` (≥32 байта).
    2. Кладёт в short-lived cookie `oauth_state` (`HttpOnly`, `Secure`, `SameSite=Lax`, TTL 10 мин) значение `{ state, from }` (JSON или подписанная строка).
    3. Делает `res.redirect(provider.getAuthorizeUrl(state, redirectUri))`.
  - `GET /auth/callback/:provider` (аналогично — только `yandex`):
    1. Читает cookie `oauth_state`, парсит; при отсутствии или несовпадении с `req.query.state` — 400.
    2. `provider.exchangeCode(code, redirectUri)` → `{ providerUserId, email }`.
    3. Ищет запись в `oauth_accounts` по `(provider, providerUserId)`:
       - **есть** → берём `user_id`, `sessionService.issueSession`, редирект на `from` (если валиден) или `/projects`.
       - **нет** и email **не занят** → создаём `user` с `password_hash = NULL`, создаём запись в `oauth_accounts`, `sessionService.issueSession`, редирект.
       - **нет** и email **занят** локальной учёткой → редирект на `/login?error=oauth_email_taken&from=…` (без создания записей). На `/login` эта ошибка отрисовывается как плашка «Этот email уже зарегистрирован. Войдите паролем и привяжите Yandex из настроек».
    4. В любом случае — удаляем cookie `oauth_state` после обработки.
- Rate limit на `/oauth/:provider/start`: 20 / час на IP.
- Валидация `from` — та же helper из 0011 (`normalizeFromParam`).

### Frontend

- В `LoginPage` и `RegisterPage` кнопка Yandex ID уже ведёт на `/api/v1/auth/oauth/yandex/start?from=<current-from>` — проверить, что endpoint работает, и заменить монограмму на официальный SVG из 0010.
- Кнопку VK ID в `LoginPage` / `RegisterPage` временно **отключить** (disabled + tooltip «Скоро») либо скрыть до 0022, чтобы не вести пользователя в 404.
- В `LoginPage` — обработка `?error=oauth_email_taken` (плашка над кнопкой с соответствующим текстом).

### Приёмка UI (Playwright MCP)

Полный e2e с реальным Yandex-аккаунтом через Playwright автоматизировать невозможно (нужен вход в чужой сервис). Приёмка — вручную:

- Пройти вход через тестовый Yandex ID (у @v0vchansky есть).
- Проверить сценарий коллизии email: зарегистрировать `test@…` паролем, затем попытаться зайти через Yandex ID с тем же email — увидеть плашку на `/login`.
- Проверить, что `from` доживает до конца flow.
- Проверить, что кнопка VK на `/login` и `/register` в состоянии disabled/скрыта.

## Приёмка

- [ ] Кнопка Yandex ID на `/login` и `/register` ведёт в OAuth-flow и завершается установкой сессии + редиректом на `from` (или `/projects`).
- [ ] Существующий OAuth-пользователь входит без создания нового `user` (проверка по `oauth_accounts`).
- [ ] Новый OAuth-пользователь (email не занят) создаёт учётку с `password_hash = NULL` + запись в `oauth_accounts`.
- [ ] Коллизия email (email занят локальной учёткой) редиректит на `/login` с плашкой и не создаёт записей.
- [ ] `state` проверяется, при подделке — 400; cookie `oauth_state` удаляется после обработки.
- [ ] `?from` доживает через весь flow (start → провайдер → callback → редирект).
- [ ] Токены провайдера не сохраняются в БД (ADR 0005) — проверяется ревью кода.
- [ ] Кнопка VK ID временно недоступна (disabled/скрыта); включение — в 0022.
- [ ] Абстракция `OAuthProvider` спроектирована так, что 0022 добавляет `VkProvider` без изменения контроллеров и роутинга.

## Заметки

—
