import * as fc from 'fast-check';

import { manhDist } from '../predicates/distance';
import { arbQuantizedPoint, fcParams } from '../testing/arbitraries';
import type { SnapCandidate } from './candidates';
import { findNearest, snapToNearest } from './snapToNearest';

const c = (id: string, x: number, y: number): SnapCandidate => ({ id, x, y });
const NONE: ReadonlySet<string> = new Set();

describe('findNearest', () => {
  it('обычный случай: ближайший по манхэттену', () => {
    const near = c('near', 3, 4);
    const far = c('far', -8, 0);
    expect(findNearest({ x: 0, y: 0 }, [far, near], 10)).toBe(near);
  });

  it('метрика — манхэттен: евклид < maxDist, но манхэттен > maxDist — не берётся', () => {
    // (6, 6): евклид ≈ 8.49 < 10, манхэттен 12 > 10.
    expect(findNearest({ x: 0, y: 0 }, [c('a', 6, 6)], 10)).toBeNull();
    // (7, 0): и то, и другое 7 — берётся.
    expect(findNearest({ x: 0, y: 0 }, [c('a', 7, 0)], 10)).not.toBeNull();
  });

  it('порог включительно: = maxDist берётся, чуть больше — нет', () => {
    expect(findNearest({ x: 0, y: 0 }, [c('a', 6, 4)], 10)?.id).toBe('a');
    expect(findNearest({ x: 0, y: 0 }, [c('a', 6, 4.001)], 10)).toBeNull();
    expect(findNearest({ x: 0, y: 0 }, [c('a', 6, 4 + 1e-9)], 10)).toBeNull();
  });

  it('tie → первый по порядку', () => {
    const first = c('first', 5, 0);
    const second = c('second', 0, 5);
    expect(findNearest({ x: 0, y: 0 }, [first, second], 10)).toBe(first);
    expect(findNearest({ x: 0, y: 0 }, [second, first], 10)).toBe(second);
  });

  it('совпадающие точки (расстояние 0) → первый; совпадающая с курсором — берётся при maxDist 0', () => {
    const a = c('a', 1, 1);
    const b = c('b', 1, 1);
    expect(findNearest({ x: 1, y: 1 }, [a, b], 0)).toBe(a);
  });

  it('пустой список → null', () => {
    expect(findNearest({ x: 0, y: 0 }, [], 10)).toBeNull();
  });

  it('NaN в точке → null', () => {
    expect(findNearest({ x: Number.NaN, y: 0 }, [c('a', 0, 0)], 10)).toBeNull();
    expect(findNearest({ x: 0, y: Number.NaN }, [c('a', 0, 0)], 10)).toBeNull();
  });

  it('NaN в maxDist → null', () => {
    expect(findNearest({ x: 0, y: 0 }, [c('a', 0, 0)], Number.NaN)).toBeNull();
  });

  it('NaN-кандидат пропускается (не побеждает и не роняет)', () => {
    const ok = c('ok', 1, 0);
    expect(findNearest({ x: 0, y: 0 }, [c('nan', Number.NaN, 0), ok], 10)).toBe(ok);
  });

  it('отрицательный maxDist → null', () => {
    expect(findNearest({ x: 0, y: 0 }, [c('a', 0, 0)], -1)).toBeNull();
  });

  it('property: результат — минимальный по манхэттену и в радиусе; иначе все дальше радиуса', () => {
    fc.assert(
      fc.property(
        arbQuantizedPoint,
        fc.array(arbQuantizedPoint, { maxLength: 12 }),
        fc.integer({ min: 0, max: 5000 }),
        (point, points, maxDist) => {
          const candidates = points.map((q, i) => c(`c${i}`, q.x, q.y));
          const result = findNearest(point, candidates, maxDist);
          const distances = candidates.map(q => manhDist(point, q));
          const min = Math.min(...distances);
          if (result) {
            expect(manhDist(point, result)).toBeLessThanOrEqual(maxDist);
            expect(manhDist(point, result)).toBe(min);
            expect(candidates.indexOf(result)).toBe(distances.indexOf(min));
          } else {
            distances.forEach(distance => expect(distance).toBeGreaterThan(maxDist));
          }
        },
      ),
      fcParams,
    );
  });
});

describe('snapToNearest', () => {
  it('exceptIds исключает ближайшего — берётся следующий', () => {
    const nearest = c('n', 1, 0);
    const second = c('s', 2, 0);
    expect(snapToNearest({ x: 0, y: 0 }, [nearest, second], 10, new Set(['n']))).toBe(second);
  });

  it('exceptIds исключает всех → null', () => {
    expect(snapToNearest({ x: 0, y: 0 }, [c('a', 1, 0)], 10, new Set(['a']))).toBeNull();
  });

  it('пустой Set — как findNearest', () => {
    const candidates = [c('a', 3, 3), c('b', 1, 1), c('c', 2, 2)];
    expect(snapToNearest({ x: 0, y: 0 }, candidates, 10, NONE)).toBe(findNearest({ x: 0, y: 0 }, candidates, 10));
    expect(snapToNearest({ x: 0, y: 0 }, candidates, 10, NONE)?.id).toBe('b');
  });

  it('id не из списка в exceptIds ничего не меняет', () => {
    const only = c('a', 1, 0);
    expect(snapToNearest({ x: 0, y: 0 }, [only], 10, new Set(['zzz']))).toBe(only);
  });

  it('порог включительно и по snapDist', () => {
    expect(snapToNearest({ x: 0, y: 0 }, [c('a', 10, 0)], 10, NONE)?.id).toBe('a');
    expect(snapToNearest({ x: 0, y: 0 }, [c('a', 10.001, 0)], 10, NONE)).toBeNull();
  });

  it('пустой список → null', () => {
    expect(snapToNearest({ x: 0, y: 0 }, [], 10, NONE)).toBeNull();
  });
});
