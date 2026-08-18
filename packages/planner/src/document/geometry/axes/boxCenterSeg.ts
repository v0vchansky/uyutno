import type { PlanPosition } from '../../PlannerDocument';
import { MIN_WALL_LENGTH } from '../contours/validateContour';
import { euclDist } from '../predicates/distance';
import type { ParallelBox } from './parallelBox';

/** Максимальная толщина стены, см (спека 01 «Ограничения», ADR 0017 C3): пара граней дальше — не стена. */
export const MAX_WALL_WIDTH = 80;

/**
 * Центральный сегмент бокса перекрытия (ADR 0017 C8, `boxCenterSeg` референса): `[mid(H, E), mid(F, G)]` —
 * середины торцов; `null`, если поперечник `|FG| > MAX_WALL_WIDTH` (слишком толстая «стена») или длина
 * перекрытия `|EF| < MIN_WALL_LENGTH` (слишком короткая). Направление здесь — от `E` к `F`; каноническое
 * направление оси задаёт `findAxes`.
 */
export const boxCenterSeg = ([e, f, g, h]: ParallelBox): [PlanPosition, PlanPosition] | null => {
  if (euclDist(f, g) > MAX_WALL_WIDTH) return null;
  if (euclDist(e, f) < MIN_WALL_LENGTH) return null;
  return [
    { x: (h.x + e.x) / 2, y: (h.y + e.y) / 2 },
    { x: (f.x + g.x) / 2, y: (f.y + g.y) / 2 },
  ];
};
