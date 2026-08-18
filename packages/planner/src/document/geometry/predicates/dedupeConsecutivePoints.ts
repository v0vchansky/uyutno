import type { PlanPosition } from '../../PlannerDocument';
import { pointsMatch } from './pointsMatch';

/**
 * Дубли точек «отбрасываются на завершении» (спека 01): убирает подряд идущие совпадающие (L_EPS) точки,
 * а для замкнутого контура — и хвост, совпавший с первой точкой. Несмежные дубли (контур вернулся в
 * свою вершину) остаются — их ловит `validateContour` как `duplicatePoints`. Возвращает новый массив.
 */
export const dedupeConsecutivePoints = (points: readonly PlanPosition[], closed = true): PlanPosition[] => {
  const result: PlanPosition[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (previous && pointsMatch(previous, point)) continue;
    result.push(point);
  }
  while (closed && result.length > 1 && pointsMatch(result[0]!, result[result.length - 1]!)) result.pop();
  return result;
};
