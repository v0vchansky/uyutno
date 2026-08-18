import { PLAN_UP_IN_WORLD, planToWorld, worldToPlan } from './planToWorld';

describe('planToWorld / worldToPlan (ADR 0016 B1: (x, y) → (x, h, −y))', () => {
  it('маппит план в мир: x без изменений, высота → y, y плана → −z', () => {
    expect(planToWorld({ x: 120, y: 340 }, 280)).toEqual({ x: 120, y: 280, z: -340 });
  });

  it('высота по умолчанию — 0 (пол)', () => {
    expect(planToWorld({ x: 1, y: 2 })).toEqual({ x: 1, y: 0, z: -2 });
  });

  it('отрицательные координаты плана меняют знак z, x сохраняется', () => {
    expect(planToWorld({ x: -50, y: -75 })).toEqual({ x: -50, y: 0, z: 75 });
  });

  it('ноль не порождает −0 ни в одну сторону', () => {
    expect(Object.is(planToWorld({ x: 0, y: 0 }).z, 0)).toBe(true);
    expect(Object.is(worldToPlan({ x: 0, y: 0, z: 0 }).y, 0)).toBe(true);
  });

  it('дробные значения (квант 0.001 см) переносятся без потери', () => {
    expect(planToWorld({ x: 0.001, y: 12.345 }, 0.5)).toEqual({ x: 0.001, y: 0.5, z: -12.345 });
  });

  it('не-конечные значения пробрасываются как есть (валидация — на границе команд)', () => {
    const world = planToWorld({ x: NaN, y: Infinity });
    expect(Number.isNaN(world.x)).toBe(true);
    expect(world.z).toBe(-Infinity);
  });

  it('worldToPlan — обратное преобразование, высота отбрасывается: worldToPlan(planToWorld(p, h)) == p', () => {
    const cases = [
      { x: 0, y: 0 },
      { x: 12.5, y: -7.25 },
      { x: -1000, y: 1000 },
    ];
    for (const point of cases) {
      expect(worldToPlan(planToWorld(point, 280))).toEqual(point);
    }
  });

  it('planToWorld(worldToPlan(w), w.y) == w', () => {
    const world = { x: 3, y: 150, z: -9 };
    expect(planToWorld(worldToPlan(world), world.y)).toEqual(world);
  });

  it('«вверх по плану» в мире — направление −z (up-вектор ортокамеры сверху)', () => {
    expect(PLAN_UP_IN_WORLD).toEqual({ x: 0, y: 0, z: -1 });
  });
});
