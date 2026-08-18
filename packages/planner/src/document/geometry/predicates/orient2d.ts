import { orient2d as robustOrient2d } from 'robust-predicates';

import type { PlanPosition } from '../../PlannerDocument';

/**
 * Ориентационный предикат ядра (ADR 0017 C2/C4): адаптивная точная арифметика Шевчука из `robust-predicates`.
 * Знак нормализован к нашей конвенции: `> 0` — `c` слева от `a→b`, тройка против часовой стрелки при y вверх
 * (как наивный `(b − a) × (c − a)`); `< 0` — по часовой; `0` — коллинеарны (точно, без эпсилона).
 * У библиотеки знак противоположный (верифицировано спайком 0051 и тестом рядом) — здесь инверсия.
 * Величина — удвоенная знаковая площадь треугольника; тождественно нулю на коллинеарных тройках,
 * поэтому пригоден для тестов «точка на прямой», «общая вершина», «трансверсальность» без порога.
 */
export const orient2d = (a: PlanPosition, b: PlanPosition, c: PlanPosition): number =>
  // `0 - v`, а не `-v`: библиотечный ноль не должен превращаться в `-0` (снапшоты и `Object.is` их различают).
  0 - robustOrient2d(a.x, a.y, b.x, b.y, c.x, c.y);

/** Знак ориентации: `1` — против часовой (y вверх), `-1` — по часовой, `0` — коллинеарны. */
export const orientationSign = (a: PlanPosition, b: PlanPosition, c: PlanPosition): -1 | 0 | 1 => {
  const value = orient2d(a, b, c);
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
};
