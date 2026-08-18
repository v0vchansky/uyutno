import * as fc from 'fast-check';

import { arbPoint, fcParams } from '../testing/arbitraries';
import { PARALLEL_EPS, angleBetweenLines, parallelLines } from './angleBetweenLines';
import { euclDist } from './distance';

const O = { x: 0, y: 0 };
const UP = { x: 0, y: 10 };
const RIGHT = { x: 10, y: 0 };
const DOWN = { x: 0, y: -10 };
const LEFT = { x: -10, y: 0 };

describe('angleBetweenLines', () => {
  it('сонаправленные — 0, противонаправленные — π (независимо от длин)', () => {
    expect(angleBetweenLines(O, RIGHT, O, { x: 1, y: 0 })).toBe(0);
    expect(angleBetweenLines(O, RIGHT, O, LEFT)).toBeCloseTo(Math.PI, 12);
    expect(angleBetweenLines(O, UP, O, DOWN)).toBeCloseTo(Math.PI, 12);
  });

  it('ориентированный: поворот от cd к ab по часовой при y вверх; все четыре квадранта', () => {
    // От +Y к +X — четверть оборота по часовой.
    expect(angleBetweenLines(O, RIGHT, O, UP)).toBeCloseTo(Math.PI / 2, 12);
    // От +Y к −X — три четверти по часовой (= четверть против).
    expect(angleBetweenLines(O, LEFT, O, UP)).toBeCloseTo((3 * Math.PI) / 2, 12);
    // От +X к −Y — четверть по часовой.
    expect(angleBetweenLines(O, DOWN, O, RIGHT)).toBeCloseTo(Math.PI / 2, 12);
    // От −X к +Y — четверть по часовой.
    expect(angleBetweenLines(O, UP, O, LEFT)).toBeCloseTo(Math.PI / 2, 12);
    // От −Y к −X — четверть по часовой.
    expect(angleBetweenLines(O, LEFT, O, DOWN)).toBeCloseTo(Math.PI / 2, 12);
    // Диагонали.
    expect(angleBetweenLines(O, { x: 1, y: 1 }, O, UP)).toBeCloseTo(Math.PI / 4, 12);
    expect(angleBetweenLines(O, { x: -1, y: -1 }, O, UP)).toBeCloseTo((5 * Math.PI) / 4, 12);
    expect(angleBetweenLines(O, { x: 1, y: -1 }, O, UP)).toBeCloseTo((3 * Math.PI) / 4, 12);
    expect(angleBetweenLines(O, { x: -1, y: 1 }, O, UP)).toBeCloseTo((7 * Math.PI) / 4, 12);
  });

  it('диапазон [0, 2π): angle(ab, cd) + angle(cd, ab) = 2π (кроме сонаправленных)', () => {
    const a = angleBetweenLines(O, { x: 3, y: 4 }, O, { x: -2, y: 7 });
    const b = angleBetweenLines(O, { x: -2, y: 7 }, O, { x: 3, y: 4 });
    expect(a + b).toBeCloseTo(2 * Math.PI, 12);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 * Math.PI);
  });

  it('прямые не из начала координат — только направления имеют значение', () => {
    expect(angleBetweenLines({ x: 5, y: 5 }, { x: 15, y: 5 }, { x: -3, y: 9 }, { x: -3, y: 19 })).toBeCloseTo(
      Math.PI / 2,
      12,
    );
  });

  it('нулевой вектор (a == b) — направление +Y без ошибки', () => {
    expect(angleBetweenLines(O, O, O, UP)).toBe(0);
    expect(angleBetweenLines(O, RIGHT, O, O)).toBeCloseTo(Math.PI / 2, 12);
  });

  it('угол в вершине полилинии (как в митринге): прямой ход — 0, разворот назад — π', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 10, y: 0 };
    expect(angleBetweenLines(p0, p1, p1, { x: 20, y: 0 })).toBe(0);
    expect(angleBetweenLines(p0, p1, p1, { x: 0, y: 0 })).toBeCloseTo(Math.PI, 12);
    // Поворот налево на 90° и направо на 90° — π/2 с разных сторон полного круга.
    expect(angleBetweenLines(p0, p1, p1, { x: 10, y: 10 })).toBeCloseTo(Math.PI / 2, 12);
    expect(angleBetweenLines(p0, p1, p1, { x: 10, y: -10 })).toBeCloseTo((3 * Math.PI) / 2, 12);
  });

  it('NaN во входе — NaN (валидацию делает команда фасада)', () => {
    expect(angleBetweenLines({ x: Number.NaN, y: 0 }, RIGHT, O, UP)).toBeNaN();
  });

  it('property: всегда в [0, 2π) и не NaN для конечных входов', () => {
    fc.assert(
      fc.property(arbPoint, arbPoint, arbPoint, arbPoint, (a, b, c, d) => {
        const angle = angleBetweenLines(a, b, c, d);
        expect(Number.isNaN(angle)).toBe(false);
        expect(angle).toBeGreaterThanOrEqual(0);
        expect(angle).toBeLessThan(2 * Math.PI);
      }),
      fcParams,
    );
  });
});

describe('parallelLines', () => {
  it('PARALLEL_EPS = 0.05 рад (ADR 0017 C3)', () => {
    expect(PARALLEL_EPS).toBe(0.05);
  });

  it('сонаправленные и противонаправленные — параллельны; перпендикулярные — нет', () => {
    expect(parallelLines(O, RIGHT, O, { x: 5, y: 0 })).toBe(true);
    expect(parallelLines(O, RIGHT, O, LEFT)).toBe(true);
    expect(parallelLines(O, RIGHT, O, UP)).toBe(false);
  });

  const rotated = (angle: number) => ({ x: 10 * Math.cos(angle), y: 10 * Math.sin(angle) });

  it('порог по обе стороны от 0, π и 2π: 0.049 — да, 0.051 — нет (в обе стороны поворота)', () => {
    expect(parallelLines(O, RIGHT, O, rotated(0.049))).toBe(true);
    expect(parallelLines(O, RIGHT, O, rotated(-0.049))).toBe(true);
    expect(parallelLines(O, RIGHT, O, rotated(0.051))).toBe(false);
    expect(parallelLines(O, RIGHT, O, rotated(-0.051))).toBe(false);
    expect(parallelLines(O, RIGHT, O, rotated(Math.PI + 0.049))).toBe(true);
    expect(parallelLines(O, RIGHT, O, rotated(Math.PI - 0.049))).toBe(true);
    expect(parallelLines(O, RIGHT, O, rotated(Math.PI + 0.051))).toBe(false);
    expect(parallelLines(O, RIGHT, O, rotated(Math.PI - 0.051))).toBe(false);
  });

  it('NaN во входе — false, не «параллельны»', () => {
    expect(parallelLines({ x: Number.NaN, y: 0 }, RIGHT, O, UP)).toBe(false);
  });

  it('свой maxAngle', () => {
    expect(parallelLines(O, RIGHT, O, rotated(0.2), 0.3)).toBe(true);
    expect(parallelLines(O, RIGHT, O, rotated(0.2), 0.1)).toBe(false);
  });

  it('property: отрезок параллелен себе и своему развороту', () => {
    fc.assert(
      fc.property(arbPoint, arbPoint, (a, b) => {
        fc.pre(euclDist(a, b) > 1);
        expect(parallelLines(a, b, a, b)).toBe(true);
        expect(parallelLines(a, b, b, a)).toBe(true);
      }),
      fcParams,
    );
  });
});
