import type { PlanPosition } from '../../PlannerDocument';
import { manhDist } from './distance';
import { pointInBounds } from './pointInBounds';
import { L_EPS } from './pointsMatch';

export interface ProjectPointOnLineOptions {
  /** `true` (дефолт) — проекция должна попасть в bbox отрезка со слаком `L_EPS`, иначе `null`. */
  asSegment?: boolean;
  /** `false` — проекция, совпавшая с концом отрезка (манхэттен `< L_EPS`), отбраковывается → `null`. */
  vertices?: boolean;
}

/**
 * Проекция точки на прямую/отрезок `ab` честным dot product (ADR 0017 C4, rework: без хака
 * `px = point.x` для почти горизонтальных прямых). Вырожденная прямая (`|ab| < L_EPS`) → `null`.
 */
export const projectPointOnLine = (
  point: PlanPosition,
  a: PlanPosition,
  b: PlanPosition,
  { asSegment = true, vertices = true }: ProjectPointOnLineOptions = {},
): PlanPosition | null => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (!(lengthSq >= L_EPS * L_EPS)) return null;
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  const projection = { x: a.x + t * dx, y: a.y + t * dy };
  if (asSegment && !pointInBounds(projection, a, b)) return null;
  if (!vertices && (manhDist(projection, a) < L_EPS || manhDist(projection, b) < L_EPS)) return null;
  return projection;
};
