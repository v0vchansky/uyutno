import type { PlanPosition } from '../../PlannerDocument';
import { contourArea } from './contourArea';
import { findMinMax } from './findMinMax';

/** Разница площадей, см², в пределах которой порядок решает не площадь, а вид контура (ADR 0017 C1/C3). */
export const SORT_AREA_EPS = 10;

/** Минимум того, что нужно сортировке: вершины и вид (`outer` — обвод тела стен, `inner` — полость-комната). */
export interface SortableContour {
  points: readonly PlanPosition[];
  kind: 'outer' | 'inner';
}

/**
 * Детерминированный порядок контуров (ADR 0017 C1, как `sortByArea` референса): по убыванию `|площади|`;
 * при разнице `< SORT_AREA_EPS` — `outer` после `inner`; остаточный tie-break — `(minX, minY)` bbox
 * по возрастанию. Возвращает новый массив, вход не мутирует; сортировка стабильна (`Array.prototype.sort`).
 */
export const sortByArea = <T extends SortableContour>(contours: readonly T[]): T[] => {
  const measured = contours.map(contour => ({
    contour,
    area: Math.abs(contourArea(contour.points)),
    bounds: findMinMax(contour.points),
  }));
  measured.sort((first, second) => {
    if (Math.abs(first.area - second.area) < SORT_AREA_EPS) {
      if (first.contour.kind !== second.contour.kind) return first.contour.kind === 'outer' ? 1 : -1;
    } else {
      return second.area - first.area;
    }
    const minX = (first.bounds?.minX ?? 0) - (second.bounds?.minX ?? 0);
    if (minX !== 0) return minX;
    return (first.bounds?.minY ?? 0) - (second.bounds?.minY ?? 0);
  });
  return measured.map(entry => entry.contour);
};
