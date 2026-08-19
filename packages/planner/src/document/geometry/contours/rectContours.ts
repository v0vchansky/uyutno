import type { PlanPosition } from '../../PlannerDocument';
import { contourValid } from '../predicates/contourArea';

/** Контуры прямоугольной комнаты: `outer` — сам прямоугольник, `inner` — полость (`null` — сплошной контур). */
export interface RectContours {
  outer: readonly [PlanPosition, PlanPosition, PlanPosition, PlanPosition];
  inner: readonly [PlanPosition, PlanPosition, PlanPosition, PlanPosition] | null;
}

/**
 * Контуры инструмента «Прямоугольная комната» по двум противоположным углам (спека 01 «Rectangle Room»,
 * ADR 0017 C1, ADR 0019 E3; как `findBoxes` референса, верифицировано 0052): `outer` — прямоугольник
 * `(minX, minY) → (maxX, minY) → (maxX, maxY) → (minX, maxY)` (обход против часовой при y вверх);
 * если **обе** стороны больше `2 × width`, есть `inner` — тот же прямоугольник, ужатый на `width` с каждой
 * стороны (полая комната: тело стен между контурами и полость), иначе `inner = null` — сплошной 4-точечный
 * контур. Уточнение к правилу референса: полость, не проходящая `contourValid` (сливер уже ~2 см при
 * длинной стороне — команда `addContours` такую отвергла бы целиком), считается отсутствующей — контур
 * сплошной. Порядок углов входа не важен; вырожденный прямоугольник (`a`/`b` на одной прямой) отдаётся как
 * есть — гард размеров лежит на инструменте.
 */
export const rectContours = (a: PlanPosition, b: PlanPosition, width: number): RectContours => {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const outer = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ] as const;
  if (!(width > 0) || maxX - minX <= 2 * width || maxY - minY <= 2 * width) return { outer, inner: null };
  const inner = [
    { x: minX + width, y: minY + width },
    { x: maxX - width, y: minY + width },
    { x: maxX - width, y: maxY - width },
    { x: minX + width, y: maxY - width },
  ] as const;
  return { outer, inner: contourValid(inner) ? inner : null };
};
