import type { PlanPosition } from '../../PlannerDocument';

/**
 * Якорь подписи комнаты (спека 07 «Автоматические размеры на стенах»: имя и площадь — «в центре комнаты»;
 * handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Подписи»). Слой `document/`: только числа, ни DOM,
 * ни React — оверлей переводит результат в экранные координаты сам (`planToView`).
 *
 * Берётся именно **площадной** центроид, а не среднее вершин: у Г-образной комнаты среднее вершин уезжает в
 * сторону угла, где вершин гуще, и подпись садится на стену. Центроид площади ведёт себя как «центр тяжести»
 * фигуры — то, что читается как центр комнаты.
 */

/**
 * Площадь ниже этого порога (см²) считается вырожденной: 1e-6 см² — на три порядка мельче кванта координат
 * (0.001 см, `document/quantize.ts`), то есть заведомо не настоящая комната, а коллинеарные точки.
 */
const DEGENERATE_AREA = 1e-6;

/**
 * Центроид простого многоугольника (незамкнутый массив вершин, ориентация любая): классические формулы
 * `Cx = Σ (xi + xi+1)(xi·yi+1 − xi+1·yi) / (6A)`, `A` — знаковая площадь. `null` — вершин меньше трёх,
 * координаты не конечные или площадь вырождена (все точки на одной прямой): звать центром нечего, вызывающий
 * подставляет свой запасной якорь.
 */
export const polygonCentroid = (points: readonly PlanPosition[]): PlanPosition | null => {
  if (points.length < 3) return null;

  let doubleArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const cross = a.x * b.y - b.x * a.y;
    doubleArea += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }

  if (!Number.isFinite(doubleArea) || Math.abs(doubleArea) / 2 < DEGENERATE_AREA) return null;
  const centroid = { x: x / (3 * doubleArea), y: y / (3 * doubleArea) };
  return Number.isFinite(centroid.x) && Number.isFinite(centroid.y) ? centroid : null;
};
