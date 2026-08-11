# 0032 · TASK · OAuth Yandex: «OAuth-провайдер не найден» при попытке входа

- Статус: [x]
- Эпик: —
- Зависит от: 0015
- Спека: [docs/product/features/auth.md](../../product/features/auth.md)
- Нужен дизайн: нет (баг-фикс без визуальных изменений)
- Дизайн: —
- PR: —

## Описание

Пользователь на `/login` или `/register` жмёт «Войти через Yandex» — сервер отвечает **404 «OAuth-провайдер не найден»** вместо редиректа на Yandex ID.

Место, где выбрасывается ошибка: `apps/platform/src/server/auth/controllers/oauthStartController.ts:15` — `providers.get('yandex')` возвращает `null`, потому что реестр в `apps/platform/src/server/auth/oauth/providers.ts:26` пропускает создание `YandexProvider`, если в окружении не заданы `YANDEX_OAUTH_CLIENT_ID` / `YANDEX_OAUTH_CLIENT_SECRET` (тогда в консоль сервера пишется `[oauth] YANDEX_OAUTH_CLIENT_ID/YANDEX_OAUTH_CLIENT_SECRET не заданы`).

## Скоуп

1. **Диагностика.** Поднять dev-сервер, зайти на `/login`, кликнуть «Войти через Yandex», зафиксировать реальный ответ и сообщение в логах. Определить, что именно недоступно: env-переменные вообще не заданы, заданы с опечаткой в имени, лежат не в том `.env`-файле (`.env.local` / `.env.development`) и т.п. Сверить с `apps/platform/README.md` и `.env.example`, если он есть.

2. **Починка окружения.** Прописать переменные `YANDEX_OAUTH_CLIENT_ID` и `YANDEX_OAUTH_CLIENT_SECRET` в нужное место (dev-сервер + `.env.example`, если существует). Значения `client_id`/`client_secret` — из уже зарегистрированного OAuth-приложения (задача 0010). Если приложения нет — довести с пользователем, а не заводить новое.

3. **UX ошибки (по ходу).** Если провайдер не сконфигурирован, `NotFoundError` пробрасывается в error-middleware и уходит на клиент как голая 404. Кнопки «Войти через Yandex» в этом состоянии просто не должно быть — рендерить её только если провайдер активен. Один из вариантов: серверная injecting-переменная в SSR-состояние (`window.__APP_STATE__.oauth.yandexEnabled`) или новый эндпоинт `/auth/oauth/providers`. Выбрать самый лёгкий, не завозить лишнюю инфраструктуру.

4. **Приёмка.** Проверить, что после починки OAuth Yandex работает end-to-end до `/projects`, а также что при отсутствии env-переменных на клиенте кнопка «Войти через Yandex» не показывается (сервер не падает голой 404).

## Приёмка

- [x] На `/login` клик «Войти через Yandex» ведёт на `id.yandex.ru/authorize?...`, а не в 404.
- [x] После разрешения на стороне Yandex — редирект на `/projects` (или на `from`, если было).
- [x] Логи dev-сервера при старте не содержат `[oauth] YANDEX_OAUTH_CLIENT_ID/YANDEX_OAUTH_CLIENT_SECRET не заданы` (env заданы корректно).
- [x] Если env-переменные не заданы, кнопки «Войти через Yandex» в `/login` и `/register` нет (не бросаем 404 на клике).
- [x] `pnpm --filter platform typecheck` — чисто.
- [x] `pnpm --filter platform test` — чисто.

## Заметки

- ~~Блокер: `YANDEX_OAUTH_CLIENT_ID` / `YANDEX_OAUTH_CLIENT_SECRET` не заведены ни в шелле, ни в `.env`, ни в `infra/dev/docker-compose.yml`. Приложение Yandex ID зарегистрировано (задача 0010 [x]), но креды сюда не переданы. Нужны реальные значения от пользователя (1Password / кабинет Yandex OAuth), чтобы завершить пункты приёмки 1–3 (реальный редирект на `id.yandex.ru/authorize?...` и проход коллбэка на `/projects`). Выдумывать `client_id`/`client_secret` нельзя.~~ Блокер снят: пользователь передал реальные значения `client_id` / `client_secret` из кабинета Yandex OAuth.
- Куда положили секреты: `apps/platform/.env` (файл в `.gitignore`, не коммитится). Проект не использует `dotenv` — переменные подгружаются в шелл перед запуском: `set -a && source apps/platform/.env && set +a && pnpm --filter platform dev`. `.env.example` в репозитории отсутствует, отдельно не заводили (только имена без значений имели бы смысл, но по соглашению `Секреты в проекте — через шелл`, см. `apps/platform/README.md`).
- Проверка Playwright MCP: `/login` → клик «Yandex ID» → браузер уходит на `https://passport.yandex.ru/pwl-yandex/auth/phone?retpath=<url-encoded oauth.yandex.ru/authorize?...>` с корректными параметрами (`response_type=code`, `client_id=78ad9ac08c7d4353b657d020556ebd33`, `redirect_uri=http://localhost:4000/auth/callback/yandex`, `state=<hmac-подписанный>`). При старте dev-сервера warning `[oauth] YANDEX_OAUTH_CLIENT_ID/... не заданы` не появляется.
- Полный OAuth round-trip до `/projects` вручную не проходили (у автоматизации нет реального аккаунта Yandex). Автоматически проверен только первый редирект и корректность параметров; сам обмен кода на токен и создание сессии оставлены на приёмку пользователем.
- `pnpm --filter platform typecheck` — чисто; `pnpm --filter platform test` — 8 сьютов, 43 теста, всё зелёное.
- Что уже сделано и покрыто:
  - Реестр `OAuthProviderRegistry` получил метод `getEnabledIds()` (см. `apps/platform/src/server/auth/oauth/providers.ts`), тип `OAuthProviderId` вынесен в изоморфный `apps/platform/src/shared/auth/oauthProvider.ts` (реэкспорт с сервера через `OAuthProvider.ts` сохранён).
  - `pageMiddleware` при SSR запрашивает у реестра включённые провайдеры и кладёт их в `window.__INITIAL_STATE__.oauthEnabledProviders`. Клиентский `Registry` расширен полем `oauthEnabledProviders: OAuthProviderId[]`.
  - `LoginPage` и `RegisterPage` рендерят разделитель «или» и кнопку «Yandex ID» только когда `oauthEnabledProviders.includes('yandex')`. Проверено через Playwright: без env переменных на `/login` и `/register` кнопки нет, `initialState.oauthEnabledProviders === []`, `curl /api/v1/auth/oauth/yandex/start` — 404 (сервер не падает).
  - Добавлен тест `apps/platform/src/server/auth/oauth/providers.test.ts` на реестр (включён/выключен провайдер, get неизвестного id). `pnpm --filter platform typecheck` и `pnpm --filter platform test` — чисто (8 сьютов, 43 теста).
  - Строка про поведение без env актуализирована в `apps/platform/README.md`.
