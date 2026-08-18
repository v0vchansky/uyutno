import { pointInBounds } from './pointInBounds';
import { L_EPS } from './pointsMatch';

describe('pointInBounds', () => {
  const A = { x: 0, y: 0 };
  const B = { x: 10, y: 5 };

  it('внутри bbox, на границе и в углах — true; порядок концов любой', () => {
    expect(pointInBounds({ x: 5, y: 2 }, A, B)).toBe(true);
    expect(pointInBounds({ x: 10, y: 0 }, A, B)).toBe(true);
    expect(pointInBounds({ x: 5, y: 2 }, B, A)).toBe(true);
    expect(pointInBounds(A, B, A)).toBe(true);
  });

  it('снаружи по x или по y — false', () => {
    expect(pointInBounds({ x: 11, y: 2 }, A, B)).toBe(false);
    expect(pointInBounds({ x: 5, y: -1 }, A, B)).toBe(false);
  });

  it('слак L_EPS включительно: ровно на слаке — true, дальше — false', () => {
    expect(pointInBounds({ x: 10 + L_EPS, y: 2 }, A, B)).toBe(true);
    expect(pointInBounds({ x: 10 + L_EPS * 2, y: 2 }, A, B)).toBe(false);
    expect(pointInBounds({ x: -L_EPS, y: 2 }, A, B)).toBe(true);
    expect(pointInBounds({ x: -L_EPS * 2, y: 2 }, A, B)).toBe(false);
  });

  it('свой accuracy; вырожденный bbox (a == b) — только сама точка (со слаком)', () => {
    expect(pointInBounds({ x: 12, y: 2 }, A, B, 2)).toBe(true);
    expect(pointInBounds({ x: 0, y: 0 }, A, A)).toBe(true);
    expect(pointInBounds({ x: 0.001, y: 0 }, A, A)).toBe(false);
  });

  it('отрицательные координаты; NaN — false', () => {
    expect(pointInBounds({ x: -5, y: -5 }, { x: -10, y: -10 }, { x: 0, y: 0 })).toBe(true);
    expect(pointInBounds({ x: Number.NaN, y: 0 }, A, B)).toBe(false);
  });
});
