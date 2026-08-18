import type { PlanPosition } from '../../PlannerDocument';

/**
 * Эпсилон тождества координат (ADR 0017 C3): совпадение точек, дедуп вершин, параллельность/коллинеарность.
 * Работает в связке с квантованием 0.001 (ADR 0016 B1) и снапом пересечений к общим вершинам в
 * `lineIntersectLine`: общие вершины совпадают бит-в-бит, поэтому допуск может быть таким строгим.
 */
export const L_EPS = 1e-8;

/** Тождество точек: покомпонентно (чебышёв), строго меньше `accuracy` по каждой оси. `NaN` → `false`. */
export const pointsMatch = (a: PlanPosition, b: PlanPosition, accuracy: number = L_EPS): boolean =>
  Math.abs(a.x - b.x) < accuracy && Math.abs(a.y - b.y) < accuracy;
