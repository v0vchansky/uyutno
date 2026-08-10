# 0010 · TASK · Регистрация OAuth-приложения Yandex ID

- Статус: [ ]
- Эпик: 0005
- Зависит от: —
- Спека: docs/product/features/auth.md#вход-регистрация-через-yandex-id-и-vk-id
- PR: —

## Описание

Внешняя работа — зарегистрировать приложение на стороне Yandex ID, получить `client_id` и `client_secret`, настроить redirect URI. Без этих кредов задача 0015 (OAuth-flow Yandex ID) заблокирована.

VK ID вынесен в отдельные задачи 0021 (регистрация приложения) и 0022 (сам flow) — здесь про VK ничего не делаем.

Скоуп:

- Зарегистрировать приложение в кабинете Yandex OAuth, указать redirect URI `https://<домен>/auth/callback/yandex` (и локальный `http://localhost:<port>/auth/callback/yandex` для dev), выбрать scopes для получения email и уникального `provider_user_id`, сохранить креды.
- Секреты в `process.env`: `YANDEX_OAUTH_CLIENT_ID`, `YANDEX_OAUTH_CLIENT_SECRET`. Дев-значения — из тестового приложения на localhost (если провайдер такое позволяет) или пустые с фича-флагом «OAuth в dev выключен».
- Актуальные URL-эндпоинтов провайдера (authorize / token / userinfo), scope-строки и особенности — зафиксировать в комментарии к задаче или коротким разделом в `docs/product/features/auth.md`.
- Иконка Yandex ID: заменить монограмму в макете на официальный SVG из брендбука (см. `docs/ui/handoffs/auth/README.md`, «Assets» — «Иконки Yandex ID и VK ID … Перед релизом взять официальные SVG»). SVG-ассет положить в `apps/platform/public/` или `src/client/common/`. VK-иконка — в 0021.

Вне скоупа:

- Сам код OAuth-flow (в 0015).
- Всё, что касается VK ID (в 0021 / 0022).
- Настройка домена и SSL — отдельно, вне auth-эпика.

## Приёмка

- [ ] Приложение Yandex ID зарегистрировано, redirect URI (prod + dev) добавлены, креды выданы.
- [ ] Креды сохранены в prod-`process.env`, инструкция по локальному запуску — в `apps/platform/README.md`.
- [ ] Официальный SVG-иконки Yandex ID добавлен в проект и готов к использованию в 0015.
- [ ] URL-эндпоинтов и особенности провайдера зафиксированы в спеке фичи (`docs/product/features/auth.md`) или в комментарии к задаче.

## Заметки

—
