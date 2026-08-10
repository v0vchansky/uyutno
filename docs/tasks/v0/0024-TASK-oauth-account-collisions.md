# 0024 · TASK · OAuth-коллизии: привязка провайдера и oauth_only-ошибки

- Статус: [ ]
- Эпик: 0005
- Зависит от: 0011, 0015
- Спека: docs/product/features/auth.md (раздел «Коллизии email и привязка провайдеров» — заводится этой задачей)
- Нужен дизайн: нет (согласовано, делаем по guidelines)
- Дизайн: —
- PR: —

## Описание

Сейчас три кросс-сценария между локальной и OAuth-учёткой заканчиваются тупиком:

- **A.** Есть локальная (email+пароль) → вход через OAuth с тем же email → плашка «Войдите паролем и **привяжите Yandex из настроек**», но настроек нет и endpoint'а привязки тоже нет.
- **B.** Есть OAuth-only учётка (`password_hash IS NULL`) → пытаемся зарегистрироваться паролем с тем же email → «email уже занят», без хинта «войдите через Yandex».
- **C.** Есть OAuth-only учётка → пытаемся войти паролем → «Неверная почта или пароль», хотя пароля просто нет.

Задача закрывает **A** (реальная возможность привязки) и **B/C** (правильные тексты ошибок). Смена пароля для OAuth-only юзера — в 0014 (`/forgot-password`), не здесь.

### Часть 1 — Привязка провайдера к текущему юзеру

**Backend.**

- OAuth `state`-cookie расширяется полем `intent: 'signin' | 'link'`. Дефолт — `'signin'` (текущее поведение).
- Новый query-параметр у start-контроллера: `GET /api/v1/auth/oauth/:provider/start?intent=link` — доступен только авторизованному (иначе — `UnauthorizedError`/302 на `/login`). В state кладём `{ state, from, intent: 'link', userId: currentUser.id }`.
- Callback-контроллер разветвляется по `intent`:
  - `signin` — текущий путь (см. 0015).
  - `link` — проверяем, что `currentUser` совпадает с `state.userId` (защита от подмены сессии между start и callback); проверяем, что `oauth_accounts` по `(provider, providerUserId)` **не занят другим юзером** (иначе — редирект на `/settings/accounts?error=link_conflict`). Создаём запись `oauth_accounts` для текущего юзера. Редирект на `/settings/accounts?linked=<provider>`.
- Метод `oauthAccountsRepository.findByUser(userId): OAuthAccountRow[]` — список привязанных провайдеров для UI.
- Метод `oauthAccountsRepository.deleteByUserAndProvider(userId, provider)` — отвязка. Только если у юзера остаётся хотя бы один способ входа (пароль **или** другой OAuth), иначе — `ConflictError('last_login_method')`.
- Endpoint `DELETE /api/v1/auth/oauth/:provider/link` — отвязка провайдера у текущего юзера.

**Frontend.**

- Минимальная страница `/settings/accounts`:
  - Заголовок «Способы входа».
  - Секция «Пароль»: индикатор «Пароль задан / Пароль не задан» + ссылка на `/forgot-password` (после 0014 — «Задать / сменить пароль»).
  - Секция «Привязанные аккаунты»: список провайдеров (Yandex; VK — после 0022) со статусом «Привязан / Не привязан» и кнопкой «Привязать» → `/api/v1/auth/oauth/<provider>/start?intent=link&from=/settings/accounts` / «Отвязать» → `DELETE`-запрос через axios.
  - Плашки успеха/ошибки из query (`?linked=yandex`, `?error=link_conflict`).
- Гард: только для авторизованных (`requireAuth` из 0011).
- Ссылка на `/settings/accounts` в шапке — минимально в user-меню (если его нет — добавляется в этой задаче как иконка/линк рядом с именем из 0023).

### Часть 2 — `oauth_only`-ошибки для register / login

**Backend.**

- В `AuthManager.registerUser` (`AuthManager.ts:49-52`): если `existing.passwordHash === null` — бросаем **не** `ConflictError('email_taken')`, а новый `OAuthOnlyEmailError('oauth_only')`, в теле — массив `providers: OAuthProviderId[]` (из `oauthAccountsRepository.findByUser`).
- В `AuthManager.verifyCredentials` (`AuthManager.ts:59-63`): если `!user.passwordHash` — тоже `OAuthOnlyEmailError('oauth_only')` с `providers`.
- Маппинг в error-middleware: `OAuthOnlyEmailError` → 409, тело `{ code: 'oauth_only', providers: [...] }`.

**Frontend.**

- `RegisterPage`, `LoginPage`: если сервер вернул `code: 'oauth_only'` — плашка над формой: «Этот email привязан к <Yandex ID / VK ID / Yandex ID и VK ID>. Войдите через <первого провайдера>» + кнопка соответствующего провайдера подсвечивается (например, обводка `border-accent`).
- Не пересобираем OAuth-URL руками — просто скроллим/подсвечиваем существующую кнопку.

### Приёмка UI (Playwright MCP)

- **Сценарий A → фикс:** локальный юзер `foo@bar.ru` (с паролем). Логинимся паролем. Идём в `/settings/accounts` → жмём «Привязать Yandex ID» → возвращаемся с `?linked=yandex`, статус «Привязан». Выходим. Логинимся снова через Yandex → входим в ту же учётку.
- **Сценарий B → фикс:** OAuth-only юзер `oauth@bar.ru`. Пытаемся зарегистрироваться паролем этим же email → плашка «Этот email привязан к Yandex ID. Войдите через Yandex» + подсвечена кнопка Yandex.
- **Сценарий C → фикс:** OAuth-only юзер `oauth@bar.ru`. Пытаемся залогиниться паролем → та же плашка.
- **Attach-конфликт:** привязать Yandex, который уже привязан к другому юзеру → `?error=link_conflict`, плашка «Этот Yandex ID уже привязан к другой учётке».
- **Detach:** отвязать Yandex у юзера с паролем → 200, статус «Не привязан». Попытаться отвязать единственный способ входа у OAuth-only юзера → 409 `last_login_method`, плашка «Нельзя отвязать: это ваш единственный способ входа».
- Прогнать golden path на 1440 / 768 / 390.

## Приёмка

- [ ] `state`-cookie поддерживает `intent: 'signin' | 'link'`; start-контроллер требует авторизацию при `intent=link`.
- [ ] Callback в режиме `link` создаёт запись в `oauth_accounts` для текущего юзера; при коллизии с другим юзером — редирект на `/settings/accounts?error=link_conflict`, запись не создаётся.
- [ ] Проверка `state.userId === currentUser.id` — сессия не подменяется между start и callback.
- [ ] `DELETE /api/v1/auth/oauth/:provider/link` — отвязывает; запрет отвязки последнего способа входа (`last_login_method` → 409).
- [ ] Страница `/settings/accounts` рендерится, показывает статус пароля и список провайдеров, кнопки «Привязать/Отвязать» работают.
- [ ] `AuthManager.registerUser` и `verifyCredentials` бросают `OAuthOnlyEmailError` при `password_hash IS NULL`; UI показывает плашку с корректным списком провайдеров и подсвечивает нужную кнопку.
- [ ] Тексты плашек согласованы (Yandex ID / VK ID — из общего справочника провайдеров).
- [ ] После 0022 (VK) — та же логика работает для VK без дополнительных правок в контроллерах.

## Заметки

- Задача **разблокирует некорректный текст** плашки «привяжите Yandex из настроек» из 0015 — до её сдачи плашка врёт. Формально это долг 0015, гасится тут.
- Смена пароля / выдача пароля OAuth-only юзеру — в 0014 (`/forgot-password`). После 0014 сценарий C рассасывается сам, но плашка `oauth_only` всё равно нужна для UX (пока юзер сам не пройдёт reset).
- «Полная» страница настроек аккаунта (профиль, аватар, смена email и т.п.) — вне скоупа. Здесь ровно `/settings/accounts` c двумя секциями.
- Меню пользователя в шапке (аватар + дропдаун с выходом и ссылкой на настройки) — если к моменту 0024 его всё ещё нет, добавляется здесь минимально; иначе — ссылка на `/settings/accounts` включается в существующий дропдаун.
