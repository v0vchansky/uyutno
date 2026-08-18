import type { PlanPosition } from '../../PlannerDocument';
import { angleBetweenLines } from './angleBetweenLines';
import { orient2d } from './orient2d';

/**
 * Грань стены как направленный отрезок с признаком стороны комнаты: `faceRight` — комната справа от `a→b`
 * (при y вверх). В rebuild признак выводится из ориентации контура (ADR 0017 C6/C8, задача 0054).
 */
export interface OrientedFace {
  a: PlanPosition;
  b: PlanPosition;
  faceRight: boolean;
}

/**
 * Две грани «смотрят друг на друга» (ADR 0017 C4/C8, `WC.rightOriented` референса): XOR-таблица из
 * грубой сонаправленности (`angle < π/2 || angle > 3π/2`), положения начала второй грани слева от первой
 * (`orient2d > 0`) и признаков `faceRight` обеих граней. Отсекает пары «в спину» перед `parallelBox`.
 */
export const rightOriented = (first: OrientedFace, second: OrientedFace): boolean => {
  const angle = angleBetweenLines(first.a, first.b, second.a, second.b);
  const parallel = angle < Math.PI / 2 || angle > (Math.PI * 3) / 2;
  const secondOnLeft = orient2d(first.a, first.b, second.a) > 0;
  if (parallel) {
    return secondOnLeft ? !first.faceRight && second.faceRight : first.faceRight && !second.faceRight;
  }
  return secondOnLeft ? !first.faceRight && !second.faceRight : first.faceRight && second.faceRight;
};
