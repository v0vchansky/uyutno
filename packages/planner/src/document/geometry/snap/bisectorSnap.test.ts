import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { bisectorPoint } from '../predicates/bisectorPoint';
import { manhDist } from '../predicates/distance';
import { distanceToLine } from '../predicates/distanceToLine';
import { arbQuantizedPoint, fcParams } from '../testing/arbitraries';
import { BISECTOR_SEARCH_FACTOR, bisectorSnap } from './bisectorSnap';
import type { SnapCandidate } from './candidates';

const p = (x: number, y: number): PlanPosition => ({ x, y });
const c = (id: string, x: number, y: number, prev?: PlanPosition, next?: PlanPosition): SnapCandidate => {
  const candidate: SnapCandidate = { id, x, y };
  if (prev) candidate.prev = prev;
  if (next) candidate.next = next;
  return candidate;
};
const NONE: ReadonlySet<string> = new Set();
const SNAP = 10;

/** Угол в (0,0): prev (100,0), next (0,100) → биссектриса вдоль (1,1). */
const corner = c('corner', 0, 0, p(100, 0), p(0, 100));

describe('bisectorSnap', () => {
  it('BISECTOR_SEARCH_FACTOR = 10', () => {
    expect(BISECTOR_SEARCH_FACTOR).toBe(10);
  });

  it('обычный случай: курсор на биссектрисе → anchor и direction вдоль (1,1)', () => {
    const result = bisectorSnap(p(30, 30), [corner], SNAP, NONE);
    expect(result).not.toBeNull();
    expect(result!.anchor).toBe(corner);
    expect(result!.direction.x).toBeCloseTo(0.5, 12);
    expect(result!.direction.y).toBeCloseTo(0.5, 12);
    expect(result!.direction).toEqual(bisectorPoint(corner, corner.prev!, corner.next!));
  });

  it('угол ищется в радиусе 10·snapDist по манхэттену: ровно 10·snapDist — да, чуть дальше — нет', () => {
    // (50, 50): манхэттен до вершины 100 = 10·SNAP, лежит на биссектрисе.
    expect(bisectorSnap(p(50, 50), [corner], SNAP, NONE)?.anchor).toBe(corner);
    expect(bisectorSnap(p(50.0005, 50.0005), [corner], SNAP, NONE)).toBeNull();
    // Евклид тут ≈ 70.7 < 100, но метрика поиска — манхэттен: (60, 60) → 120 > 100.
    expect(bisectorSnap(p(60, 60), [corner], SNAP, NONE)).toBeNull();
  });

  it('кандидат без prev/next → null (осиротевшая вершина, конец полилинии)', () => {
    expect(bisectorSnap(p(30, 30), [c('lone', 0, 0)], SNAP, NONE)).toBeNull();
    expect(bisectorSnap(p(30, 30), [c('onlyPrev', 0, 0, p(100, 0))], SNAP, NONE)).toBeNull();
    expect(bisectorSnap(p(30, 30), [c('onlyNext', 0, 0, undefined, p(0, 100))], SNAP, NONE)).toBeNull();
  });

  it('ближайший кандидат без соседей перекрывает более далёкий угол (берётся ближайший, а не ближайший с соседями)', () => {
    const lone = c('lone', 29, 29);
    expect(bisectorSnap(p(30, 30), [corner, lone], SNAP, NONE)).toBeNull();
    expect(bisectorSnap(p(30, 30), [lone, corner], SNAP, NONE)).toBeNull();
  });

  it('развёрнутый угол (prev/next на одной прямой через вершину) → null', () => {
    const straight = c('straight', 0, 0, p(100, 0), p(-100, 0));
    expect(bisectorSnap(p(1, 1), [straight], SNAP, NONE)).toBeNull();
  });

  it('вырожденный луч (prev совпадает с вершиной) → null', () => {
    const degenerate = c('deg', 0, 0, p(0, 0), p(0, 100));
    expect(bisectorSnap(p(1, 1), [degenerate], SNAP, NONE)).toBeNull();
  });

  it('перпендикулярное евклидово расстояние до биссектрисы: ≈ snapDist принимается, чуть больше — null', () => {
    // Курсор (50, 50 − d): расстояние до прямой y = x равно d/√2, манхэттен до вершины 100 − d ≤ 10·SNAP.
    const exact = SNAP * Math.SQRT2;
    const below = exact * (1 - 1e-12);
    const above = exact * (1 + 1e-12);
    expect(distanceToLine(p(50, 50 - below), corner, p(0.5, 0.5))).toBeLessThanOrEqual(SNAP);
    expect(distanceToLine(p(50, 50 - above), corner, p(0.5, 0.5))).toBeGreaterThan(SNAP);
    expect(bisectorSnap(p(50, 50 - below), [corner], SNAP, NONE)?.anchor).toBe(corner);
    expect(bisectorSnap(p(50, 50 - above), [corner], SNAP, NONE)).toBeNull();
    // Курсор (50, 50 + d) — по другую сторону прямой; манхэттен 100 + d > 10·SNAP — угол вообще не найден.
    expect(manhDist(p(50, 50 + below), corner)).toBeGreaterThan(SNAP * BISECTOR_SEARCH_FACTOR);
    expect(bisectorSnap(p(50, 50 + below), [corner], SNAP, NONE)).toBeNull();
    // Ближе к вершине — (20, 20 + d), манхэттен 40 + d < 100: обе стороны прямой симметричны.
    expect(bisectorSnap(p(20, 20 + below), [corner], SNAP, NONE)?.anchor).toBe(corner);
    expect(bisectorSnap(p(20, 20 + above), [corner], SNAP, NONE)).toBeNull();
    expect(bisectorSnap(p(20, 20 - below), [corner], SNAP, NONE)?.anchor).toBe(corner);
    expect(bisectorSnap(p(20, 20 - above), [corner], SNAP, NONE)).toBeNull();
    expect(bisectorSnap(p(20, 20 + 2 * exact), [corner], SNAP, NONE)).toBeNull();
  });

  it('расстояние ровно snapDist — принимается (граница включительно, ось-выровненная биссектриса)', () => {
    // Угол в (0,0): prev (100, 100), next (100, −100) → биссектриса вдоль +x, прямая y = 0.
    const axisCorner = c('axis', 0, 0, p(100, 100), p(100, -100));
    const distance = distanceToLine(
      p(30, SNAP),
      axisCorner,
      bisectorPoint(axisCorner, axisCorner.prev!, axisCorner.next!)!,
    );
    expect(distance).toBe(SNAP);
    expect(bisectorSnap(p(30, SNAP), [axisCorner], SNAP, NONE)?.anchor).toBe(axisCorner);
    expect(bisectorSnap(p(30, -SNAP), [axisCorner], SNAP, NONE)?.anchor).toBe(axisCorner);
    expect(bisectorSnap(p(30, SNAP + 1e-6), [axisCorner], SNAP, NONE)).toBeNull();
    expect(bisectorSnap(p(30, -SNAP - 1e-6), [axisCorner], SNAP, NONE)).toBeNull();
    expect(bisectorSnap(p(30, SNAP * 0.99), [axisCorner], SNAP, NONE)?.anchor).toBe(axisCorner);
    expect(bisectorSnap(p(30, -SNAP * 0.99), [axisCorner], SNAP, NONE)?.anchor).toBe(axisCorner);
  });

  it('exceptIds исключает вершину → null; при другом угле в радиусе — он', () => {
    expect(bisectorSnap(p(30, 30), [corner], SNAP, new Set(['corner']))).toBeNull();
    const other = c('other', 60, 60, p(160, 60), p(60, 160));
    const result = bisectorSnap(p(30, 30), [corner, other], SNAP, new Set(['corner']));
    expect(result?.anchor).toBe(other);
  });

  it('пустой список → null; NaN в курсоре → null', () => {
    expect(bisectorSnap(p(0, 0), [], SNAP, NONE)).toBeNull();
    expect(bisectorSnap(p(Number.NaN, 0), [corner], SNAP, NONE)).toBeNull();
  });

  it('property: результат — ближайший по манхэттену кандидат в 10·snapDist, с соседями, и курсор в snapDist от прямой', () => {
    const arbCandidates = fc
      .array(
        fc.record({ at: arbQuantizedPoint, prev: arbQuantizedPoint, next: arbQuantizedPoint, hasRing: fc.boolean() }),
        { maxLength: 8 },
      )
      .map(list =>
        list.map(({ at, prev, next, hasRing }, i) =>
          hasRing ? c(`c${i}`, at.x, at.y, prev, next) : c(`c${i}`, at.x, at.y),
        ),
      );
    fc.assert(
      fc.property(
        arbQuantizedPoint,
        arbCandidates,
        fc.integer({ min: 1, max: 500 }),
        (cursor, candidates, snapDist) => {
          const result = bisectorSnap(cursor, candidates, snapDist, NONE);
          if (!result) return;
          const { anchor, direction } = result;
          expect(candidates).toContain(anchor);
          expect(anchor.prev).toBeDefined();
          expect(anchor.next).toBeDefined();
          expect(manhDist(cursor, anchor)).toBeLessThanOrEqual(snapDist * BISECTOR_SEARCH_FACTOR);
          candidates.forEach(other => expect(manhDist(cursor, other)).toBeGreaterThanOrEqual(manhDist(cursor, anchor)));
          expect(distanceToLine(cursor, anchor, direction)).toBeLessThanOrEqual(snapDist);
          expect(direction).toEqual(bisectorPoint(anchor, anchor.prev!, anchor.next!));
        },
      ),
      fcParams,
    );
  });
});
