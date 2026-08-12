# 0041 · TASK · Логотип шапки всегда ведёт на `/`

- Статус: [x]
- Эпик: —
- Зависит от: —
- Спека: —
- Нужен дизайн: нет (точечный багфикс, поведение и UI-структура не меняются)
- Дизайн: —
- PR: 610ba20 (прямой коммит в main)

## Описание

`apps/platform/src/client/common/components/PublicLayout/PublicHeader.tsx:32` вычисляет цель логотипа условно:

```ts
const logoTarget = isApp && user !== null ? '/projects' : '/';
```

На `/projects` (шапка в режиме `mode='app'` с залогиненным пользователем) клик по логотипу уводит на тот же `/projects`, а не на лендинг `/`. Это не совпадает с ожиданием пользователя: логотип везде должен вести на главную `/`, вне зависимости от состояния шапки и авторизации.

JSDoc над компонентом (`PublicHeader.tsx:23`) отдельной строкой описывает текущее поведение: `«app: логотип на /projects, …»` — его надо привести в соответствие с фиксом.

Других мест, где логотип рендерится, в проекте нет: `PublicFooter.tsx:110` уже ведёт на `/`, в `MobileMenu.tsx` логотипа нет.

## Скоуп

1. `apps/platform/src/client/common/components/PublicLayout/PublicHeader.tsx`
   - Убрать переменную `logoTarget` (или сделать её всегда `'/'`), передать `to='/'` в `<Link>` вокруг логотипа.
   - Обновить JSDoc `PublicHeader` (пункт про `app`) — логотип ведёт на `/`, а не на `/projects`.
2. Пробежаться по остальным упоминаниям «логотип → /projects» в коде/доках, если такие есть, и привести к `/`.

## Приёмка

- [x] На `/projects` (залогинен и разлогинен) клик по логотипу в шапке ведёт на `/`.
- [x] На всех остальных экранах (`/`, `/login`, `/register`, `/project/:id`) клик по логотипу по-прежнему ведёт на `/`.
- [x] JSDoc `PublicHeader` не утверждает, что в режиме `app` логотип ведёт на `/projects`.
- [x] Проверка через Playwright MCP: открыть `/projects` под залогиненным пользователем, кликнуть по логотипу, убедиться, что URL стал `/`.
- [x] `pnpm --filter platform typecheck`, `pnpm --filter platform lint` — чисто.

## Заметки

- `apps/platform/src/client/common/components/PublicLayout/PublicHeader.tsx`: убрал переменную `logoTarget` (была на строке 32), передал `to='/'` в `<Link>` вокруг логотипа (строка 41). Обновил JSDoc над компонентом (строки 18–27): добавил общую фразу «Логотип во всех состояниях ведёт на `/`.», убрал упоминание `/projects` в пункте про `app`.
- `docs/ui/layout.md:23` — привёл раздел «Приложение · /projects» в соответствие: логотип ведёт на `/`. Handoff-HTML в `docs/ui/handoffs/auth/Layout.dc.html` и `docs/ui/handoffs/projects/projects-screen.md` намеренно не трогал (это экспорты из Claude Design). Файл задачи 0026 (`[x]` done) — историческая запись, тоже не трогал.
- `pnpm --filter platform typecheck` — чисто.
- `pnpm lint` (root; `pnpm --filter platform lint` не существует, скрипта нет) — чисто.
- Playwright MCP: залогинен пользователем (сессия сохранилась в браузере с прошлых запусков), открыт `http://localhost:4000/projects`, снапшот показал у логотипа `/url: /`. Клик по логотипу — URL стал `http://localhost:4000/`, заголовок «уютно — планировщик квартиры онлайн». Дев-сервер стартовал напрямую через `node dist/server/server.js` (nodemon в фоне отваливался с «clean exit»). Одна консольная ошибка про SSR-hydration mismatch на `aria-controls` в `MobileMenu` — предсуществующая, не связана с этой правкой.
