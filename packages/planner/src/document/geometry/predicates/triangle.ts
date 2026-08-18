import type { PlanPosition } from '../../PlannerDocument';
import { manhDist } from './distance';
import { orient2d } from './orient2d';

/**
 * Порог «узкого» треугольника, см по манхэттену (ADR 0017 C3): любая сторона короче — центроид ненадёжен
 * для классификации (может лечь в B_EPS-зону границы), группа берёт следующий треугольник.
 */
export const TRIANGLE_NARROW = 0.1;

/** Центроид — среднее вершин. */
export const triangleCenter = (a: PlanPosition, b: PlanPosition, c: PlanPosition): PlanPosition => ({
  x: (a.x + b.x + c.x) / 3,
  y: (a.y + b.y + c.y) / 3,
});

/** Знаковая площадь: `> 0` — вершины против часовой при y вверх (конвенция `orient2d`), `0` — вырожден. */
export const triangleArea = (a: PlanPosition, b: PlanPosition, c: PlanPosition): number => orient2d(a, b, c) / 2;

/** Есть сторона короче `minLen` по манхэттену (метрика — часть алгоритма референса, ADR 0017 C4). */
export const triangleIsNarrow = (
  a: PlanPosition,
  b: PlanPosition,
  c: PlanPosition,
  minLen: number = TRIANGLE_NARROW,
): boolean => manhDist(a, b) < minLen || manhDist(b, c) < minLen || manhDist(c, a) < minLen;
