import type { PlanPosition } from '../../PlannerDocument';
import { B_EPS, pointOnSegment } from './pointOnSegment';

/**
 * Точка на границе замкнутого контура: перебор рёбер, включая замыкающее `last→first` (ADR 0017 C4).
 * Контур — незамкнутый массив вершин без дубля первой точки (модель документа, ADR 0016).
 * Меньше двух точек — границы нет → `false`; две точки — одно ребро (туда-обратно).
 */
export const pointOnContour = (
  point: PlanPosition,
  contour: readonly PlanPosition[],
  accuracy: number = B_EPS,
): boolean => {
  const n = contour.length;
  if (n < 2) return false;
  for (let i = 0; i < n; i++) {
    const a = contour[i]!;
    const b = contour[(i + 1) % n]!;
    if (pointOnSegment(point, a, b, accuracy)) return true;
  }
  return false;
};
