import type { PlanPosition } from '../../PlannerDocument';

/**
 * Две метрики ядра (ADR 0017 C4): какую применяет снап/хит-тест/замыкание — решает слой инструментов (Q34);
 * внутри ядра метрика фиксирована там, где она часть алгоритма (`triangleIsNarrow`, `checkContact` — манхэттен).
 */

/** Манхэттен `|dx| + |dy|`. */
export const manhDist = (a: PlanPosition, b: PlanPosition): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Евклид `hypot(dx, dy)`. */
export const euclDist = (a: PlanPosition, b: PlanPosition): number => Math.hypot(a.x - b.x, a.y - b.y);
