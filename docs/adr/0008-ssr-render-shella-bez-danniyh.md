# 0008. SSR-стратегия v0: рендерим только шелл, данные — всегда на клиенте

- Статус: Принято
- Дата: 2026-08-09

## Решение

- **SSR** отдаёт HTML-шелл + CSS + мета-теги, **без запросов к данным**.
- **TanStack Query на сервере** — пустой per-request инстанс, только для совместимости с `<QueryClientProvider>`. Никакого `dehydrate`/`hydrate`, никакой инъекции QC-состояния в HTML, никакого cookie loopback.
- **Клиент** — один `QueryClient` на приложение, `useQuery` в компонентах тянет данные после гидрации.
- **Access control — целиком клиентский:**
  - **Auth-check:** `<ProtectedRoute>` обёртка + `useCurrentUser()` (тонкая обёртка над `useQuery(['currentUser'])`). Гость → `<Navigate to="/login" replace />`.
  - **Entity-access:** API возвращает 404 на приватные ресурсы без доступа (не 403 — не подтверждаем существование). `useQuery` кидает ошибку, компонент рендерит `<NotFound />`.
- **Роутинг:** react-router v8, `createBrowserRouter` на клиенте, `createStaticRouter` на сервере. **Без loader-ов в v0** — данные через `useQuery`.
- **HTML-шаблон:** JSX (`<html>`/`<head>`/`<body>` как React-компонент) + `renderToStaticMarkup`.
- **CSS** инлайнится в `<style>` внутри `<head>` — избегаем FOUC.
- **Мета-теги:** статичные title/description в v0 достаточно. Динамические (например, `<title>Название проекта — uyutno</title>`) — только на приватных страницах, где SEO не требуется, можно проставлять на клиенте. Конкретный механизм (`react-helmet-async`, встроенное `<title>` react-router v8, ручной `document.title`) — задача имплементации, не ADR.
- **Статику в v0** раздаёт Express (`express.static('/static', dist/client)`). Вынос на Nginx/Caddy — при подготовке продакшн-деплоя.

### Механизм

**Серверный `pageMiddleware`** (`src/server/application/`) на каждый `GET *`:

1. Создаёт **пустой** `new QueryClient()` per-request (без prefetch — инстанс нужен только чтобы `<QueryClientProvider>` не падал).
2. Создаёт `staticHandler` / `createStaticRouter` из общей конфигурации роутов.
3. Рендерит дерево через `renderToString`:
   ```
   <QueryClientProvider>
     <RegistryProvider>
       <StaticRouterProvider>
         <App />
       </StaticRouterProvider>
     </RegistryProvider>
   </QueryClientProvider>
   ```
4. Собирает финальный HTML через `renderToStaticMarkup` от JSX-шаблона.
5. Отдаёт `<!doctype html>${markup}`.

Ничего не форвардится в API, никаких серверных запросов за данными во время рендера.

**Клиентский bootstrap** (`src/client/index.tsx`):

1. Создаёт **один** `QueryClient` на приложение с базовым `staleTime` (минуты) и `refetchOnWindowFocus: false`.
2. Оборачивает `<App />` в `<QueryClientProvider>` → `<RegistryProvider>` → `<RouterProvider>` (`createBrowserRouter`).
3. `hydrateRoot(document.getElementById('root'), tree)`.
4. **Никакого `hydrate(qc, ...)`** — данные тянутся `useQuery` по мере рендера компонентов.

## Почему

Разбор всех v0-страниц показывает, что SSR-данные объективно не нужны ни на одной:

| Страница | Индексация | Данные для первого рендера | Нужен SSR-prefetch |
|---|---|---|---|
| Лендинг `/` | Индексируется | Вшитый текст, статика | Нет |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback/:provider` | Не индексируется | Пусто, чистые формы | Нет |
| `/project` (список) | `noindex` | Список из БД, приватный | Нет (мигание допустимо) |
| `/project/:id` | `noindex` | Проект, приватный | Нет (мигание допустимо) |

Full SPA отсекается: плохо для SEO лендинга (Яндекс существенно хуже Google на JS; для проекта с фокусом на органику из РФ — недопустимо), плохо для OG-превью в мессенджерах (соцсети и Telegram JS не выполняют), плохо для первого пейнта. Полноценный isomorphic SSR отсекается: тянет per-request QueryClient с prefetch, `dehydrate`/`hydrate`, инъекцию `window.__QC_STATE__`, forwarding cookie для loopback-запросов, staleTime-дисциплину для гидрированных данных, отдельную обработку redirect/404 через loader-ы — каждый пункт источник багов, без реальной пользы на v0. Вариант B (SSR только шелла) сохраняет всё, что реально даёт SSR (HTML для поисковика, готовые мета-теги, быстрый LCP лендинга), и убирает всё лишнее. Одна ментальная модель: **сервер = HTML + CSS + мета, клиент = данные**.

## Что важно знать

- **Мигание на приватных страницах.** Шелл → скелетон → данные. Секунда пустоты после логина — стандартно для SPA (Notion, Figma, Linear работают так же).
- **Auth-редирект — после гидрации, не 302 от сервера.** Гость по прямой ссылке на `/project/xyz` увидит шелл, потом `<Navigate to="/login">`.
- **Приватные страницы отдаются гостю в виде шелла** — небольшой overhead трафика. Приемлемо.
- **Если появится публичная страница с реальными динамическими данными для SEO** (например, страницы ЖК из БД в v1) — этот ADR потребует пересмотра или дополнения. В v0 такой страницы нет.
- **Стриминг** (`renderToPipeableStream`, `<Suspense>` boundaries) в v0 не заводим — задел на будущее в React 19, но пока не нужен.
