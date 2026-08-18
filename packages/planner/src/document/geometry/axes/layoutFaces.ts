import type { Contour, Point } from '../../PlannerDocument';
import type { Id } from '../../id';
import { contourArea } from '../predicates/contourArea';
import type { WallFace } from './findAxes';

/**
 * Грани хранимых контуров для `findAxes` (ADR 0017 C8): каждое ребро контура `p[i] → p[i+1]` в порядке обхода;
 * `faceRight` (тело стены справа от `a → b`, см. `rightOriented`) выводится из вида и ориентации: у `inner`
 * против часовой полость слева — тело справа; у `outer` против часовой тело слева. Контур с < 3 разрешёнными
 * точками граней не даёт; ребро с пропавшей точкой пропускается.
 */
export const layoutFaces = (contours: readonly Contour[], points: Readonly<Record<Id, Point>>): WallFace[] => {
  const faces: WallFace[] = [];
  for (const contour of contours) {
    const resolved = contour.points.map(id => points[id]).filter((point): point is Point => point !== undefined);
    if (resolved.length < 3) continue;
    const ccw = contourArea(resolved) > 0;
    const faceRight = (contour.kind === 'inner') === ccw;
    const n = resolved.length;
    for (let i = 0; i < n; i++) {
      const a = resolved[i]!;
      const b = resolved[(i + 1) % n]!;
      faces.push({ a, b, faceRight, ref: { contourId: contour.id, a: a.id, b: b.id } });
    }
  }
  return faces;
};
