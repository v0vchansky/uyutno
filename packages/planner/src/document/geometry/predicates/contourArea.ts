import type { PlanPosition } from '../../PlannerDocument';
import { euclDist } from './distance';

/** Минимальная площадь валидного контура, см² (ADR 0017 C3). */
export const MIN_CONTOUR_AREA = 50;
/** Минимальное отношение площадь/периметр, см — анти-сливер: у длинного узкого контура стремится к полуширине. */
export const MIN_SP_RATIO = 1;

/**
 * Знаковая площадь по формуле шнурков; **`> 0` — обход против часовой при y вверх** — наша конвенция
 * (та же, что у `orient2d`; у референса знак противоположный — ADR 0017 «Знаки»). Контур — незамкнутый
 * массив вершин; `< 3` точек → `0`.
 */
export const contourArea = (contour: readonly PlanPosition[]): number => {
  const n = contour.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = contour[i]!;
    const b = contour[(i + 1) % n]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};

/** Периметр — сумма евклидовых длин рёбер, включая замыкающее. `< 2` точек → `0`. */
export const contourPerim = (contour: readonly PlanPosition[]): number => {
  const n = contour.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += euclDist(contour[i]!, contour[(i + 1) % n]!);
  return sum;
};

/**
 * Двойной анти-сливер (ADR 0017 C4): `|area| ≥ MIN_CONTOUR_AREA` и `|area| / perim ≥ MIN_SP_RATIO`.
 * Контуры, не прошедшие фильтр, выбрасываются из результата обвода (`clearContour`, 0054) и отказом
 * на завершении рисования (`validateContour`).
 */
export const contourValid = (contour: readonly PlanPosition[]): boolean => {
  const area = Math.abs(contourArea(contour));
  const perim = contourPerim(contour);
  return area >= MIN_CONTOUR_AREA && perim > 0 && area / perim >= MIN_SP_RATIO;
};
