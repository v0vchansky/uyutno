import type { PlanPosition } from '../../PlannerDocument';
import { PARALLEL_EPS, parallelLines } from '../predicates/angleBetweenLines';
import { euclDist, manhDist } from '../predicates/distance';
import { L_EPS } from '../predicates/pointsMatch';
import { projectPointOnLine } from '../predicates/projectPointOnLine';

/**
 * Прямоугольник перекрытия двух почти параллельных граней `[E, F, G, H]`: `E, F` — на прямой первой грани
 * (`A→B`), `G, H` — их проекции на прямую второй (`C→D`), `E` ближе к `A`, `H` — проекция `E`, `G` — проекция `F`.
 */
export type ParallelBox = [PlanPosition, PlanPosition, PlanPosition, PlanPosition];

/**
 * Участок перекрытия граней `AB` и `CD` (ADR 0017 C8, `parallelBox` референса, 4-case): по попаданию проекций
 * `C`, `D` на **отрезок** `AB` (`projectPointOnLine` с `asSegment`):
 * - обе внутри → `[projC, projD]` (ближняя к `A` первой);
 * - обе снаружи → `[A, B]`, если `CD` накрывает `AB` (концы по разные стороны: `ac < bc && ad > bd` либо
 *   наоборот), иначе перекрытия нет → `null`;
 * - только `C` внутри → `[projC, B]` при `ad > bd`, иначе `[A, projC]`; симметрично для `D`.
 * Отказ: не параллельны (`maxAngle`, дефолт `PARALLEL_EPS`) или вырожденное перекрытие `manhDist(E, F) < L_EPS`
 * (касание концами). Проекции на бесконечную прямую `CD` для `G`, `H`. Вход не мутируется.
 */
export const parallelBox = (
  a: PlanPosition,
  b: PlanPosition,
  c: PlanPosition,
  d: PlanPosition,
  maxAngle: number = PARALLEL_EPS,
): ParallelBox | null => {
  if (!parallelLines(a, b, c, d, maxAngle)) return null;
  const projC = projectPointOnLine(c, a, b, { asSegment: false });
  const projD = projectPointOnLine(d, a, b, { asSegment: false });
  if (!projC || !projD) return null;
  const insideC = projectPointOnLine(c, a, b) !== null;
  const insideD = projectPointOnLine(d, a, b) !== null;

  const ac = euclDist(a, c);
  const bc = euclDist(b, c);
  const ad = euclDist(a, d);
  const bd = euclDist(b, d);

  let e: PlanPosition;
  let f: PlanPosition;
  if (insideC && insideD) {
    [e, f] = ac < ad ? [projC, projD] : [projD, projC];
  } else if (!insideC && !insideD) {
    if ((ac < bc && ad > bd) || (ac > bc && ad < bd)) {
      [e, f] = [a, b];
    } else {
      return null;
    }
  } else if (insideC) {
    [e, f] = ad > bd ? [projC, b] : [a, projC];
  } else {
    [e, f] = ac > bc ? [projD, b] : [a, projD];
  }
  if (!(manhDist(e, f) >= L_EPS)) return null;

  const g = projectPointOnLine(f, c, d, { asSegment: false });
  const h = projectPointOnLine(e, c, d, { asSegment: false });
  if (!g || !h) return null;
  return [{ x: e.x, y: e.y }, { x: f.x, y: f.y }, g, h];
};
