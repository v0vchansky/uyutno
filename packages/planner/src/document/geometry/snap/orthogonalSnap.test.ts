import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import type { Bounds } from '../predicates/findMinMax';
import { arbQuantizedPoint, fcParams } from '../testing/arbitraries';
import { NO_ALIGNERS } from './candidates';
import { ORTHO_FIRST_ID, ORTHO_LAST_ID, orthogonalSnap } from './orthogonalSnap';

const p = (x: number, y: number): PlanPosition => ({ x, y });
const SNAP = 10;
const WIDE: Bounds = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };

describe('orthogonalSnap', () => {
  it('константы id якорей', () => {
    expect(ORTHO_LAST_ID).toBe('ortho:last');
    expect(ORTHO_FIRST_ID).toBe('ortho:first');
  });

  it('пустой контур → point null, пары пусты', () => {
    const result = orthogonalSnap(p(0, 0), [], SNAP, WIDE);
    expect(result.point).toBeNull();
    expect(result.alignerX).toBeNull();
    expect(result.alignerY).toBeNull();
    expect(result.rawAlignersX).toBe(NO_ALIGNERS);
    expect(result.rawAlignersY).toBe(NO_ALIGNERS);
  });

  it('одна точка → лок к ней по x (id ortho:first)', () => {
    const result = orthogonalSnap(p(3, 100), [p(0, 0)], SNAP, WIDE);
    expect(result.point).toEqual({ x: 0, y: 100 });
    expect(result.alignerX?.id).toBe(ORTHO_FIRST_ID);
    expect(result.alignerY).toBeNull();
  });

  it('одна точка → лок к ней по y (id ortho:first)', () => {
    const result = orthogonalSnap(p(100, 3), [p(0, 0)], SNAP, WIDE);
    expect(result.point).toEqual({ x: 100, y: 0 });
    expect(result.alignerY?.id).toBe(ORTHO_FIRST_ID);
    expect(result.alignerX).toBeNull();
  });

  it('одна точка → якорь ortho:last не создаётся', () => {
    const result = orthogonalSnap(p(3, 4), [p(0, 0)], SNAP, WIDE);
    expect(result.rawAlignersX.map(a => a?.id)).not.toContain(ORTHO_LAST_ID);
    expect(result.rawAlignersY.map(a => a?.id)).not.toContain(ORTHO_LAST_ID);
    expect(result.point).toEqual({ x: 0, y: 0 });
  });

  it('две+ точки: якоря — последняя (ortho:last) и первая (ortho:first), координаты скопированы', () => {
    const contour = [p(0, 0), p(50, 0), p(50, 50)];
    // Курсор близко по x к последней (50) и по y к первой (0).
    const result = orthogonalSnap(p(53, 3), contour, SNAP, WIDE);
    expect(result.point).toEqual({ x: 50, y: 0 });
    expect(result.alignerX?.id).toBe(ORTHO_LAST_ID);
    expect(result.alignerX).toMatchObject({ x: 50, y: 50 });
    expect(result.alignerY?.id).toBe(ORTHO_FIRST_ID);
    expect(result.alignerY).toMatchObject({ x: 0, y: 0 });
    expect(result.alignerX).not.toBe(contour[2]);
  });

  it('две+ точки: середина контура якорем не является', () => {
    const contour = [p(0, 0), p(200, 200), p(400, 0)];
    // Курсор рядом только с серединой (200, 200) — лока нет.
    expect(orthogonalSnap(p(203, 203), contour, SNAP, WIDE).point).toBeNull();
  });

  it('две точки: лок к последней и к первой одновременно', () => {
    const contour = [p(0, 0), p(100, 200)];
    const result = orthogonalSnap(p(97, 3), contour, SNAP, WIDE);
    expect(result.point).toEqual({ x: 100, y: 0 });
    expect(result.alignerX?.id).toBe(ORTHO_LAST_ID);
    expect(result.alignerY?.id).toBe(ORTHO_FIRST_ID);
  });

  it('порог snapDist по обе стороны (ровно — берётся, чуть дальше — нет)', () => {
    expect(orthogonalSnap(p(SNAP, 100), [p(0, 0)], SNAP, WIDE).point).toEqual({ x: 0, y: 100 });
    expect(orthogonalSnap(p(SNAP + 1e-9, 100), [p(0, 0)], SNAP, WIDE).point).toBeNull();
    expect(orthogonalSnap(p(100, -SNAP), [p(0, 0)], SNAP, WIDE).point).toEqual({ x: 100, y: 0 });
    expect(orthogonalSnap(p(100, -SNAP - 1e-9), [p(0, 0)], SNAP, WIDE).point).toBeNull();
  });

  it('якорь вне bounds куллится: первая вне → лок только к последней', () => {
    const contour = [p(-500, 0), p(50, 50)];
    const bounds: Bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    const result = orthogonalSnap(p(53, 3), contour, SNAP, bounds);
    // По y первая (y = 0) не участвует — она вне кадра; по x последняя (x = 50) — в кадре.
    expect(result.point).toEqual({ x: 50, y: 3 });
    expect(result.alignerX?.id).toBe(ORTHO_LAST_ID);
    expect(result.alignerY).toBeNull();
  });

  it('якорь на границе bounds — виден (включительно)', () => {
    const bounds: Bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    expect(orthogonalSnap(p(3, 50), [p(0, 0)], SNAP, bounds).point).toEqual({ x: 0, y: 50 });
  });

  it('оба якоря вне bounds → point null', () => {
    const contour = [p(-500, 0), p(500, 50)];
    const bounds: Bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    const result = orthogonalSnap(p(-497, 3), contour, SNAP, bounds);
    expect(result.point).toBeNull();
    expect(result.rawAlignersX).toBe(NO_ALIGNERS);
  });

  it('NaN в обеих координатах курсора → point null', () => {
    expect(orthogonalSnap(p(Number.NaN, Number.NaN), [p(0, 0)], SNAP, WIDE).point).toBeNull();
  });

  it('NaN в одной координате курсора → point null (другая ось тоже не выравнивается)', () => {
    expect(orthogonalSnap(p(Number.NaN, 0), [p(0, 0)], SNAP, WIDE).point).toBeNull();
  });

  it('property: результат меняет курсор только к координатам первой/последней точки', () => {
    fc.assert(
      fc.property(
        arbQuantizedPoint,
        fc.array(arbQuantizedPoint, { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 500 }),
        (cursor, contour, snapDist) => {
          const result = orthogonalSnap(cursor, contour, snapDist, WIDE);
          const first = contour[0]!;
          const last = contour[contour.length - 1]!;
          if (result.point) {
            expect([cursor.x, first.x, last.x]).toContain(result.point.x);
            expect([cursor.y, first.y, last.y]).toContain(result.point.y);
            if (result.alignerX) expect(Math.abs(result.alignerX.x - cursor.x)).toBeLessThanOrEqual(snapDist);
            if (result.alignerY) expect(Math.abs(result.alignerY.y - cursor.y)).toBeLessThanOrEqual(snapDist);
          } else {
            expect(result.alignerX).toBeNull();
            expect(result.alignerY).toBeNull();
          }
        },
      ),
      fcParams,
    );
  });
});
