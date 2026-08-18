import type { PlanPosition } from '../../PlannerDocument';
import type { Bounds } from '../predicates/findMinMax';
import { cullCandidates, type SnapCandidate } from './candidates';
import { snapPerpendicular, type PerpendicularSnap } from './snapAxis';

const NO_EXCEPT: ReadonlySet<string> = new Set();

/** Синтетические id якорей орто-лока (в пул кандидатов они не входят, `exceptIds` их не касается). */
export const ORTHO_LAST_ID = 'ortho:last';
export const ORTHO_FIRST_ID = 'ortho:first';

/**
 * Орто-лок (спека 01 «Орто-лок», флаг `orthoAlign`, дефолт off): H/V-выравнивание относительно **последней
 * зафиксированной** и **первой** точки рисуемого контура через `snapPerpendicular` — лок к предыдущей точке и
 * к замыканию. `contour` — зафиксированные точки без живого курсора (у референса курсор лежал в контуре
 * последним, поэтому там `points[len − 2]` и порог «≥ 2»); нужна хотя бы одна точка. Якоря куллятся по
 * `bounds` как любые кандидаты (у референса — `farPoints = []`, обе точки должны быть в кадре).
 * Нет точек / оба якоря вне кадра / мимо порога → `point: null`.
 */
export const orthogonalSnap = (
  point: PlanPosition,
  contour: readonly PlanPosition[],
  snapDist: number,
  bounds: Bounds,
): PerpendicularSnap => {
  const first = contour[0];
  const last = contour[contour.length - 1];
  const anchors: SnapCandidate[] = [];
  if (last && contour.length > 1) anchors.push({ id: ORTHO_LAST_ID, x: last.x, y: last.y });
  if (first) anchors.push({ id: ORTHO_FIRST_ID, x: first.x, y: first.y });
  return snapPerpendicular(point, cullCandidates(anchors, bounds), snapDist, NO_EXCEPT);
};
