import type { PlanPosition } from '../../PlannerDocument';
import { MIN_CONTOUR_POINTS } from './validateContour';

/**
 * Допуск совпадения с первой точкой при замыкании петли, см (спека 01 «Порог замыкания петли», ADR 0017 C3):
 * не радиус попадания, а допуск на float после снапа — курсор к этому моменту уже притянут к первой точке.
 */
export const CLOSE_EPS = 0.1;

/** Что замыкает кандидат: петлю на первой точке (`'first'`) или рисование у последней (`'last'`). */
export type ContourClosure = 'first' | 'last';

export interface ContourClosureOptions {
  /** Радиус вокруг последней поставленной точки: для «Стен» — толщина ленты. */
  lastRadius: number;
  /** Метрика: евклид для «Стен», манхэттен для «Зоны»/«Комнаты по точкам»/пола (спека 01, Q34) — решает E. */
  distance: (a: PlanPosition, b: PlanPosition) => number;
  /** Допуск совпадения с первой точкой; дефолт `CLOSE_EPS`. */
  firstRadius?: number;
}

/**
 * Предикат замыкания (чистая функция ядра; вызов и метрика — слой инструментов): кандидат замыкает контур,
 * если он не дальше `firstRadius` от первой точки (`'first'` — петля) **или** не дальше `lastRadius`
 * от последней поставленной (`'last'` — конец открытой полилинии). Проверка первой точки приоритетнее:
 * это сильнее (означает замкнутую петлю), и при крошечном контуре оба условия могут выполняться сразу;
 * петля возможна только от трёх точек — при меньшем числе первая точка не проверяется.
 * `null` — контур не замыкается. Без точек — замыкать нечего.
 */
export const contourClosure = (
  candidate: PlanPosition,
  points: readonly PlanPosition[],
  { lastRadius, distance, firstRadius = CLOSE_EPS }: ContourClosureOptions,
): ContourClosure | null => {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  if (points.length >= MIN_CONTOUR_POINTS && distance(candidate, first) <= firstRadius) return 'first';
  if (distance(candidate, last) <= lastRadius) return 'last';
  return null;
};
