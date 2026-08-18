import * as fc from 'fast-check';

import { arbPoint, fcParams } from '../testing/arbitraries';
import { distanceToLine } from './distanceToLine';
import { euclDist } from './distance';
import { projectPointOnLine } from './projectPointOnLine';

describe('projectPointOnLine', () => {
  const A = { x: 0, y: 0 };
  const B = { x: 10, y: 0 };

  it('проекция внутрь отрезка', () => {
    expect(projectPointOnLine({ x: 3, y: 7 }, A, B)).toEqual({ x: 3, y: 0 });
    expect(projectPointOnLine({ x: 3, y: -7 }, A, B)).toEqual({ x: 3, y: 0 });
  });

  it('asSegment (дефолт): проекция за концом → null; asSegment: false — на прямой', () => {
    expect(projectPointOnLine({ x: 12, y: 1 }, A, B)).toBeNull();
    expect(projectPointOnLine({ x: 12, y: 1 }, A, B, { asSegment: false })).toEqual({ x: 12, y: 0 });
    expect(projectPointOnLine({ x: -1, y: 1 }, A, B, { asSegment: false })).toEqual({ x: -1, y: 0 });
  });

  it('vertices: false — проекция в конец отрезка отбраковывается', () => {
    expect(projectPointOnLine({ x: 10, y: 3 }, A, B)).toEqual({ x: 10, y: 0 });
    expect(projectPointOnLine({ x: 10, y: 3 }, A, B, { vertices: false })).toBeNull();
    expect(projectPointOnLine({ x: 0, y: 3 }, A, B, { vertices: false })).toBeNull();
    expect(projectPointOnLine({ x: 5, y: 3 }, A, B, { vertices: false })).toEqual({ x: 5, y: 0 });
  });

  it('честная формула на почти горизонтальной прямой (без хака px = point.x референса)', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1000, y: 1e-5 };
    const p = { x: 500, y: 100 };
    const q = projectPointOnLine(p, a, b, { asSegment: false })!;
    // Основание перпендикуляра лежит на прямой и ортогонально ей.
    expect(distanceToLine(q, a, b)).toBeLessThan(1e-9);
    const dot = (q.x - p.x) * (b.x - a.x) + (q.y - p.y) * (b.y - a.y);
    expect(Math.abs(dot)).toBeLessThan(1e-6);
    // Хак дал бы q.x = 500 ровно; честная проекция сдвигает основание вдоль прямой на ~1e-3.
    expect(q.x).not.toBe(500);
  });

  it('наклонный отрезок и отрицательные координаты', () => {
    const q = projectPointOnLine({ x: 0, y: 2 }, { x: -1, y: -1 }, { x: 1, y: 1 })!;
    expect(q.x).toBeCloseTo(1, 12);
    expect(q.y).toBeCloseTo(1, 12);
  });

  it('вырожденная прямая (a == b) → null; NaN → null', () => {
    expect(projectPointOnLine({ x: 1, y: 1 }, A, A)).toBeNull();
    expect(projectPointOnLine({ x: Number.NaN, y: 1 }, A, B)).toBeNull();
  });

  it('property: проекция на прямую лежит на ней и не дальше точки от любой точки прямой', () => {
    fc.assert(
      fc.property(arbPoint, arbPoint, arbPoint, (p, a, b) => {
        fc.pre(euclDist(a, b) > 1);
        const q = projectPointOnLine(p, a, b, { asSegment: false })!;
        expect(q).not.toBeNull();
        expect(distanceToLine(q, a, b)).toBeLessThan(1e-6);
        expect(euclDist(p, q)).toBeLessThanOrEqual(euclDist(p, a) + 1e-6);
      }),
      fcParams,
    );
  });
});
