# 0012 · TASK · /login — форма + POST /auth/login

- Статус: [x]
- Эпик: 0005
- Зависит от: 0011
- Спека: docs/product/features/auth.md#вход-emailпароль
- PR: —

## Описание

Страница входа email/пароль по макету `/login` из [`docs/ui/handoffs/auth/Auth Screens.dc.html`](../../ui/handoffs/auth/Auth%20Screens.dc.html) + серверный эндпоинт `POST /api/v1/auth/login`. Кнопки OAuth-соцвхода уже отрисованы в макете, но обрабатываются в задаче 0015 — здесь они видимы, но клик просто редиректит на `/api/v1/auth/oauth/:provider/start` (может отвечать 501 «not implemented» до 0015).

### Frontend (`src/client/landing/pages/LoginPage/`)

- Свёрстать по макету на HeroUI v3 и токенах `theme-uyutno.css`, инлайн-CSS из `.dc.html` не переносить. Три размера (desktop 1440, tablet 768, mobile 390) обязательны — единственный брейкпоинт ≤400px из `docs/ui/handoffs/auth/README.md#responsive`.
- Форма: поля email (`type=email`, `autocomplete=email`), пароль (`type=password`, `autocomplete=current-password`), ссылка «Забыли пароль?» → `/forgot-password` (с пробросом `from`).
- Состояния из спеки: `idle`, `submitting` (кнопка disabled, текст «Входим…»), `error` (плашка над кнопкой: «Неверная почта или пароль» / «Слишком много попыток, попробуйте позже» / «Что-то пошло не так, попробуйте ещё раз» — по коду ответа), успех — редирект.
- Enter в любом поле отправляет форму.
- Валидация формата email на клиенте до сабмита (базовый regex + max 254 символа); серверная валидация — авторитетная.
- **Логика `from`:**
  - При загрузке страницы читаем `?from` из URL, валидируем через клиентский helper (тот же критерий, что серверный `normalizeFromParam` из 0011).
  - Ссылки «Зарегистрироваться» → `/register?from=…`, «Забыли пароль?» → `/forgot-password?from=…` используют `buildAuthUrl` из `client/auth/lib/` (задача 0011).
  - После успешного входа — редирект на `from` (если валиден), иначе на `/projects`.
- Гард `redirectIfAuthenticated` из 0011 уводит залогиненного пользователя с этой страницы автоматически на серверной стороне — на клиенте отдельной проверки не нужно.
- Свои `<title>` и `<meta name="description">` (по правилу из `src/client/CLAUDE.md`).

### Backend (`src/server/auth/`)

- Zod-схема тела в `src/shared/auth/` — `LoginRequest { email: string; password: string }`, использовать и клиентом (для типов), и сервером (для валидации).
- Контроллер `POST /api/v1/auth/login`:
  1. Валидация тела (Zod). Ошибка формата → `ValidationError` → 400.
  2. Нормализация email (lowercase + trim).
  3. `usersRepository.findByEmail`; если нет — вернуть `UnauthorizedError` (401) с сообщением «Неверная почта или пароль».
  4. Если `password_hash` пуст (OAuth-only юзер) — тот же 401 «Неверная почта или пароль» (не раскрываем).
  5. `argon2.verify(hash, password)`; при неудаче — 401.
  6. `sessionService.issueSession(user.id)`, установка cookie.
  7. Ответ 200 без тела (или с `{ user }` — на усмотрение исполнителя; клиент всё равно перезапросит через `/auth/me` или прочитает из SSR при следующей навигации). Клиент выполняет редирект уже сам.
- Rate limit (`express-rate-limit`, in-memory): 5 запросов / 15 мин на IP + 5 / 15 мин на email. При исчерпании — 429.
- Использовать `argon2` npm-пакет с параметрами по актуальной OWASP-рекомендации (ADR 0005).

### Приёмка UI (Playwright MCP)

- Открыть `/login` в браузере (`browser_navigate`).
- Пройти golden path: ввести валидные креды тестового юзера (создать вручную через psql или отдельным сидом), убедиться в редиректе на `/projects`.
- Проверить edge-кейсы: неверный пароль → плашка, спам-запросы → 429-плашка.
- Повторить golden path на трёх ширинах (`browser_resize` 1440 / 768 / 390).
- Проверить сохранение `from`: открыть `/login?from=%2Fprojects%2Fabc`, перейти по «Зарегистрироваться», убедиться что URL стал `/register?from=%2Fprojects%2Fabc`.

## Приёмка

- [x] Страница `/login` рендерится и визуально совпадает с макетом на desktop / tablet / mobile.
- [x] `POST /api/v1/auth/login` с валидной парой создаёт сессию, устанавливает cookie, клиент редиректит на `/projects` (или на `from`).
- [x] Неверная пара логин-пароль возвращает 401; плашка над кнопкой; курсор в поле email (или без — на усмотрение, лишь бы форма редактируема).
- [x] Rate limit срабатывает на 6-й попытке (5+1) в 15-минутном окне, ответ 429; UI показывает нейтральную плашку.
- [x] Enter в любом поле отправляет форму. Клавиша Tab — обычный tab-порядок.
- [x] Уже залогиненный пользователь редиректится с `/login` на `/projects` (SSR-редирект из 0011).
- [x] `?from` сохраняется в ссылке «Зарегистрироваться» и «Забыли пароль?».
- [x] После успешного входа с `?from=/projects/abc` пользователь оказывается на `/projects/abc`; с невалидным `from` — на `/projects`.
- [x] Страница рендерит свои `<title>` и `<meta name="description">`.

## Заметки

—
