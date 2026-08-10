# 0015 · TASK · OAuth Yandex ID

- Статус: [x]
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

- В `LoginPage` и `RegisterPage` кнопка Yandex ID уже ведёт на `/api/v1/auth/oauth/yandex/start?from=<current-from>` — проверить, что endpoint работает. Иконка — временно монограмма «Я» из макета; официальный SVG подъедет отдельным follow-up (см. `Заметки` в 0010).
- Кнопку VK ID в `LoginPage` / `RegisterPage` **полностью убрать из UI** до 0022 (не disable / не hidden — просто удалить, чтобы не занимать место и не путать пользователя). Возврат — в 0022 вместе с работающим бэком. Grid соцвхода схлопывается в одну колонку с одной кнопкой Yandex.
- В `LoginPage` — обработка `?error=oauth_email_taken` (плашка над формой с соответствующим текстом). Заодно предусмотреть `?error=oauth_no_email` для того же плейсхолдера — используется, если Yandex не вернул email (редкий кейс, ставим на будущее и для VK).

### Приёмка UI (Playwright MCP)

Полный e2e с реальным Yandex-аккаунтом через Playwright автоматизировать невозможно (нужен вход в чужой сервис). Приёмка — вручную:

- Пройти вход через тестовый Yandex ID (у @v0vchansky есть).
- Проверить сценарий коллизии email: зарегистрировать `test@…` паролем, затем попытаться зайти через Yandex ID с тем же email — увидеть плашку на `/login`.
- Проверить, что `from` доживает до конца flow.
- Проверить, что кнопки VK на `/login` и `/register` нет вообще (не disabled и не hidden — просто отсутствует в DOM).

## Приёмка

- [x] Кнопка Yandex ID на `/login` и `/register` ведёт в OAuth-flow и завершается установкой сессии + редиректом на `from` (или `/projects`) — подтверждено ручным e2e (@v0vchansky).
- [x] Существующий OAuth-пользователь входит без создания нового `user` (проверка по `oauth_accounts`) — покрыто `OAuthManager.test.ts`.
- [x] Новый OAuth-пользователь (email не занят) создаёт учётку с `password_hash = NULL` + запись в `oauth_accounts` — покрыто `OAuthManager.test.ts`.
- [x] Коллизия email (email занят локальной учёткой) редиректит на `/login` с плашкой и не создаёт записей — юнит-тест + плашка проверена в браузере.
- [x] `state` проверяется, при подделке — 400; cookie `oauth_state` удаляется после обработки — покрыто `oauthStateCookie.test.ts` + `clearOAuthStateCookie` в callback.
- [x] `?from` доживает через весь flow (start → провайдер → callback → редирект) — проверено: payload cookie после `/start?from=/projects/42` содержит `"from":"/projects/42"`.
- [x] Токены провайдера не сохраняются в БД (ADR 0005) — `YandexProvider.exchangeCode` возвращает только `{providerUserId, email}`, `OAuthManager` пишет в `oauth_accounts` без токенов.
- [x] Кнопка VK ID полностью убрана из `LoginPage` и `RegisterPage` до 0022 (нет в DOM) — снапшот подтверждает.
- [x] Абстракция `OAuthProvider` спроектирована так, что 0022 добавляет `VkProvider` без изменения контроллеров и роутинга — `providers.ts` регистрирует провайдеры по `id`, контроллеры работают через `providers.get(id)`.

## Заметки

- Автоматизируемая часть приёмки пройдена: typecheck ✓, 5 test suites / 29 tests ✓, curl `/oauth/yandex/start` → 302 на `oauth.yandex.ru` с корректными параметрами и HMAC-подписанной cookie, UI-проверка `/login` и `/register` на 1440 / 768 / 390 (VK-кнопки нет, плашки `?error=oauth_email_taken` и `?error=oauth_no_email` рендерятся).
- Осталось для закрытия задачи: ручной e2e через реальный Yandex-логин (креды у @v0vchansky), включая сценарий коллизии email на живом БД-состоянии.
