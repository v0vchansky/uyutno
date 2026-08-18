import * as fc from 'fast-check';

import { arbPoint, fcParams } from '../testing/arbitraries';
import { B_EPS, pointOnSegment } from './pointOnSegment';

describe('pointOnSegment', () => {
  const A = { x: 0, y: 0 };
  const B = { x: 100, y: 0 };

  it('B_EPS = 1e-4 (ADR 0017 C3)', () => {
    expect(B_EPS).toBe(1e-4);
  });

  it('внутренняя точка и концы — true', () => {
    expect(pointOnSegment({ x: 50, y: 0 }, A, B)).toBe(true);
    expect(pointOnSegment(A, A, B)).toBe(true);
    expect(pointOnSegment(B, A, B)).toBe(true);
  });

  it('поперечный коридор: чуть меньше B_EPS — true, ровно B_EPS — false', () => {
    expect(pointOnSegment({ x: 50, y: B_EPS * 0.99 }, A, B)).toBe(true);
    expect(pointOnSegment({ x: 50, y: -B_EPS * 0.99 }, A, B)).toBe(true);
    expect(pointOnSegment({ x: 50, y: B_EPS }, A, B)).toBe(false);
  });

  it('продольный коридор: за концом в пределах B_EPS — true, дальше — false (изотропно, не bbox)', () => {
    expect(pointOnSegment({ x: -B_EPS * 0.99, y: 0 }, A, B)).toBe(true);
    expect(pointOnSegment({ x: 100 + B_EPS * 0.99, y: 0 }, A, B)).toBe(true);
    expect(pointOnSegment({ x: -B_EPS * 1.01, y: 0 }, A, B)).toBe(false);
    expect(pointOnSegment({ x: 100 + B_EPS * 1.01, y: 0 }, A, B)).toBe(false);
  });

  it('точка на продолжении прямой далеко за концом — false (это не «на прямой»)', () => {
    expect(pointOnSegment({ x: 200, y: 0 }, A, B)).toBe(false);
  });

  it('наклонный отрезок и отрицательные координаты', () => {
    const P = { x: -10, y: -10 };
    const Q = { x: -20, y: -30 };
    expect(pointOnSegment({ x: -15, y: -20 }, P, Q)).toBe(true);
    expect(pointOnSegment({ x: -15, y: -20.001 }, P, Q)).toBe(false);
  });

  it('свой accuracy (грубый допуск 1 см)', () => {
    expect(pointOnSegment({ x: 50, y: 0.9 }, A, B, 1)).toBe(true);
    expect(pointOnSegment({ x: 50, y: 1 }, A, B, 1)).toBe(false);
  });

  it('вырожденный отрезок (a == b): близость к a в пределах accuracy', () => {
    expect(pointOnSegment({ x: 0.5e-4, y: 0 }, A, A)).toBe(true);
    expect(pointOnSegment({ x: 1, y: 0 }, A, A)).toBe(false);
  });

  it('NaN во входе — false, не исключение', () => {
    expect(pointOnSegment({ x: Number.NaN, y: 0 }, A, B)).toBe(false);
    expect(pointOnSegment({ x: 1, y: 0 }, { x: Number.NaN, y: 0 }, B)).toBe(false);
  });

  it('property: концы отрезка и его середина всегда на нём', () => {
    fc.assert(
      fc.property(arbPoint, arbPoint, (a, b) => {
        expect(pointOnSegment(a, a, b)).toBe(true);
        expect(pointOnSegment(b, a, b)).toBe(true);
        expect(pointOnSegment({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, a, b)).toBe(true);
      }),
      fcParams,
    );
  });
});
