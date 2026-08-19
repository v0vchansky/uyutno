import type { Units } from '../../PlannerDocument';

/**
 * Базовый шаг нуджа выделения стрелками/WASD по единицам документа, см (ADR 0019 E4; спека 01): 1 см для см/м,
 * 0.1 см (1 мм) для мм, 1.27 см (полдюйма) для футов-дюймов; `factor` — модификаторы клавиш (Shift ×10,
 * Shift+Ctrl/Cmd ×0.1) — считает keymap, здесь только умножение.
 */
export const NUDGE_STEP_CM: Readonly<Record<Units, number>> = Object.freeze({
  cm: 1,
  m: 1,
  mm: 0.1,
  ftin: 1.27,
});

export const nudgeStep = (units: Units, factor: number): number => NUDGE_STEP_CM[units] * factor;
