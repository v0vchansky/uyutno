import type { PlanPosition } from '../../PlannerDocument';
import { angleBetweenLines } from '../predicates/angleBetweenLines';
import { manhDist } from '../predicates/distance';
import type { OffsetSide } from '../predicates/offsetPoint';
import { B_EPS } from '../predicates/pointOnSegment';
import type { StartNeighbourSegments } from './blocksFromContour';

/** Ребро короче этого (манхэттен, см) в автовыборе стороны не участвует (спека 01 «Ограничения и пороги»). */
export const SIDE_PICK_MIN_EDGE = 5;

/**
 * Автовыбор стороны ленты при старте от существующей стены (спека 01: «по наименьшему углу к соседним
 * сегментам», до третьей точки; фиксация после третьей — состояние инструмента, ADR 0017 C5/E).
 * Сравниваются ориентированные углы: поворот от первого луча к сегменту `first→second` и от сегмента ко
 * второму лучу; если первый не больше второго (с допуском `B_EPS`) — лента слева от `first→second`, иначе
 * справа (формула `calcStart` референса; `signSide = +1` ⇔ левая нормаль). Порядок соседей — как отдаёт
 * `findNearSegments` (0062), семантики «левый/правый» у него нет; для соседей на одной прямой (обычный
 * T-стык) результат от порядка не зависит: лента ложится в меньший угол между сегментом и существующей стеной. `null` — выбирать не по чему: ребро короче `SIDE_PICK_MIN_EDGE` (инструмент
 * оставляет текущую сторону).
 */
export const autoOffsetSide = (
  first: PlanPosition,
  second: PlanPosition,
  [n0, n1]: StartNeighbourSegments,
): OffsetSide | null => {
  if (manhDist(first, second) < SIDE_PICK_MIN_EDGE) return null;
  const fromN0 = angleBetweenLines(first, second, first, n0);
  const toN1 = angleBetweenLines(first, n1, first, second);
  // Допуск сравнения углов — `B_EPS`, как у референса (там это тот же `TR.B_EPS`, хотя он дистанционный).
  return fromN0 < toN1 + B_EPS ? 'left' : 'right';
};
