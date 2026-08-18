import type { PlanPosition } from '../../PlannerDocument';
import { distanceToLine } from './distanceToLine';
import { B_EPS } from './pointOnSegment';
import { L_EPS } from './pointsMatch';

/**
 * Коллинеарное наложение отрезков `ab` и `ef` ненулевой длины (ADR 0017 C4, keep):
 * 1) оба конца `ab` лежат на прямой `ef` не дальше `dist` (дефолт `L_EPS` — фактически точная коллинеарность,
 *    держится на дисциплине общих вершин бит-в-бит);
 * 2) 1D-перекрытие проекций: ось сравнения — `x`, если хоть один отрезок почти горизонтален (`|Δy| < B_EPS`),
 *    иначе `y`; отсечка с отрицательным слаком `−L_EPS`, поэтому **касание только общим концом наложением
 *    не считается** — нужен реальный нахлёст.
 * Ожидает отрезки длиннее эпсилона — вырожденные фильтрует вызывающий (`checkContact`).
 */
export const segmentsOverlay = (
  a: PlanPosition,
  b: PlanPosition,
  e: PlanPosition,
  f: PlanPosition,
  dist: number = L_EPS,
): boolean => {
  // Отрицательная форма (`!(d <= dist)`), чтобы `NaN` во входе давал `false`, а не «наложение».
  if (!(distanceToLine(a, e, f) <= dist) || !(distanceToLine(b, e, f) <= dist)) return false;
  const horizontal = Math.abs(a.y - b.y) < B_EPS || Math.abs(e.y - f.y) < B_EPS;
  const [a1, b1, e1, f1] = horizontal ? [a.x, b.x, e.x, f.x] : [a.y, b.y, e.y, f.y];
  // Слак отрицательный: `ab` целиком левее/правее `ef` уже при касании концами.
  if (Math.max(a1, b1) < Math.min(e1, f1) + L_EPS) return false;
  if (Math.min(a1, b1) > Math.max(e1, f1) - L_EPS) return false;
  return true;
};
