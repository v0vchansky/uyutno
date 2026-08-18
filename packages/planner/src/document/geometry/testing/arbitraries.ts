import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';

/**
 * Общие настройки property-тестов геометрии (testing-strategy, ADR 0017 C10): фиксированный seed —
 * воспроизводимость в CI; найденный контрпример фиксируется отдельным регресс-тестом, а не сменой seed.
 */
export const FC_SEED = 20260819;
export const FC_RUNS = 300;

/** Параметры `fc.assert` с фиксированным seed. */
export const fcParams: fc.Parameters<unknown> = { seed: FC_SEED, numRuns: FC_RUNS };

/** Диапазон координат плана для генерации, см (квартира ±100 м с запасом). */
const COORD_MIN = -10_000;
const COORD_MAX = 10_000;

/** Координата плана: конечное число, без `NaN`/`±Infinity` (их пробуют отдельные тесты). */
export const arbCoordinate = fc.double({ min: COORD_MIN, max: COORD_MAX, noNaN: true, noDefaultInfinity: true });

/** Координата на сетке квантования 0.001 (ADR 0016 B1) — «честный» вход документа. */
export const arbQuantizedCoordinate = fc.integer({ min: COORD_MIN * 1000, max: COORD_MAX * 1000 }).map(v => v / 1000);

export const arbPoint: fc.Arbitrary<PlanPosition> = fc.record({ x: arbCoordinate, y: arbCoordinate });

export const arbQuantizedPoint: fc.Arbitrary<PlanPosition> = fc.record({
  x: arbQuantizedCoordinate,
  y: arbQuantizedCoordinate,
});

/** Контур из 3..12 квантованных вершин — произвольный (может быть самопересекающимся). */
export const arbContour: fc.Arbitrary<PlanPosition[]> = fc.array(arbQuantizedPoint, { minLength: 3, maxLength: 12 });

/**
 * Простой выпуклый многоугольник «без сливеров»: 3..10 точек на окружности радиуса 20..2000 см, углы —
 * равномерная сетка с джиттером до трети шага (соседние вершины не слипаются). Обход — против часовой
 * при y вверх (площадь > 0), проходит `contourValid`.
 */
export const arbConvexPolygon: fc.Arbitrary<PlanPosition[]> = fc
  .record({
    center: arbQuantizedPoint,
    radius: fc.integer({ min: 20, max: 2000 }),
    count: fc.integer({ min: 3, max: 10 }),
    jitter: fc.array(fc.double({ min: -1 / 3, max: 1 / 3, noNaN: true }), { minLength: 10, maxLength: 10 }),
  })
  .map(({ center, radius, count, jitter }) =>
    Array.from({ length: count }, (_, i) => {
      const step = (2 * Math.PI) / count;
      const angle = (i + (jitter[i] ?? 0)) * step;
      return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
    }),
  );
