# 0010 · TASK · Регистрация OAuth-приложений Yandex ID + VK ID

- Статус: [ ]
- Эпик: 0005
- Зависит от: —
- Спека: docs/product/features/auth.md#вход-регистрация-через-yandex-id-и-vk-id
- PR: —

## Описание

Внешняя работа — зарегистрировать приложения на стороне Yandex ID и VK ID, получить `client_id` и `client_secret`, настроить redirect URI. Без этих кредов задача 0015 (OAuth-flow в коде) заблокирована.

Скоуп:

- **Yandex ID (Yandex OAuth):** зарегистрировать приложение в кабинете, указать redirect URI `https://<домен>/auth/callback/yandex` (и локальный `http://localhost:<port>/auth/callback/yandex` для dev), выбрать scopes для получения email и уникального `provider_user_id`, сохранить креды.
- **VK ID:** зарегистрировать приложение в кабинете VK, аналогично redirect URI `https://<домен>/auth/callback/vk` и локальный вариант, scopes для email и `provider_user_id`, сохранить креды.
- Секреты в `process.env`: `YANDEX_OAUTH_CLIENT_ID`, `YANDEX_OAUTH_CLIENT_SECRET`, `VK_OAUTH_CLIENT_ID`, `VK_OAUTH_CLIENT_SECRET`. Дев-значения — из тестовых приложений на localhost (если провайдеры такое позволяют) или пустые с фича-флагом «OAuth в dev выключен».
- Актуальные URL-эндпоинтов провайдеров (authorize / token / userinfo), scope-строки и особенности провайдеров (например, у VK email возвращается отдельным полем в access_token response) — зафиксировать в комментарии к задаче или коротким разделом в `docs/product/features/auth.md`.
- Иконки Yandex ID и VK ID: заменить монограммы в макете на официальные SVG из брендбуков (см. `docs/ui/handoffs/auth/README.md`, «Assets» — «Иконки Yandex ID и VK ID … Перед релизом взять официальные SVG»). SVG-ассеты положить в `apps/platform/public/` или `src/client/common/`.

Вне скоупа:

- Сам код OAuth-flow (в 0015).
- Настройка домена и SSL — отдельно, вне auth-эпика.

## Приёмка

- [ ] Приложение Yandex ID зарегистрировано, redirect URI (prod + dev) добавлены, креды выданы.
- [ ] Приложение VK ID зарегистрировано аналогично.
- [ ] Креды сохранены в prod-`process.env`, инструкция по локальному запуску — в `apps/platform/README.md`.
- [ ] Официальные SVG-иконки Yandex ID и VK ID добавлены в проект и готовы к использованию в 0015.
- [ ] URL-эндпоинтов и особенности провайдеров зафиксированы в спеке фичи (`docs/product/features/auth.md`) или в комментарии к задаче.

## Заметки

—
