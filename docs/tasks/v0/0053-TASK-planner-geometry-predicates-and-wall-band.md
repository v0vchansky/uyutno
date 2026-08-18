# 0053 · TASK · Геометрическое ядро 1/2: предикаты и примитивы, лента стены и митринг, валидация контура

- Статус: [ ]
- Эпик: 0050
- Зависит от: 0051
- Спека: docs/adr/0017-geometricheskiy-payplayn-planera.md (ADR C — принят 2026-08-19; C1–C5, C10–C11); docs/product/features/planner/01-walls-and-contours.md («Митра углов», «Крайние случаи», «Ограничения и пороги»); docs/product/architecture/testing-strategy.md («Что считается покрытым», golden/property); docs/product/architecture/competitor-practices-audit.md (секции dd02, dd08, 01-walls)
- Нужен дизайн: нет (чистые функции без UI)
- Дизайн: —
- PR: —

## Описание

Первая половина геометрического ядра по принятому ADR C — всё, что **не требует триангуляции**: слой `packages/planner/src/document/geometry/` с чистыми функциями на plain-данных (см, `(x, y)` плана), без Three/DOM/React (ESLint-слой `document/`), полностью тестируемый в Jest node.

Скоуп (границы уточняются по ADR C, см. «Заметки»):

1. **Константы ядра** как именованные экспорты рядом с использованием (`L_EPS`, `B_EPS`, `MIN_CONTOUR_AREA`, `MIN_SP_RATIO`, `RE_MITER_ANGLE`, `PARALLEL_EPS`, `MAX_WALL_WIDTH`, `MIN_WALL_LENGTH`, `DEFAULT_WALL_WIDTH`, `CLOSE_EPS`, … — состав по ADR C).
2. **Предикаты и примитивы** (dd08 «Сводная таблица» с вердиктами аудита): `pointsMatch` (чебышёв, `L_EPS`), `manhDist`/`euclDist`, `distanceToLine` (abs, гард нулевой длины), `pointOnSegment` (параметрически, `B_EPS`-коридор), `pointOnContour`, `pointInBounds`, `projectPointOnLine` (dot product, флаги `asSegment`/`vertices`), `offsetPoint` (нормаль `(dy, −dx)/len` + явная сторона), `bisectorPoint`, `pointAtAngle`, `rotateXY`, `triangleCenter`/`triangleArea`/`triangleIsNarrow`, `pointInContour` (robust ray casting; boundary — отдельно), `pointInContours` (счётчик), `segmentsIntersected` (строго трансверсально), `lineIntersectLine` (снап к общим вершинам, режим `vertices=false`), `segmentsOverlay`, `checkContact`, `angleBetweenLines` (`atan2(dx, dy)`, `[0, 2π)`), `parallelLines`, `rightOriented`, `orient2d` — обёртка над `robust-predicates` с нормализацией знака к «> 0 = против часовой при y вверх» (ADR 0017 C2/C4, тест на знак обязателен), `compareContours` (8 исходов), `compareContoursOnePoint` (полный union-тип), `compareContoursByArea` (10×10, `REATTACH_GRID`), `contourArea` (знаковая, shoelace, > 0 = против часовой при y вверх — наша конвенция, не знак референса), `contourPerim`, `contourValid`, `contourSelfIntersected`, `findMinMax`, `sortByArea` (по убыванию |площади|, при разнице < `SORT_AREA_EPS` outer после inner, tie-break `(minX, minY)`), предикат замыкания с `CLOSE_EPS = 0.1` (чистая функция; метрику и вызов решает E). `pointInContour` — без третьего эпсилона: сначала `pointOnContour` (B_EPS), потом чётность пересечений с полуоткрытыми рёбрами через `orient2d` (ADR 0017 C3).
3. **Лента стены и митринг** (dd02): `blocksFromContour(points, width, side, closed)` → per-segment квады `[A, C, D, B]`; правило митра → плоский торец (открытая: угол **и** спайк вне bbox; замкнутая: только угол), null-guard параллельных соседей, гарды коротких сегментов, butt-капы, T-стык `startNeighbSegments`, `signSide` авто-выбор по наименьшему углу до третьей точки (ребро < 5 см не участвует) с фиксацией; отбрасывание последнего сегмента < толщины; отдельной конвертации квад-стрипа в «пару контуров граней» нет: инструмент коммитит квады как N `outer`-контуров с общими id вершин соседних квадов, слияние делает `normalize` (ADR 0017 C1; сам коммит — 0057/0058).
4. **Валидация контура на завершении**: самопересечение, дубли точек, вырожденность, минимальная длина 15 см, ≥ 4 точек для polyline room — как чистые функции с `Result`-подобным исходом (без исключений).
5. **Тесты** по правилу «вся математика и все ветки»: каждый предикат — обычный случай, обе стороны каждого порога, вырожденные входы (нулевая длина, коллинеарность, совпадающие точки, `NaN`/`±Infinity`), знак/ориентация (все 4 квадранта для `angleBetweenLines`); **golden-фикстуры** квад-стрипа ленты для spec-derived кейсов (прямой угол, ≥ 135° открытая/замкнутая, T-стык, короткий последний сегмент, две точки короче ширины) в `packages/planner/src/document/geometry/fixtures/<case>.json` формата `{ name, input: { points, width, side, closed }, expected: квады }`, числа с округлением до 1e-6, обновление эталона — явный шаг `UPDATE_GOLDEN=1 pnpm test` (ADR 0017 C10); **property-тесты** `fast-check` (devDep пакета, фиксированный seed): нет NaN, ориентация квадов, знак `orient2d`/`contourArea` по конвенции.
6. Зависимости: `robust-predicates@^3.0.3` (dep; ESM-only — в `jest.config.mjs` пакета `transformIgnorePatterns` с исключением для него, проверено спайком 0051), `fast-check@^4` (devDep). `cdt2d`/`clean-pslg` — 0054.

Не в задаче: триангуляция, детекция комнат, оси, `rebuild`/`normalize` (0054); снап-функции (0062 — они используют предикаты отсюда); всё, что трогает документ/фасад.

## Приёмка

- [ ] `packages/planner/src/document/geometry/` — предикаты, примитивы, лента/митринг, валидация контура по ADR C; ни одного импорта Three/DOM/React (ESLint-слой не нарушен).
- [ ] Тесты: все ветки каждой функции; golden-фикстуры ленты заведены (расположение и формат — по ADR C), обновление эталона — явный шаг; property-тесты `fast-check` гоняются в `pnpm test` с фиксированным seed.
- [ ] Константы — именованные, рядом с использованием, без дублей литералов; значения совпадают со спекой 01 и ADR C.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` зелёные; ревью субагента-критика (ADR C, testing-strategy) пройдено.
- [ ] Prettier чист; ровно один PR.

## Заметки

- Скоуп заведён до принятия ADR C (0051); **сверен с ADR 0017 (`Предложено`, 2026-08-18)**: граница 0053/0054 сохранена (сюда — предикаты, лента, валидация; триангуляция/комнаты/оси/normalize — 0054). Уточнено по ADR: `orient2d` через `robust-predicates` с нормализацией знака; `pointInContour` без третьего эпсилона; коммит ленты — квады как `outer`-контуры (конвертации нет); формат/место golden-фикстур и `UPDATE_GOLDEN`; константы `REATTACH_GRID`, `CONNECTOR_ON_LINE_EPS`, `CLOSE_EPS` в ядре. ADR принят 2026-08-19 — задачу можно брать.
