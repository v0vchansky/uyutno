import type { PlanPosition } from '../../PlannerDocument';
import { manhDist } from './distance';
import { B_EPS } from './pointOnSegment';
import { segmentsOverlay } from './segmentsOverlay';

/**
 * Контуры делят кусок границы: есть пара рёбер (включая замыкающие) с коллинеарным нахлёстом ненулевой длины
 * (`segmentsOverlay`); точечное касание углами контактом не является. Рёбра короче `B_EPS` по манхэттену
 * пропускаются. O(n·m) — контуры комнат маленькие (ADR 0017 C4/C11).
 */
export const checkContact = (contourA: readonly PlanPosition[], contourB: readonly PlanPosition[]): boolean => {
  const n = contourA.length;
  const m = contourB.length;
  for (let i = 0; i < n; i++) {
    const a = contourA[i]!;
    const b = contourA[(i + 1) % n]!;
    if (manhDist(a, b) < B_EPS) continue;
    for (let j = 0; j < m; j++) {
      const e = contourB[j]!;
      const f = contourB[(j + 1) % m]!;
      if (manhDist(e, f) < B_EPS) continue;
      if (segmentsOverlay(a, b, e, f)) return true;
    }
  }
  return false;
};
