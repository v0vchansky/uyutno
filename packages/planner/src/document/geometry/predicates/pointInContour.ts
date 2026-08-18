import type { PlanPosition } from '../../PlannerDocument';
import { orient2d } from './orient2d';
import { pointOnContour } from './pointOnContour';
import { B_EPS } from './pointOnSegment';

/** Положение точки относительно замкнутого контура: граница — B_EPS-коридор, внутри/снаружи — без эпсилона. */
export type PointLocation = 'inside' | 'boundary' | 'outside';

/**
 * Классификация точки относительно контура (ADR 0017 C3/C4, rework ray casting референса): сначала
 * граница через `pointOnContour` (`accuracy`, дефолт `B_EPS`), затем чётность пересечений горизонтального
 * луча с **полуоткрытыми по y** рёбрами `[min y, max y)` через `orient2d` — третьего эпсилона нет,
 * вершины на луче считаются ровно один раз, деления нет. Контур — незамкнутый массив вершин; `< 3` точек
 * — площади нет: `'boundary'` для точек на рёбрах/вершинах, иначе `'outside'`. Ориентация обхода не важна.
 */
export const locatePointInContour = (
  point: PlanPosition,
  contour: readonly PlanPosition[],
  accuracy: number = B_EPS,
): PointLocation => {
  if (pointOnContour(point, contour, accuracy)) return 'boundary';
  const n = contour.length;
  if (n < 3) return 'outside';
  let inside = false;
  for (let i = 0; i < n; i++) {
    const a = contour[i]!;
    const b = contour[(i + 1) % n]!;
    // Ребро пересекает горизонталь точки по полуоткрытому правилу (a.y > p.y) !== (b.y > p.y).
    if (a.y > point.y === b.y > point.y) continue;
    // Пересечение правее точки ⇔ точка слева от ребра, направленного снизу вверх.
    const upward = b.y > a.y;
    const side = orient2d(a, b, point);
    if (upward ? side > 0 : side < 0) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
};

/** Точка строго внутри контура: граница (B_EPS) и всё, что не внутри, — `false`. */
export const pointInContour = (point: PlanPosition, contour: readonly PlanPosition[]): boolean =>
  locatePointInContour(point, contour) === 'inside';

/**
 * Счётчик контуров, строго содержащих точку (не булево: классификация групп триангуляции сравнивает
 * `inside(outer) > inside(inner)`, ADR 0017 C6). `one = true` — ранний выход `1` при первом попадании.
 */
export const pointInContours = (
  point: PlanPosition,
  contours: readonly (readonly PlanPosition[])[],
  one = false,
): number => {
  let count = 0;
  for (const contour of contours) {
    if (pointInContour(point, contour)) {
      count++;
      if (one) return 1;
    }
  }
  return count;
};
