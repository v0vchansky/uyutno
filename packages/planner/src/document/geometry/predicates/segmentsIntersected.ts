import type { PlanPosition } from '../../PlannerDocument';
import { orientationSign } from './orient2d';

/**
 * Строго трансверсальное пересечение отрезков `a1a2` и `b1b2` (ADR 0017 C4): концы каждого отрезка лежат
 * по разные стороны прямой другого — знаки `orient2d` строго противоположны. Касание концом, T-стык в
 * вершину, общая вершина и коллинеарное наложение → `false` (нулевой знак). Единственный клиент —
 * `contourSelfIntersected`: для отказа пользовательского ввода этого достаточно.
 */
export const segmentsIntersected = (a1: PlanPosition, a2: PlanPosition, b1: PlanPosition, b2: PlanPosition): boolean =>
  orientationSign(b1, b2, a1) * orientationSign(b1, b2, a2) < 0 &&
  orientationSign(a1, a2, b1) * orientationSign(a1, a2, b2) < 0;
