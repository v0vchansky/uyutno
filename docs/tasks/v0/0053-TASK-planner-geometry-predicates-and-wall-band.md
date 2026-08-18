# 0053 · TASK · Геометрическое ядро 1/2: предикаты и примитивы, лента стены и митринг, валидация контура

- Статус: [ ]
- Эпик: 0050
- Зависит от: 0051
- Спека: docs/adr/00NN-\* (ADR C — принятый, ожидаемо 0017; пункты про предикаты, эпсилоны, ленту/митринг, константы, тестовый контракт); docs/product/features/planner/01-walls-and-contours.md («Митра углов», «Крайние случаи», «Ограничения и пороги»); docs/product/architecture/testing-strategy.md («Что считается покрытым», golden/property); docs/product/architecture/competitor-practices-audit.md (секции dd02, dd08, 01-walls)
- Нужен дизайн: нет (чистые функции без UI)
- Дизайн: —
- PR: —

## Описание

Первая половина геометрического ядра по принятому ADR C — всё, что **не требует триангуляции**: слой `packages/planner/src/document/geometry/` с чистыми функциями на plain-данных (см, `(x, y)` плана), без Three/DOM/React (ESLint-слой `document/`), полностью тестируемый в Jest node.

Скоуп (границы уточняются по ADR C, см. «Заметки»):

1. **Константы ядра** как именованные экспорты рядом с использованием (`L_EPS`, `B_EPS`, `MIN_CONTOUR_AREA`, `MIN_SP_RATIO`, `RE_MITER_ANGLE`, `PARALLEL_EPS`, `MAX_WALL_WIDTH`, `MIN_WALL_LENGTH`, `DEFAULT_WALL_WIDTH`, `CLOSE_EPS`, … — состав по ADR C).
2. **Предикаты и примитивы** (dd08 «Сводная таблица» с вердиктами аудита): `pointsMatch` (чебышёв, `L_EPS`), `manhDist`/`euclDist`, `distanceToLine` (abs, гард нулевой длины), `pointOnSegment` (параметрически, `B_EPS`-коридор), `pointOnContour`, `pointInBounds`, `projectPointOnLine` (dot product, флаги `asSegment`/`vertices`), `offsetPoint` (нормаль `(dy, −dx)/len` + явная сторона), `bisectorPoint`, `pointAtAngle`, `rotateXY`, `triangleCenter`/`triangleArea`/`triangleIsNarrow`, `pointInContour` (robust ray casting; boundary — отдельно), `pointInContours` (счётчик), `segmentsIntersected` (строго трансверсально), `lineIntersectLine` (снап к общим вершинам, режим `vertices=false`), `segmentsOverlay`, `checkContact`, `angleBetweenLines` (`atan2(dx, dy)`, `[0, 2π)`), `parallelLines`, `rightOriented`, `orient2d` (свой или `robust-predicates` — по ADR C), `compareContours` (8 исходов), `compareContoursOnePoint`, `compareContoursByArea` (10×10), `contourArea` (знаковая), `contourPerim`, `contourValid`, `contourSelfIntersected`, `findMinMax`, `sortByArea`.
3. **Лента стены и митринг** (dd02): `blocksFromContour(points, width, side, closed)` → per-segment квады `[A, C, D, B]`; правило митра → плоский торец (открытая: угол **и** спайк вне bbox; замкнутая: только угол), null-guard параллельных соседей, гарды коротких сегментов, butt-капы, T-стык `startNeighbSegments`, `signSide` авто-выбор по наименьшему углу до третьей точки (ребро < 5 см не участвует) с фиксацией; отбрасывание последнего сегмента < толщины; конвертация квад-стрипа в пару контуров граней «полая комната» для коммита в документ (форма — по ADR C).
4. **Валидация контура на завершении**: самопересечение, дубли точек, вырожденность, минимальная длина 15 см, ≥ 4 точек для polyline room — как чистые функции с `Result`-подобным исходом (без исключений).
5. **Тесты** по правилу «вся математика и все ветки»: каждый предикат — обычный случай, обе стороны каждого порога, вырожденные входы (нулевая длина, коллинеарность, совпадающие точки, `NaN`/`±Infinity`), знак/ориентация (все 4 квадранта для `angleBetweenLines`); **golden-фикстуры** квад-стрипа ленты для spec-derived кейсов (прямой угол, ≥ 135° открытая/замкнутая, T-стык, короткий последний сегмент, две точки короче ширины); **property-тесты** `fast-check` (devDep пакета): нет NaN, ориентация квадов, идемпотентность нормализации.
6. Зависимости: `fast-check` (devDep), `robust-predicates` — если так решит ADR C.

Не в задаче: триангуляция, детекция комнат, оси, `rebuild`/`normalize` (0054); снап-функции (0062 — они используют предикаты отсюда); всё, что трогает документ/фасад.

## Приёмка

- [ ] `packages/planner/src/document/geometry/` — предикаты, примитивы, лента/митринг, валидация контура по ADR C; ни одного импорта Three/DOM/React (ESLint-слой не нарушен).
- [ ] Тесты: все ветки каждой функции; golden-фикстуры ленты заведены (расположение и формат — по ADR C), обновление эталона — явный шаг; property-тесты `fast-check` гоняются в `pnpm test` с фиксированным seed.
- [ ] Константы — именованные, рядом с использованием, без дублей литералов; значения совпадают со спекой 01 и ADR C.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` зелёные; ревью субагента-критика (ADR C, testing-strategy) пройдено.
- [ ] Prettier чист; ровно один PR.

## Заметки

- Скоуп заведён до принятия ADR C (0051); после принятия — сверить состав функций/констант и формат фикстур с ADR и поправить этот файл, не заводя новых номеров без нужды. Если ADR C решит иначе делить ядро (например, отдать ленту в 0054, а сюда — только предикаты), правится граница 0053/0054.
