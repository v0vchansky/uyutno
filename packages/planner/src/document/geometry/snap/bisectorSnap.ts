import type { Id } from '../../id';
import type { PlanPosition } from '../../PlannerDocument';
import { bisectorPoint } from '../predicates/bisectorPoint';
import { distanceToLine } from '../predicates/distanceToLine';
import type { SnapCandidate } from './candidates';
import { snapToNearest } from './snapToNearest';

/** Радиус поиска угла для биссектрисы — 10-кратный от базового (спека 01 «Пороги», аудит dd09 keep). */
export const BISECTOR_SEARCH_FACTOR = 10;

export interface BisectorSnap {
  /** Вершина угла — опорная точка гайда (`bisAnchor`). */
  anchor: SnapCandidate;
  /** Вторая точка биссектрисы (`bisectorPoint`, на расстоянии ≤ 1 см от вершины) — задаёт направление прямой. */
  direction: PlanPosition;
}

/**
 * Биссектриса ближайшего угла (спека 01 «К биссектрисе угла», флаг `bisectorAlign`): угол — ближайший по
 * манхэттену кандидат в `snapDist × 10`; если у него нет соседей по кольцу (`prev`/`next`, ADR 0019 E2 —
 * осиротевшая вершина, конец полилинии) — `null`, следующий по дальности не ищется (1:1 с референсом); прямая — через вершину и `bisectorPoint(вершина, prev, next)`; отказ (`null`), если
 * угол развёрнутый (`bisectorPoint` → `null`) или **перпендикулярное евклидово** расстояние от курсора до прямой
 * `> snapDist` (единственное место снапа с евклидом, кроме замыкания «Стен» — Q34). Приём результата по
 * манхэттену — в лесенке `getSnapPoint`. Куллинг — у вызывающего.
 */
export const bisectorSnap = (
  point: PlanPosition,
  candidates: readonly SnapCandidate[],
  snapDist: number,
  exceptIds: ReadonlySet<Id>,
): BisectorSnap | null => {
  const anchor = snapToNearest(point, candidates, snapDist * BISECTOR_SEARCH_FACTOR, exceptIds);
  if (!anchor || !anchor.prev || !anchor.next) return null;
  const direction = bisectorPoint(anchor, anchor.prev, anchor.next);
  if (!direction) return null;
  if (!(distanceToLine(point, anchor, direction) <= snapDist)) return null;
  return { anchor, direction };
};
