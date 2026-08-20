import type { PlanPosition } from '../../PlannerDocument';
import { quantize } from '../../quantize';

/**
 * Точка на расстоянии `length` см от `from` по направлению `from → towards` (ADR 0019 E3: Enter в live-инпуте
 * длины считает точку этой функцией, автомат ставит её `commitPoint` без снапа). `null` — направление не
 * определено (`from` совпал с `towards`) или `length` не конечное. Результат квантуется (`quantize`, 0.001 см).
 *
 * Отрицательный `length` допустим — точка уходит в обратную сторону от `towards`; пороги ввода (спека 07
 * «Ограничения и пороги», 01 «Ввод длины») проверяет вызывающий, чистая геометрия их не знает.
 */
export const pointAtLength = (from: PlanPosition, towards: PlanPosition, length: number): PlanPosition | null => {
  if (!Number.isFinite(length)) return null;

  const dx = towards.x - from.x;
  const dy = towards.y - from.y;
  const dist = Math.hypot(dx, dy);
  // `dist > 0` отсекает и вырожденное направление, и NaN/Infinity в любой из координат (сравнение с NaN — false).
  if (!(dist > 0) || !Number.isFinite(dist)) return null;

  return {
    x: quantize(from.x + (dx / dist) * length),
    y: quantize(from.y + (dy / dist) * length),
  };
};
