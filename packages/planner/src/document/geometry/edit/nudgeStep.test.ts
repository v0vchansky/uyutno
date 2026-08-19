import { NUDGE_STEP_CM, nudgeStep } from './nudgeStep';

describe('nudgeStep — шаг нуджа по единицам (ADR 0019 E4, спека 01)', () => {
  it('см/м — 1 см, мм — 0.1 см, ftin — 1.27 см', () => {
    expect(NUDGE_STEP_CM).toEqual({ cm: 1, m: 1, mm: 0.1, ftin: 1.27 });
    expect(nudgeStep('cm', 1)).toBe(1);
    expect(nudgeStep('m', 1)).toBe(1);
    expect(nudgeStep('mm', 1)).toBe(0.1);
    expect(nudgeStep('ftin', 1)).toBe(1.27);
  });

  it('factor умножает: Shift ×10, Shift+Ctrl ×0.1', () => {
    expect(nudgeStep('cm', 10)).toBe(10);
    expect(nudgeStep('cm', 0.1)).toBe(0.1);
    expect(nudgeStep('ftin', 10)).toBeCloseTo(12.7, 9);
  });
});
