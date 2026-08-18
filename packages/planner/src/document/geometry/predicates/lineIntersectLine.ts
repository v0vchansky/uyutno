import type { PlanPosition } from '../../PlannerDocument';
import { euclDist } from './distance';
import { orient2d } from './orient2d';
import { L_EPS, pointsMatch } from './pointsMatch';

export interface LineIntersectLineOptions {
  /** `true` (дефолт) — пересечение должно лежать на обоих **отрезках**; `false` — прямые. */
  asSegment?: boolean;
  /** `false` — пересечение, совпавшее (L_EPS) с любым из четырёх концов, отбраковывается: «только внутренние». */
  vertices?: boolean;
  /** Слак принадлежности отрезку, см вдоль отрезка (только при `asSegment`); дефолт `0`. */
  accuracy?: number;
}

/**
 * Пересечение прямых/отрезков `ab` и `ef` (ADR 0017 C4, rework: числители и знаменатель — через `orient2d`,
 * принадлежность отрезку — параметрически, а не анизотропным манхэттеном референса).
 *
 * - `null`: параллельность/вырожденность — `|cross(b−a, f−e)| < L_EPS` или отрезок короче `L_EPS`. Точную
 *   параллельность robust-предикат даёт нулём и без порога; порог на площади (как у референса) оставлен
 *   намеренно — как защита от почти параллельных пар, где точка пересечения плохо обусловлена (`t → ∞`).
 * - Снап к общим вершинам: если `a` совпадает (L_EPS) с `e`/`f` — результат **бит-в-бит `a`**; аналогично `b`.
 *   Так общая вершина двух рёбер возвращается без float-дрейфа (дисциплина L_EPS, C3).
 * - `asSegment`: `t ∈ [−accuracy/|ab|, 1 + accuracy/|ab|]` и то же для `u` по `ef`; снапнутая общая вершина
 *   лежит на обоих отрезках по построению и не проверяется.
 */
export const lineIntersectLine = (
  a: PlanPosition,
  b: PlanPosition,
  e: PlanPosition,
  f: PlanPosition,
  { asSegment = true, vertices = true, accuracy = 0 }: LineIntersectLineOptions = {},
): PlanPosition | null => {
  if (asSegment) {
    if (Math.max(a.x, b.x) < Math.min(e.x, f.x) - accuracy) return null;
    if (Math.min(a.x, b.x) > Math.max(e.x, f.x) + accuracy) return null;
    if (Math.max(a.y, b.y) < Math.min(e.y, f.y) - accuracy) return null;
    if (Math.min(a.y, b.y) > Math.max(e.y, f.y) + accuracy) return null;
  }
  const lengthAb = euclDist(a, b);
  const lengthEf = euclDist(e, f);
  if (!(lengthAb >= L_EPS) || !(lengthEf >= L_EPS)) return null;

  const sideA = orient2d(e, f, a);
  const sideB = orient2d(e, f, b);
  const denominator = sideA - sideB; // = cross(b − a, f − e)
  if (!(Math.abs(denominator) >= L_EPS)) return null;
  const t = sideA / denominator;

  const snappedA = pointsMatch(a, e) || pointsMatch(a, f);
  const snappedB = pointsMatch(b, e) || pointsMatch(b, f);
  let point: PlanPosition;
  if (snappedB) point = b;
  else if (snappedA) point = a;
  else point = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };

  if (asSegment && !snappedA && !snappedB) {
    const sideE = orient2d(a, b, e);
    const sideF = orient2d(a, b, f);
    const u = sideE / (sideE - sideF);
    const slackT = accuracy / lengthAb;
    const slackU = accuracy / lengthEf;
    if (!(t >= -slackT && t <= 1 + slackT && u >= -slackU && u <= 1 + slackU)) return null;
  }
  if (!vertices && (pointsMatch(point, a) || pointsMatch(point, b) || pointsMatch(point, e) || pointsMatch(point, f))) {
    return null;
  }
  return point;
};
