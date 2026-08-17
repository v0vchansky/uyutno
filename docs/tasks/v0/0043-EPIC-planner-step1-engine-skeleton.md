# 0043 · EPIC · Планер — шаг 1: каркас движка

- Статус: [~]
- Зависит от: 0035
- Спека: docs/product/features/planner/README.md; порядок шагов — docs/product/architecture/planner-build-order.md (шаг 1)

## Описание

Первый шаг реализации планера по [planner-build-order.md](../../product/architecture/planner-build-order.md). Цель эпика — движок «стоит на ногах» без единого инструмента: планер монтируется на `/project/:id` (сейчас там заглушка `client/project/pages/ProjectPage/ProjectPage.tsx`) через DI-пропсы по ADR 0007, есть канвас с ортокамерой сверху, пустая сцена, render-on-demand, корректные resize/dispose без утечек, и — главное — зафиксированы два самых дорогих для отката решения: слои движка (ADR A) и модель документа (ADR B).

Скоуп эпика:

- **Аудит практик roomtodo (keep/rework/drop)** — задача 0045, вход для всех ADR планера.
- **ADR A + B** — задача 0044 (документация, без кода).
- **Код каркаса** — задачи заводятся после принятия ADR (структура папок `client/planner/`, фасад, шина, проекция, монтирование в `ProjectPage`, тесты слоёв 1–2 из [testing-strategy](../../product/architecture/testing-strategy.md), perf/leak-гвард «idle FPS ≈ 0» из слоя 3).

Вне скоупа: инструменты рисования, геометрия, undo (шаг 2), сохранение (шаг 3), 3D-меши (шаг 4).

## Приёмка

- [ ] ADR A и ADR B приняты (статус `Принято`), индекс `docs/adr/README.md` обновлён.
- [ ] `/project/:id` открывает планер: канвас на весь рабочий контейнер, ортокамера top, пустая сцена; никакого постоянного RAF в покое.
- [ ] Unmount страницы освобождает renderer/геометрии/материалы (проверка через `renderer.info` в Playwright).
- [ ] Модуль `planner` не импортирует `auth`/`common`/`project` (энфорс ESLint по 0007).
- [ ] Все подзадачи `[x]`.

## Заметки

—
