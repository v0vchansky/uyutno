# uyutno — карта репозитория

Онлайн-редактор планировок квартир с каталогом мебели. Монорепа pnpm: `apps/platform` — приложение (Express + React SSR в одном процессе), `packages/planner` — движок редактора. Поднять локально — [`apps/platform/README.md`](./apps/platform/README.md).

## Источники правды

- Доска задач и протокол ведения — [`docs/tasks/v0/README.md`](./docs/tasks/v0/README.md)
- Индекс решений и формат ADR — [`docs/adr/README.md`](./docs/adr/README.md)
- Спека планера, заморожена — [`docs/product/features/planner/`](./docs/product/features/planner/)
- Порядок работ и парковка вопросов — [`planner-build-order.md`](./docs/product/architecture/planner-build-order.md)
- Стратегия тестов и DoD фичи — [`testing-strategy.md`](./docs/product/architecture/testing-strategy.md)
- Гайдлайн интерфейса — [`docs/ui/guidelines.md`](./docs/ui/guidelines.md)
- Заказы дизайна и макеты — [`docs/ui/briefs/`](./docs/ui/briefs/), [`docs/ui/handoffs/`](./docs/ui/handoffs/)
- Реверс конкурента и вердикты по нему — [`competitor-mechanics/`](./docs/product/reference/competitor-mechanics/README.md)

## Правила, которых не видно в коде

- Работа идёт через доску: статус меняется **одновременно** в файле задачи и в строке индекса.
- 1 PR = 1 задача (`TASK`); у эпика своего PR нет.
- UI-задача с «Нужен дизайн: да» без ссылки на макет в работу не берётся.
- Элемент интерфейса сначала ищется в HeroUI через MCP `heroui-react`, и только потом решается, писать ли своё — порядок и условия в [`src/client/CLAUDE.md`](./apps/platform/src/client/CLAUDE.md).
- Спека правится только отдельным коммитом «спека ← код» — когда код доказал противоречие.
- Решения фиксируются ADR; решение изменилось — переписывается существующий ADR по месту.

## Команды

```
pnpm install      # pnpm 9, Node 22+
pnpm dev          # платформа в dev-режиме
pnpm typecheck    # tsc по всем воркспейсам
pnpm lint         # eslint (lint:fix — с --fix)
pnpm format       # prettier --check (format:write — --write)
pnpm test         # jest по всем воркспейсам
pnpm test:e2e     # playwright по платформе
pnpm build        # прод-сборка платформы
```

Миграции БД — `pnpm --filter platform db:up` / `db:new` / `db:status`.

## Куда читать дальше

Подробности живут во вложенных `CLAUDE.md` — грузить по необходимости, а не заранее.

- [`apps/platform/`](./apps/platform/CLAUDE.md) — раскладка приложения, конвенции TypeScript, тесты, ADR платформы.
- [`apps/platform/src/client/`](./apps/platform/src/client/CLAUDE.md) — устройство клиентского модуля и правила UI-кода.
- [`apps/platform/src/server/`](./apps/platform/src/server/CLAUDE.md) — устройство серверной части.
- [`packages/planner/`](./packages/planner/CLAUDE.md) — слои движка, инварианты документа и рендера, запуск, тесты.
