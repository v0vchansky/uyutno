import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { manhDist } from '../predicates/distance';
import { B_EPS } from '../predicates/pointOnSegment';
import { L_EPS } from '../predicates/pointsMatch';
import { arbQuantizedPoint, fcParams } from '../testing/arbitraries';
import { NO_ALIGNERS, type AlignerPair, type SnapCandidate } from './candidates';
import { type Axis, pickAligner, snapAxis, snapPerpendicular, snapX, snapY } from './snapAxis';

const c = (id: string, x: number, y: number): SnapCandidate => ({ id, x, y });
const NONE: ReadonlySet<string> = new Set();
const O: PlanPosition = { x: 0, y: 0 };
const SNAP = 10;

const ids = (pair: AlignerPair): (string | null)[] => pair.map(aligner => (aligner ? aligner.id : null));

describe('snapX', () => {
  it('обычный случай: вертикаль через кандидата в snapDist, полуплоскость по y', () => {
    // Q.y = 5 ≥ P.y = 0 → сторона P; M пуста.
    expect(ids(snapX(O, [c('a', 3, 5)], SNAP, NONE))).toEqual([null, 'a']);
    // Q.y = −5 < 0 → сторона M.
    expect(ids(snapX(O, [c('a', 3, -5)], SNAP, NONE))).toEqual(['a', null]);
  });

  it('равенство Q.y = P.y — сторона P (не M)', () => {
    expect(ids(snapX(O, [c('a', 3, 0)], SNAP, NONE))).toEqual([null, 'a']);
  });

  it('обе стороны заняты кандидатами на одной вертикали → пара [M, P]', () => {
    const m = c('m', 3, -5);
    const p = c('p', 3, 5);
    const pair = snapX(O, [p, m], SNAP, NONE);
    expect(pair[0]).toBe(m);
    expect(pair[1]).toBe(p);
  });

  it('первичный ключ dx: меньшая dx побеждает, даже если дальше вдоль оси', () => {
    const closeDx = c('closeDx', 3, 100);
    const closeAlong = c('closeAlong', 4, 1);
    expect(snapX(O, [closeAlong, closeDx], SNAP, NONE)[1]).toBe(closeDx);
    expect(snapX(O, [closeDx, closeAlong], SNAP, NONE)[1]).toBe(closeDx);
  });

  it('одна вертикаль (dx равны в пределах L_EPS): побеждает ближайшая вдоль оси, независимо от порядка', () => {
    const far = c('far', 3, 20);
    const near = c('near', 3 + 0.5 * L_EPS, 5);
    expect(snapX(O, [far, near], SNAP, NONE)[1]).toBe(near);
    expect(snapX(O, [near, far], SNAP, NONE)[1]).toBe(near);
  });

  it('dx отличаются ровно больше L_EPS: побеждает меньшая dx, даже если дальше вдоль', () => {
    const far = c('far', 3, 20);
    const near = c('near', 3 + 2 * L_EPS, 5);
    expect(snapX(O, [near, far], SNAP, NONE)[1]).toBe(far);
  });

  it('полный tie (dx и sideDist равны) → первый по порядку', () => {
    const a = c('a', 3, 5);
    const b = c('b', -3, 5);
    expect(snapX(O, [a, b], SNAP, NONE)[1]).toBe(a);
    expect(snapX(O, [b, a], SNAP, NONE)[1]).toBe(b);
  });

  it('совпадающие кандидаты (одна точка дважды) → первый', () => {
    const a = c('a', 3, 5);
    const b = c('b', 3, 5);
    expect(snapX(O, [a, b], SNAP, NONE)[1]).toBe(a);
  });

  it('отсечка по оси: ровно snapDist — выживает, snapDist + 1e-9 — нет', () => {
    expect(ids(snapX(O, [c('a', SNAP, 5)], SNAP, NONE))).toEqual([null, 'a']);
    expect(snapX(O, [c('a', SNAP + 1e-9, 5)], SNAP, NONE)).toBe(NO_ALIGNERS);
    expect(ids(snapX(O, [c('a', -SNAP, -5)], SNAP, NONE))).toEqual(['a', null]);
    expect(snapX(O, [c('a', -SNAP - 1e-9, -5)], SNAP, NONE)).toBe(NO_ALIGNERS);
  });

  it('отсечка — по одной координате, не манхэттен: далеко вдоль оси, но близко по dx — выживает', () => {
    expect(ids(snapX(O, [c('a', 1, 5000)], SNAP, NONE))).toEqual([null, 'a']);
  });

  it('взаимное отсечение сторон: dx отличаются на 0.5·B_EPS → обе выживают', () => {
    const m = c('m', 3, -5);
    const p = c('p', 3 + 0.5 * B_EPS, 5);
    expect(ids(snapX(O, [m, p], SNAP, NONE))).toEqual(['m', 'p']);
    const m2 = c('m2', 3 + 0.5 * B_EPS, -5);
    const p2 = c('p2', 3, 5);
    expect(ids(snapX(O, [m2, p2], SNAP, NONE))).toEqual(['m2', 'p2']);
  });

  it('взаимное отсечение сторон: dx отличаются на 2·B_EPS → выживает только ближняя к оси', () => {
    const m = c('m', 3, -5);
    const p = c('p', 3 + 2 * B_EPS, 5);
    expect(ids(snapX(O, [m, p], SNAP, NONE))).toEqual(['m', null]);
    const m2 = c('m2', 3 + 2 * B_EPS, -5);
    const p2 = c('p2', 3, 5);
    expect(ids(snapX(O, [m2, p2], SNAP, NONE))).toEqual([null, 'p2']);
  });

  it('взаимное отсечение: сторона за snapDist не мешает другой стороне выжить', () => {
    const m = c('m', 3, -5);
    const p = c('p', 50, 5);
    expect(ids(snapX(O, [m, p], SNAP, NONE))).toEqual(['m', null]);
  });

  it('пустой список → NO_ALIGNERS (та же ссылка)', () => {
    expect(snapX(O, [], SNAP, NONE)).toBe(NO_ALIGNERS);
  });

  it('все кандидаты за snapDist → NO_ALIGNERS', () => {
    expect(snapX(O, [c('a', 50, 5), c('b', -50, -5)], SNAP, NONE)).toBe(NO_ALIGNERS);
  });

  it('exceptIds: исключённый не участвует, берётся следующий; исключены все → NO_ALIGNERS', () => {
    const best = c('best', 1, 5);
    const other = c('other', 2, 5);
    expect(snapX(O, [best, other], SNAP, new Set(['best']))[1]).toBe(other);
    expect(snapX(O, [best], SNAP, new Set(['best']))).toBe(NO_ALIGNERS);
  });

  it('NaN-кандидат по первичной оси не выбирается и не мешает остальным', () => {
    const ok = c('ok', 3, 5);
    expect(ids(snapX(O, [c('nanX', Number.NaN, 5), ok], SNAP, NONE))).toEqual([null, 'ok']);
    expect(snapX(O, [c('nanX', Number.NaN, 5)], SNAP, NONE)).toBe(NO_ALIGNERS);
  });

  // Без гарда `candidate.y < point.y` ложно → сторона P, `dist < ∞` истинно → кандидат стал бы выравнивателем.
  it('NaN-кандидат по вторичной оси не выбирается', () => {
    const ok = c('ok', 3, 5);
    expect(ids(snapX(O, [c('nanY', 3, Number.NaN), ok], SNAP, NONE))).toEqual([null, 'ok']);
  });

  it('NaN в курсоре по первичной оси → NO_ALIGNERS', () => {
    expect(snapX({ x: Number.NaN, y: 0 }, [c('a', 0, 0)], SNAP, NONE)).toBe(NO_ALIGNERS);
  });

  it('NaN в курсоре по вторичной оси → NO_ALIGNERS', () => {
    expect(snapX({ x: 0, y: Number.NaN }, [c('a', 0, 0)], SNAP, NONE)).toBe(NO_ALIGNERS);
  });
});

describe('snapY', () => {
  it('горизонталь: полуплоскости по x (Q.x < P.x → M, Q.x ≥ P.x → P), отсечка по dy', () => {
    expect(ids(snapY(O, [c('a', -5, 3)], SNAP, NONE))).toEqual(['a', null]);
    expect(ids(snapY(O, [c('a', 5, 3)], SNAP, NONE))).toEqual([null, 'a']);
    expect(ids(snapY(O, [c('a', 0, 3)], SNAP, NONE))).toEqual([null, 'a']);
    expect(ids(snapY(O, [c('a', 5, SNAP)], SNAP, NONE))).toEqual([null, 'a']);
    expect(snapY(O, [c('a', 5, SNAP + 1e-9)], SNAP, NONE)).toBe(NO_ALIGNERS);
  });

  it('первичный ключ dy, вторичный dx', () => {
    const closeDy = c('closeDy', 100, 3);
    const closeAlong = c('closeAlong', 1, 4);
    expect(snapY(O, [closeAlong, closeDy], SNAP, NONE)[1]).toBe(closeDy);
    const near = c('near', 5, 3);
    const far = c('far', 20, 3);
    expect(snapY(O, [far, near], SNAP, NONE)[1]).toBe(near);
  });

  it('snapX/snapY — это snapAxis с осью', () => {
    const candidates = [c('a', 3, -5), c('b', -5, 3)];
    expect(snapY(O, candidates, SNAP, NONE)).toEqual(snapAxis('y', O, candidates, SNAP, NONE));
    expect(snapX(O, candidates, SNAP, NONE)).toEqual(snapAxis('x', O, candidates, SNAP, NONE));
  });
});

describe('snapAxis property', () => {
  const arbCandidates = fc
    .array(arbQuantizedPoint, { maxLength: 10 })
    .map(points => points.map((point, index) => c(`c${index}`, point.x, point.y)));
  const arbAxis: fc.Arbitrary<Axis> = fc.constantFrom('x', 'y');

  it('каждый выживший в snapDist по своей оси, на своей стороне и минимален по dist на стороне; если оба — dist отличаются ≤ B_EPS', () => {
    fc.assert(
      fc.property(
        arbAxis,
        arbQuantizedPoint,
        arbCandidates,
        fc.integer({ min: 0, max: 500 }),
        (axis, point, candidates, snapDist) => {
          const secondary: Axis = axis === 'x' ? 'y' : 'x';
          const [m, p] = snapAxis(axis, point, candidates, snapDist, NONE);
          const dist = (q: SnapCandidate) => Math.abs(point[axis] - q[axis]);
          const side = (q: SnapCandidate) => (q[secondary] < point[secondary] ? 'M' : 'P');
          for (const [aligner, expectedSide] of [
            [m, 'M'],
            [p, 'P'],
          ] as const) {
            if (!aligner) continue;
            expect(candidates).toContain(aligner);
            expect(dist(aligner)).toBeLessThanOrEqual(snapDist);
            expect(side(aligner)).toBe(expectedSide);
            const sameSide = candidates.filter(q => side(q) === expectedSide);
            const minDist = Math.min(...sameSide.map(dist));
            expect(dist(aligner)).toBeLessThanOrEqual(minDist + 1e-6);
            const sideDist = (q: SnapCandidate) => Math.abs(point[secondary] - q[secondary]);
            const minSideDist = Math.min(...sameSide.filter(q => dist(q) <= minDist + L_EPS).map(sideDist));
            expect(sideDist(aligner)).toBeLessThanOrEqual(minSideDist + 1e-6);
          }
          if (m && p) expect(Math.abs(dist(m) - dist(p))).toBeLessThanOrEqual(B_EPS);
        },
      ),
      fcParams,
    );
  });

  it('если на стороне есть кандидат в snapDist и другая сторона его не перебивает — сторона непуста', () => {
    fc.assert(
      fc.property(
        arbAxis,
        arbQuantizedPoint,
        arbCandidates,
        fc.integer({ min: 0, max: 500 }),
        (axis, point, candidates, snapDist) => {
          const secondary: Axis = axis === 'x' ? 'y' : 'x';
          const [m, p] = snapAxis(axis, point, candidates, snapDist, NONE);
          const dist = (q: SnapCandidate) => Math.abs(point[axis] - q[axis]);
          const onM = candidates.filter(q => q[secondary] < point[secondary]).map(dist);
          const onP = candidates.filter(q => q[secondary] >= point[secondary]).map(dist);
          const minM = Math.min(...onM);
          const minP = Math.min(...onP);
          if (minM <= snapDist && minM <= minP + B_EPS) expect(m).not.toBeNull();
          if (minP <= snapDist && minP <= minM + B_EPS) expect(p).not.toBeNull();
        },
      ),
      fcParams,
    );
  });
});

describe('pickAligner', () => {
  const m = c('m', 3, -5);
  const p = c('p', 3, 5);

  it('только один — он', () => {
    expect(pickAligner([m, null], O)).toBe(m);
    expect(pickAligner([null, p], O)).toBe(p);
  });

  it('оба — ближний по манхэттену всей точки', () => {
    const farM = c('farM', 3, -50);
    expect(pickAligner([farM, p], O)).toBe(p);
    const farP = c('farP', 3, 50);
    expect(pickAligner([m, farP], O)).toBe(m);
  });

  it('оба при равном манхэттене — M', () => {
    expect(manhDist(m, O)).toBe(manhDist(p, O));
    expect(pickAligner([m, p], O)).toBe(m);
  });

  it('ни одного → null', () => {
    expect(pickAligner(NO_ALIGNERS, O)).toBeNull();
  });
});

describe('snapPerpendicular', () => {
  it('без выравнивателей → point null, обе пары пусты', () => {
    const result = snapPerpendicular(O, [], SNAP, NONE);
    expect(result.point).toBeNull();
    expect(result.alignerX).toBeNull();
    expect(result.alignerY).toBeNull();
    expect(result.rawAlignersX).toBe(NO_ALIGNERS);
    expect(result.rawAlignersY).toBe(NO_ALIGNERS);
  });

  it('только x подменяется: кандидат близко по dx, далеко по dy', () => {
    const a = c('a', 3, 100);
    const result = snapPerpendicular(O, [a], SNAP, NONE);
    expect(result.point).toEqual({ x: 3, y: 0 });
    expect(result.alignerX).toBe(a);
    expect(result.alignerY).toBeNull();
  });

  it('только y подменяется: кандидат близко по dy, далеко по dx', () => {
    const a = c('a', 100, 3);
    const result = snapPerpendicular(O, [a], SNAP, NONE);
    expect(result.point).toEqual({ x: 0, y: 3 });
    expect(result.alignerX).toBeNull();
    expect(result.alignerY).toBe(a);
  });

  it('обе координаты, поосно независимо: x от одного кандидата, y от другого', () => {
    const vertical = c('v', 3, 100);
    const horizontal = c('h', 100, 4);
    const result = snapPerpendicular(O, [vertical, horizontal], SNAP, NONE);
    expect(result.point).toEqual({ x: 3, y: 4 });
    expect(result.alignerX).toBe(vertical);
    expect(result.alignerY).toBe(horizontal);
  });

  it('один кандидат в углу — обе координаты от него', () => {
    const a = c('a', 3, 4);
    expect(snapPerpendicular(O, [a], SNAP, NONE).point).toEqual({ x: 3, y: 4 });
  });

  it('rawAlignersX/Y — как snapX/snapY, alignerX/Y — pickAligner от них', () => {
    const candidates = [c('m', 3, -5), c('p', 3, 50), c('h', -100, 2)];
    const result = snapPerpendicular(O, candidates, SNAP, NONE);
    expect(result.rawAlignersX).toEqual(snapX(O, candidates, SNAP, NONE));
    expect(result.rawAlignersY).toEqual(snapY(O, candidates, SNAP, NONE));
    expect(ids(result.rawAlignersX)).toEqual(['m', 'p']);
    expect(result.alignerX?.id).toBe('m');
    expect(result.alignerY?.id).toBe('h');
    expect(result.point).toEqual({ x: 3, y: 2 });
  });

  it('exceptIds пробрасываются в обе оси', () => {
    const a = c('a', 3, 4);
    expect(snapPerpendicular(O, [a], SNAP, new Set(['a'])).point).toBeNull();
  });

  it('property: point отличается от курсора только по осям с выравнивателем и берёт их координаты', () => {
    fc.assert(
      fc.property(
        arbQuantizedPoint,
        fc.array(arbQuantizedPoint, { maxLength: 8 }),
        fc.integer({ min: 0, max: 500 }),
        (point, points, snapDist) => {
          const candidates = points.map((q, i) => c(`c${i}`, q.x, q.y));
          const result = snapPerpendicular(point, candidates, snapDist, NONE);
          if (!result.alignerX && !result.alignerY) {
            expect(result.point).toBeNull();
            return;
          }
          expect(result.point).toEqual({
            x: result.alignerX ? result.alignerX.x : point.x,
            y: result.alignerY ? result.alignerY.y : point.y,
          });
        },
      ),
      fcParams,
    );
  });
});
