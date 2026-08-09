# 0011. Линтер и форматтер: ESLint 9 (flat config) + Prettier 3

- Статус: Принято
- Дата: 2026-08-09

## Решение

- **Линтер:** ESLint 9 (flat config, `eslint.config.js`) + `typescript-eslint` 8 + `eslint-plugin-react` + `eslint-plugin-react-hooks` + `eslint-config-prettier` (гасит правила ESLint, конфликтующие с Prettier).
- **Форматтер:** Prettier 3 — форматирует JS/TS/TSX, MD, JSON, YAML, CSS.
- **Организация конфига:** один `eslint.config.js` и один `.prettierrc` (плюс `.prettierignore`) в корне монорепы. Per-package переопределения — только через flat-config `files`-скоуп в корневом конфиге, без отдельных `eslint.config.js` в пакетах.
- **Строгость:** recommended-пресеты плагинов, без strict и без community-стилей. Локальные правила (энфорс модульных границ по ADR 0007, `no-restricted-imports` в клиентских/серверных зонах) — поверх recommended.
- **Запуск:** ESLint через `pnpm lint`, Prettier — через `pnpm format` (проверка) и `pnpm format:write` (правка). Конкретные npm-скрипты — задача имплементации, не ADR.

## Почему

ESLint, а не Biome/oxlint: экосистема плагинов (у нас впереди правила под TanStack Query, HeroUI, React Aria; кастомные правила в Biome/oxlint писать сложнее), `typescript-eslint` — стандарт для TS-специфичных проверок через parserServices (аналога такой глубины у Biome/oxlint нет), стабильность (ESLint 9 — восьмой мажор с 2013, Biome/oxlint активно ломаются между минорами). Скорость не критична — на монорепе из одного `apps/platform` ESLint отработает за секунды.

Prettier, а не `@stylistic/eslint-plugin`: Prettier форматирует всё (TS/JS/TSX/MD/JSON/YAML/CSS), `@stylistic` — только JS/TS, для MD/JSON/YAML всё равно нужен второй инструмент. Prettier opinionated — не спорим о запятых, длине строк, переносах, экономит десятки коротких дискуссий с AI-агентом. Развязка: ESLint отвечает за **качество кода** (потенциальные баги, антипаттерны, границы модулей), Prettier — за **форматирование**. Это соответствует официальной позиции ESLint с версии 8.53 (formatting rules были выделены из ядра).

Один конфиг в корне соответствует ADR 0002 («общие корневые конфиги — цель, не побочный эффект»). Flat config позволяет per-directory скоупы через `files` — все правила клиента/сервера/тестов в одном файле.

Recommended, а не strict/airbnb: `typescript-eslint/strict` тянет правила уровня `no-unnecessary-condition`, которые дают много ложных срабатываний в проекте с Zod-выходами и БД-ответами (частично неизвестная форма). Airbnb/standard — вкусовые пресеты 2010-х, тянут кучу spacing/naming-правил, пересекающихся с Prettier.

## Что важно знать

- **`eslint-config-prettier` — обязательная зависимость.** Без него ESLint и Prettier начнут ругаться на одни и те же строки с разных сторон. Легко забыть при первичной настройке.
- **ESLint медленнее Biome/oxlint** — на масштабе v0 незаметно, при росте монорепы может стать ощутимым; тогда — отдельный ADR.
- **Flat config пока имеет меньше готовых пресетов**, чем legacy — часть плагинов ещё догоняют. На нашем наборе (`typescript-eslint`, `eslint-plugin-react`) поддержка полная.
- **Stylelint / CSS-линтинг не берём** — собственного CSS у нас почти нет (Tailwind классами, ADR 0009).
- **ESLint 9, а не 10 (latest):** `eslint-plugin-react` пока не поддерживает ESLint 10 (peer `<= 9.7`), при переходе `react/*` правила падают в runtime. Как только плагин догонит — апгрейдимся, ADR правим по месту.
