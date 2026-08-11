# 0034 · TASK · Yandex OAuth: показывать выбор аккаунта (`force_confirm=yes`)

- Статус: [x]
- Эпик: —
- Зависит от: 0015, 0032
- Спека: [docs/product/features/auth.md](../../product/features/auth.md)
- Нужен дизайн: нет (баг-фикс поведения OAuth-провайдера, UI не меняется)
- Дизайн: —
- PR: —

## Описание

Пользователь жалуется: при клике «Войти через Yandex» на `/login`/`/register`, если он уже залогинен в Яндексе, OAuth-редирект проходит «тихо» — сразу возвращает на приложение без экрана согласия и без возможности выбрать другой Яндекс-аккаунт.

Это стандартное поведение Yandex ID: если у пользователя уже есть активная сессия Passport и приложение ранее получило согласие, шаг подтверждения пропускается. У Yandex OAuth для `oauth.yandex.ru/authorize` есть параметр **`force_confirm=yes`**, который принудительно показывает экран согласия и — при нескольких активных аккаунтах на `passport.yandex.ru` — экран выбора аккаунта.

Место правки: `apps/platform/src/server/auth/oauth/YandexProvider.ts:33-41`, метод `getAuthorizeUrl`. Сейчас в query-параметры не попадает `force_confirm`.

## Скоуп

**Сервер (`apps/platform/src/server/`):**

1. **`YandexProvider.getAuthorizeUrl`.** Добавить в `URLSearchParams` пару `force_confirm: 'yes'`. Значение — строковый `'yes'` (Yandex сравнивает по строке, не bool).

2. **Тест.** В `apps/platform/src/server/auth/oauth/YandexProvider.test.ts` (если есть кейс на `getAuthorizeUrl`) — обновить/добавить проверку, что итоговый URL содержит `force_confirm=yes`. Если тестов на этот метод нет — добавить один.

## Приёмка

- [x] На `/login` клик «Войти через Yandex» ведёт на `oauth.yandex.ru/authorize?...&force_confirm=yes...` (query-параметр присутствует).
- [x] Playwright/ручная проверка: пользователю, у которого в Passport несколько аккаунтов, реально показывается экран выбора аккаунта; пользователю с одним аккаунтом — экран подтверждения разрешений.
- [x] `pnpm --filter platform typecheck` — чисто.
- [x] `pnpm --filter platform test` — чисто.

## Заметки

—
