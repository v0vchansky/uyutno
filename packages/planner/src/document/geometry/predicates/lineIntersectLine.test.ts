import * as fc from 'fast-check';

import { arbPoint, fcParams } from '../testing/arbitraries';
import { euclDist } from './distance';
import { distanceToLine } from './distanceToLine';
import { lineIntersectLine } from './lineIntersectLine';
import { pointOnSegment } from './pointOnSegment';

describe('lineIntersectLine', () => {
  const A = { x: 0, y: 0 };
  const B = { x: 10, y: 0 };

  it('крест отрезков — точка пересечения', () => {
    expect(lineIntersectLine(A, B, { x: 5, y: -5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 0 });
    expect(lineIntersectLine({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toEqual({
      x: 5,
      y: 5,
    });
  });

  it('asSegment (дефолт): пересечение прямых вне отрезков → null; asSegment: false — прямые', () => {
    const e = { x: 20, y: -5 };
    const f = { x: 20, y: 5 };
    expect(lineIntersectLine(A, B, e, f)).toBeNull();
    expect(lineIntersectLine(A, B, e, f, { asSegment: false })).toEqual({ x: 20, y: 0 });
    // Пересечение на прямой второго, но за пределами первого отрезка.
    expect(lineIntersectLine(A, B, { x: 12, y: -1 }, { x: 12, y: 1 })).toBeNull();
  });

  it('параллельные и коллинеарные → null (в т.ч. как прямые); вырожденный отрезок → null', () => {
    expect(lineIntersectLine(A, B, { x: 0, y: 1 }, { x: 10, y: 1 })).toBeNull();
    expect(lineIntersectLine(A, B, { x: 0, y: 1 }, { x: 10, y: 1 }, { asSegment: false })).toBeNull();
    expect(lineIntersectLine(A, B, { x: 5, y: 0 }, { x: 15, y: 0 })).toBeNull();
    expect(lineIntersectLine(A, A, { x: 0, y: -1 }, { x: 0, y: 1 })).toBeNull();
    expect(lineIntersectLine(A, B, { x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });

  it('снап к общим вершинам: общая вершина возвращается бит-в-бит (тот же объект)', () => {
    const shared = { x: 10, y: 0 };
    const other = { x: 10 + 1e-9, y: 5 };
    // `B` совпадает с `E` в L_EPS → результат — сам `B`, без пересчёта.
    expect(lineIntersectLine(A, shared, shared, other)).toBe(shared);
    expect(lineIntersectLine(A, shared, other, shared)).toBe(shared);
    // Совпадение `A` с концом второго → сам `A`.
    expect(lineIntersectLine(A, B, { x: 0, y: 5 }, A)).toBe(A);
    // Оба совпали — приоритет у `B` (как у референса).
    expect(lineIntersectLine(A, B, B, A)).toBeNull(); // но коллинеарные → null раньше снапа
    expect(lineIntersectLine(A, B, { x: 0, y: 5 }, B)).toBe(B);
  });

  it('vertices: false — пересечение в вершине (T-стык, общая вершина) отбраковывается', () => {
    expect(lineIntersectLine(A, B, { x: 5, y: 0 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 0 });
    expect(lineIntersectLine(A, B, { x: 5, y: 0 }, { x: 5, y: 5 }, { vertices: false })).toBeNull();
    expect(lineIntersectLine(A, B, B, { x: 10, y: 5 }, { vertices: false })).toBeNull();
    expect(lineIntersectLine(A, B, { x: 5, y: -5 }, { x: 5, y: 5 }, { vertices: false })).toEqual({ x: 5, y: 0 });
  });

  it('T-стык без слака: конец точно на отрезке (u = 0 через orient2d) — есть; на 1e-9 мимо — нет', () => {
    expect(lineIntersectLine(A, B, { x: 5, y: 0 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 0 });
    expect(lineIntersectLine(A, B, { x: 5, y: 1e-9 }, { x: 5, y: 5 })).toBeNull();
  });

  it('accuracy — слак принадлежности вдоль отрезков в см (параметрический, изотропный)', () => {
    const e = { x: 10.5, y: -5 };
    const f = { x: 10.5, y: 5 };
    expect(lineIntersectLine(A, B, e, f)).toBeNull();
    expect(lineIntersectLine(A, B, e, f, { accuracy: 0.4 })).toBeNull();
    expect(lineIntersectLine(A, B, e, f, { accuracy: 0.6 })).toEqual({ x: 10.5, y: 0 });
    // Слак действует и на второй отрезок: пересечение чуть выше его конца.
    expect(lineIntersectLine(A, B, { x: 5, y: -5 }, { x: 5, y: -0.3 }, { accuracy: 0.5 })).toEqual({ x: 5, y: 0 });
    expect(lineIntersectLine(A, B, { x: 5, y: -5 }, { x: 5, y: -0.6 }, { accuracy: 0.5 })).toBeNull();
  });

  it('наклонные отрезки и отрицательные координаты — точность', () => {
    const p = lineIntersectLine({ x: -10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }, { x: 10, y: -10 })!;
    expect(p.x).toBeCloseTo(0, 12);
    expect(p.y).toBeCloseTo(0, 12);
    const q = lineIntersectLine({ x: 1, y: 1 }, { x: 4, y: 7 }, { x: 1, y: 7 }, { x: 4, y: 1 })!;
    expect(q.x).toBeCloseTo(2.5, 12);
    expect(q.y).toBeCloseTo(4, 12);
  });

  it('NaN во входе → null, не исключение', () => {
    expect(lineIntersectLine({ x: Number.NaN, y: 0 }, B, { x: 5, y: -5 }, { x: 5, y: 5 })).toBeNull();
  });

  it('property: результат как отрезков лежит на обоих отрезках (B_EPS), как прямых — на обеих прямых', () => {
    fc.assert(
      fc.property(arbPoint, arbPoint, arbPoint, arbPoint, (a, b, e, f) => {
        fc.pre(euclDist(a, b) > 1 && euclDist(e, f) > 1);
        // Почти параллельные пары исключаем: там точка пересечения плохо обусловлена (как и у референса).
        const sine = ((b.x - a.x) * (f.y - e.y) - (b.y - a.y) * (f.x - e.x)) / (euclDist(a, b) * euclDist(e, f));
        fc.pre(Math.abs(sine) > 1e-3);
        const asLines = lineIntersectLine(a, b, e, f, { asSegment: false })!;
        expect(asLines).not.toBeNull();
        expect(distanceToLine(asLines, a, b)).toBeLessThan(1e-3);
        expect(distanceToLine(asLines, e, f)).toBeLessThan(1e-3);
        const asSegments = lineIntersectLine(a, b, e, f);
        if (asSegments) {
          expect(Number.isNaN(asSegments.x) || Number.isNaN(asSegments.y)).toBe(false);
          // Пересечение отрезков лежит на обоих — с допуском на float при очень острых углах.
          const tolerance = 1e-3;
          expect(pointOnSegment(asSegments, a, b, tolerance)).toBe(true);
          expect(pointOnSegment(asSegments, e, f, tolerance)).toBe(true);
        }
      }),
      fcParams,
    );
  });
});
