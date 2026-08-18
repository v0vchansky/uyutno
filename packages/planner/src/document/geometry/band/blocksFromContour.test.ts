import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { contourArea } from '../predicates/contourArea';
import { euclDist } from '../predicates/distance';
import type { OffsetSide } from '../predicates/offsetPoint';
import { arbConvexPolygon, arbQuantizedPoint, fcParams } from '../testing/arbitraries';
import { DEFAULT_WALL_WIDTH, RE_MITER_ANGLE, type WallBlock, blocksFromContour } from './blocksFromContour';

const W = 10;
const p = (x: number, y: number): PlanPosition => ({ x, y });

const expectBlock = (block: WallBlock | undefined, expected: PlanPosition[]) => {
  expect(block).toBeDefined();
  block!.forEach((point, i) => {
    expect(point.x).toBeCloseTo(expected[i]!.x, 9);
    expect(point.y).toBeCloseTo(expected[i]!.y, 9);
  });
};

describe('blocksFromContour', () => {
  it('константы (спека 01, ADR 0017 C3/C5)', () => {
    expect(DEFAULT_WALL_WIDTH).toBe(10);
    expect(RE_MITER_ANGLE).toBeCloseTo(Math.PI * 0.75, 15);
  });

  describe('гарды', () => {
    it('≤ 1 точки → []', () => {
      expect(blocksFromContour([], W, 'left', false)).toEqual([]);
      expect(blocksFromContour([p(0, 0)], W, 'left', false)).toEqual([]);
      expect(blocksFromContour([p(0, 0)], W, 'left', true)).toEqual([]);
    });

    it('две точки короче ширины → []; ровно ширина — один квад', () => {
      expect(blocksFromContour([p(0, 0), p(9.99, 0)], W, 'left', false)).toEqual([]);
      expect(blocksFromContour([p(0, 0), p(10, 0)], W, 'left', false)).toHaveLength(1);
    });

    it('ширина не положительная или NaN → []', () => {
      expect(blocksFromContour([p(0, 0), p(100, 0)], 0, 'left', false)).toEqual([]);
      expect(blocksFromContour([p(0, 0), p(100, 0)], -10, 'left', false)).toEqual([]);
      expect(blocksFromContour([p(0, 0), p(100, 0)], Number.NaN, 'left', false)).toEqual([]);
    });

    it('подряд идущие дубли точек схлопываются: результат как без дублей', () => {
      const clean = blocksFromContour([p(0, 0), p(100, 0), p(100, 100)], W, 'left', false);
      const dirty = blocksFromContour([p(0, 0), p(0, 0), p(100, 0), p(100, 0), p(100, 100)], W, 'left', false);
      expect(dirty).toEqual(clean);
    });

    it('замкнутый контур с < 3 различных точек → []; дубль первой точки в хвосте замкнутого — схлопывается', () => {
      expect(blocksFromContour([p(0, 0), p(100, 0)], W, 'left', true)).toEqual([]);
      const square = [p(0, 0), p(100, 0), p(100, 100), p(0, 100)];
      expect(blocksFromContour([...square, p(0, 0)], W, 'left', true)).toEqual(
        blocksFromContour(square, W, 'left', true),
      );
    });

    it('NaN/Infinity в координатах → [] без исключения', () => {
      expect(blocksFromContour([p(Number.NaN, 0), p(100, 0), p(100, 100)], W, 'left', false)).toEqual([]);
      expect(blocksFromContour([p(0, 0), p(Number.POSITIVE_INFINITY, 0)], W, 'left', false)).toEqual([]);
    });
  });

  describe('одиночный сегмент', () => {
    it('квад [A, C, D, B]: офсет-старт, офсет-конец, конец линии, начало линии; сторона left = +y для +X', () => {
      const [block] = blocksFromContour([p(0, 0), p(100, 0)], W, 'left', false);
      expectBlock(block, [p(0, 10), p(100, 10), p(100, 0), p(0, 0)]);
    });

    it('сторона right = −y для +X; наклонный сегмент — офсет ровно на width', () => {
      const [block] = blocksFromContour([p(0, 0), p(100, 0)], W, 'right', false);
      expectBlock(block, [p(0, -10), p(100, -10), p(100, 0), p(0, 0)]);
      const [diag] = blocksFromContour([p(0, 0), p(30, 40)], W, 'left', false);
      expect(euclDist(diag![0], p(0, 0))).toBeCloseTo(10, 9);
      expect(euclDist(diag![1], p(30, 40))).toBeCloseTo(10, 9);
      expectBlock(diag, [p(-8, 6), p(22, 46), p(30, 40), p(0, 0)]);
    });

    it('выходные точки — новые объекты, не ссылки на вход', () => {
      const a = p(0, 0);
      const b = p(100, 0);
      const [block] = blocksFromContour([a, b], W, 'left', false);
      expect(block![3]).toEqual(a);
      expect(block![3]).not.toBe(a);
    });
  });

  describe('открытая полилиния: митра и переносы', () => {
    it('прямой угол — митра в общей точке, соседние квады делят A = C, B = D', () => {
      const blocks = blocksFromContour([p(0, 0), p(100, 0), p(100, 100)], W, 'left', false);
      expect(blocks).toHaveLength(2);
      // Лента слева от обхода: над первым сегментом и левее второго → апекс (90, 10).
      expectBlock(blocks[0], [p(0, 10), p(90, 10), p(100, 0), p(0, 0)]);
      expectBlock(blocks[1], [p(90, 10), p(90, 100), p(100, 100), p(100, 0)]);
      expect(blocks[1]![0]).toEqual(blocks[0]![1]);
      expect(blocks[1]![3]).toEqual(blocks[0]![2]);
    });

    it('прямой угол в другую сторону (right) — внешняя митра, спайк', () => {
      const blocks = blocksFromContour([p(0, 0), p(100, 0), p(100, 100)], W, 'right', false);
      expectBlock(blocks[0], [p(0, -10), p(110, -10), p(100, 0), p(0, 0)]);
      expectBlock(blocks[1], [p(110, -10), p(110, 100), p(100, 100), p(100, 0)]);
    });

    it('коллинеарные соседи (прямой ход) — null-guard пересечения → плоский стык', () => {
      const blocks = blocksFromContour([p(0, 0), p(50, 0), p(100, 0)], W, 'left', false);
      expectBlock(blocks[0], [p(0, 10), p(50, 10), p(50, 0), p(0, 0)]);
      expectBlock(blocks[1], [p(50, 10), p(100, 10), p(100, 0), p(50, 0)]);
    });

    it('острый угол (поворот > 135°) со спайком вне bbox — плоские торцы и рестарт ленты', () => {
      // Поворот назад под ~170°: апекс улетает далеко.
      const blocks = blocksFromContour([p(0, 0), p(100, 0), p(0, 17)], W, 'left', false);
      expect(blocks).toHaveLength(2);
      // Первый квад закрывается перпендикулярно своему сегменту (C = L01 = (100, 10)), D = P1.
      expectBlock(blocks[0], [p(0, 10), p(100, 10), p(100, 0), p(0, 0)]);
      // Второй начинается с сырого офсета второго сегмента (A = L12, B = P1).
      expect(blocks[1]![3]).toEqual(p(100, 0));
      expect(euclDist(blocks[1]![0], p(100, 0))).toBeCloseTo(10, 9);
      expect(blocks[1]![0]).not.toEqual(blocks[0]![1]);
    });

    it('острый угол, но апекс внутри bbox [P1, L2] — митра сохраняется (оба условия нужны)', () => {
      // Тот же поворот ~170°, но второй сегмент длинный (304 см): апекс (−18.5, 10) на 118 см от вершины
      // лежит в bbox [P1, L2] — спайк «помещается», митра остаётся.
      const points = [p(0, 0), p(100, 0), p(-200, 51)];
      const blocks = blocksFromContour(points, W, 'left', false);
      expect(blocks).toHaveLength(2);
      expect(blocks[1]![0]).toEqual(blocks[0]![1]); // A = C — митра, не рестарт
      expect(blocks[0]![1].x).toBeCloseTo(-18.5, 0);
      expect(blocks[0]![1].y).toBeCloseTo(10, 9);
    });

    it('порог 135°: поворот на 134° — митра, на 136° со спайком вне bbox — торец', () => {
      const turn = (deg: number) => {
        // Второй сегмент направлен под углом `deg` к продолжению первого (поворот налево).
        const rad = (deg * Math.PI) / 180;
        return [p(0, 0), p(100, 0), p(100 + 100 * Math.cos(rad), 100 * Math.sin(rad))];
      };
      const mitered = blocksFromContour(turn(134), W, 'right', false);
      expect(mitered[1]![0]).toEqual(mitered[0]![1]);
      const capped = blocksFromContour(turn(136), W, 'right', false);
      expect(capped[1]![0]).not.toEqual(capped[0]![1]);
    });

    it('последний сегмент короче ширины — отбрасывается (три точки → один квад до предпоследней); ровно ширина — остаётся', () => {
      const blocks = blocksFromContour([p(0, 0), p(100, 0), p(100, 5)], W, 'left', false);
      expect(blocks).toHaveLength(1);
      expectBlock(blocks[0], [p(0, 10), p(100, 10), p(100, 0), p(0, 0)]);
      expect(blocksFromContour([p(0, 0), p(100, 0), p(100, 10)], W, 'left', false)).toHaveLength(2);
    });

    it('порог 135° симметричен для правого поворота (граница 2π − RE_MITER_ANGLE)', () => {
      const turnRight = (deg: number) => {
        const rad = (-deg * Math.PI) / 180;
        return [p(0, 0), p(100, 0), p(100 + 100 * Math.cos(rad), 100 * Math.sin(rad))];
      };
      const mitered = blocksFromContour(turnRight(134), W, 'left', false);
      expect(mitered[1]![0]).toEqual(mitered[0]![1]);
      const capped = blocksFromContour(turnRight(136), W, 'left', false);
      expect(capped[1]![0]).not.toEqual(capped[0]![1]);
    });

    it('butt-капы: концы открытой ленты перпендикулярны сегментам', () => {
      const blocks = blocksFromContour([p(0, 0), p(100, 0), p(100, 100)], W, 'left', false);
      expect(blocks[0]![0]).toEqual(p(0, 10));
      expect(blocks[1]![1]).toEqual(p(90, 100));
    });
  });

  describe('T-стык (startNeighbourSegments)', () => {
    // Существующая стена по y = 0, новая стартует в (100, 0) под 45° вверх-вправо; лента слева.
    // Грань офсета — прямая y = x − 85.858…: с лучом к (0,0) пересекается в (85.86, 0), с лучом к (300,0) — вне луча.
    const TUCK_X = 100 - 10 * Math.SQRT2;

    it('старт на существующей стене: офсет-старт врезается в соседний луч (тук-ин), а не butt', () => {
      const blocks = blocksFromContour([p(100, 0), p(200, 100)], W, 'left', false, [p(0, 0), p(300, 0)]);
      const [a] = blocks[0]!;
      expect(a.x).toBeCloseTo(TUCK_X, 9);
      expect(a.y).toBeCloseTo(0, 9);
      // Без соседей — обычный butt: (92.93, 7.07).
      const [butt] = blocksFromContour([p(100, 0), p(200, 100)], W, 'left', false)[0]!;
      expect(butt.x).toBeCloseTo(100 - 5 * Math.SQRT2, 9);
      expect(butt.y).toBeCloseTo(5 * Math.SQRT2, 9);
    });

    it('старт в вершине существующей стены: из двух пересечений берётся ближайшее к концу грани (мельче надрез)', () => {
      // Лучи: влево к (0,0) → X0 = (85.86, 0); вверх к (100,200) → X1 = (100, 14.14). X1 ближе к концу грани.
      const blocks = blocksFromContour([p(100, 0), p(200, 100)], W, 'left', false, [p(0, 0), p(100, 200)]);
      const [a] = blocks[0]!;
      expect(a.x).toBeCloseTo(100, 9);
      expect(a.y).toBeCloseTo(10 * Math.SQRT2, 9);
      // Порядок соседей не важен.
      const [b] = blocksFromContour([p(100, 0), p(200, 100)], W, 'left', false, [p(100, 200), p(0, 0)])[0]!;
      expect(b.x).toBeCloseTo(100, 9);
    });

    it('соседи не пересекаются с офсет-линией на своих отрезках (или параллельны) → обычный butt-старт', () => {
      const parallel = blocksFromContour([p(100, 0), p(100, 100)], W, 'left', false, [p(100, -50), p(100, -100)]);
      expectBlock(parallel[0], [p(90, 0), p(90, 100), p(100, 100), p(100, 0)]);
      const away = blocksFromContour([p(100, 0), p(200, 100)], W, 'left', false, [p(300, 0), p(200, -100)]);
      expect(away[0]![0].x).toBeCloseTo(100 - 5 * Math.SQRT2, 9);
    });

    it('T-стык работает и для многосегментной полилинии (влияет только на старт)', () => {
      const blocks = blocksFromContour([p(100, 0), p(200, 100), p(300, 100)], W, 'left', false, [p(0, 0), p(300, 0)]);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]![0].x).toBeCloseTo(TUCK_X, 9);
      expect(blocks[0]![0].y).toBeCloseTo(0, 9);
    });
  });

  describe('замкнутый контур', () => {
    it('квадрат: 4 квада, все стыки митрованы, лента внутри при left и обходе против часовой', () => {
      const square = [p(0, 0), p(100, 0), p(100, 100), p(0, 100)];
      const blocks = blocksFromContour(square, W, 'left', true);
      expect(blocks).toHaveLength(4);
      // Квад ребра (0,0)→(100,0): офсет-грань y = 10, апексы (10,10) и (90,10).
      expectBlock(blocks[3], [p(10, 10), p(90, 10), p(100, 0), p(0, 0)]);
      expectBlock(blocks[0], [p(90, 10), p(90, 90), p(100, 100), p(100, 0)]);
      // Каждый квад начинается там, где кончился предыдущий (по кольцу).
      for (let i = 0; i < 4; i++) {
        const prev = blocks[(i + 3) % 4]!;
        expect(blocks[i]![0]).toEqual(prev[1]);
        expect(blocks[i]![3]).toEqual(prev[2]);
      }
    });

    it('right при обходе против часовой — лента снаружи, апексы на 10 см за углами', () => {
      const square = [p(0, 0), p(100, 0), p(100, 100), p(0, 100)];
      const blocks = blocksFromContour(square, W, 'right', true);
      expectBlock(blocks[3], [p(-10, -10), p(110, -10), p(100, 0), p(0, 0)]);
    });

    it('острый угол — плоский торец только по углу, без проверки спайка (Q32)', () => {
      // Треугольник с очень острым углом в (0,0): стороны к (200,0) и (200,17) — угол ~4.9°.
      const spike = [p(0, 0), p(200, 0), p(200, 17)];
      const outside = blocksFromContour(spike, W, 'right', true); // лента снаружи: спайк улетел бы
      const inside = blocksFromContour(spike, W, 'left', true); // лента внутри: спайк в bbox — но правило только по углу
      expect(outside).toHaveLength(3);
      expect(inside).toHaveLength(3);
      // Квад ребра (200,17)→(0,0) заканчивается плоским торцом: C = офсет конца ребра, а не общий апекс.
      const lastEdgeOutside = outside.find(b => b[2].x === 0 && b[2].y === 0)!;
      const firstEdgeOutside = outside.find(b => b[3].x === 0 && b[3].y === 0)!;
      expect(firstEdgeOutside[0]).not.toEqual(lastEdgeOutside[1]);
      const lastEdgeInside = inside.find(b => b[2].x === 0 && b[2].y === 0)!;
      const firstEdgeInside = inside.find(b => b[3].x === 0 && b[3].y === 0)!;
      expect(firstEdgeInside[0]).not.toEqual(lastEdgeInside[1]);
    });

    it('порог 135° в замкнутом контуре: 134° — митра, 136° — плоский торец (спайк не проверяется)', () => {
      // Треугольник с вершиной в (0,0) и внешним углом `deg` при ней; лента снаружи (right, обход CCW).
      const tri = (deg: number) => {
        const rad = ((180 - deg) * Math.PI) / 180; // внутренний угол
        return [p(0, 0), p(200, 0), p(200 * Math.cos(rad), 200 * Math.sin(rad))];
      };
      const seam = (blocks: WallBlock[]) => {
        const into = blocks.find(b => b[2].x === 0 && b[2].y === 0)!;
        const outOf = blocks.find(b => b[3].x === 0 && b[3].y === 0)!;
        return [into[1], outOf[0]] as const;
      };
      const [c134, a134] = seam(blocksFromContour(tri(134), W, 'right', true));
      expect(a134).toEqual(c134);
      const [c136, a136] = seam(blocksFromContour(tri(136), W, 'right', true));
      expect(a136).not.toEqual(c136);
    });

    it('коллинеарная вершина в замкнутом контуре — null-guard, плоский стык', () => {
      const withMid = [p(0, 0), p(50, 0), p(100, 0), p(100, 100), p(0, 100)];
      const blocks = blocksFromContour(withMid, W, 'left', true);
      expect(blocks).toHaveLength(5);
      const first = blocks.find(b => b[3].x === 0 && b[3].y === 0)!;
      expectBlock(first, [p(10, 10), p(50, 10), p(50, 0), p(0, 0)]);
    });

    it('замкнутый контур не зависит от точки старта: сдвиг вершин даёт те же квады с точностью до порядка', () => {
      const square = [p(0, 0), p(100, 0), p(100, 100), p(0, 100)];
      const shifted = [...square.slice(1), square[0]!];
      const key = (b: WallBlock) => b.map(q => `${q.x.toFixed(6)},${q.y.toFixed(6)}`).join('|');
      const a = blocksFromContour(square, W, 'left', true).map(key).sort();
      const b = blocksFromContour(shifted, W, 'left', true).map(key).sort();
      expect(a).toEqual(b);
    });
  });

  describe('property', () => {
    const arbPolyline = fc.array(arbQuantizedPoint, { minLength: 2, maxLength: 8 });
    const arbSide: fc.Arbitrary<OffsetSide> = fc.constantFrom('left', 'right');
    /** «Мягкая» полилиния: сегменты 50..500 см, повороты в пределах ±90° — митры короткие, квады простые. */
    const arbGentlePolyline = fc
      .record({
        start: arbQuantizedPoint,
        heading: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        steps: fc.array(
          fc.record({
            turn: fc.double({ min: -Math.PI / 2, max: Math.PI / 2, noNaN: true }),
            length: fc.integer({ min: 50, max: 500 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
      })
      .map(({ start, heading, steps }) => {
        const points = [start];
        let angle = heading;
        for (const { turn, length } of steps) {
          angle += turn;
          const last = points[points.length - 1]!;
          points.push({ x: last.x + length * Math.cos(angle), y: last.y + length * Math.sin(angle) });
        }
        return points;
      });

    it('нет NaN/Infinity, ровно 4 точки на квад, ≤ n − 1 квадов открытой / ≤ n замкнутой', () => {
      fc.assert(
        fc.property(arbPolyline, arbSide, fc.boolean(), fc.integer({ min: 1, max: 80 }), (points, side, closed, w) => {
          const blocks = blocksFromContour(points, w, side, closed);
          expect(blocks.length).toBeLessThanOrEqual(closed ? points.length : points.length - 1);
          for (const block of blocks) {
            expect(block).toHaveLength(4);
            for (const q of block) expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
          }
        }),
        fcParams,
      );
    });

    it('ориентация квадов на мягкой открытой полилинии: left — по часовой (площадь < 0), right — против', () => {
      fc.assert(
        fc.property(arbGentlePolyline, arbSide, (points, side) => {
          const blocks = blocksFromContour(points, W, side, false);
          expect(blocks).toHaveLength(points.length - 1);
          for (const block of blocks) {
            const area = contourArea(block);
            expect(side === 'left' ? area < 0 : area > 0).toBe(true);
          }
        }),
        fcParams,
      );
    });

    it('ориентация квадов на выпуклом замкнутом контуре (рёбра ≥ 50 см): n квадов, знак по стороне', () => {
      const arbRoomy = arbConvexPolygon.filter(poly =>
        poly.every((q, i) => euclDist(q, poly[(i + 1) % poly.length]!) >= 50),
      );
      fc.assert(
        fc.property(arbRoomy, arbSide, (points, side) => {
          const blocks = blocksFromContour(points, W, side, true);
          expect(blocks).toHaveLength(points.length);
          for (const block of blocks) {
            const area = contourArea(block);
            expect(side === 'left' ? area < 0 : area > 0).toBe(true);
          }
        }),
        fcParams,
      );
    });

    it('линия-грань квада — ровно сегмент входа: D и B совпадают с точками контура', () => {
      fc.assert(
        fc.property(arbPolyline, arbSide, (points, side) => {
          fc.pre(points.every((q, i) => i === 0 || euclDist(q, points[i - 1]!) >= W));
          const blocks = blocksFromContour(points, W, side, false);
          blocks.forEach((block, i) => {
            expect(block[3]).toEqual(points[i]);
            expect(block[2]).toEqual(points[i + 1]);
          });
        }),
        fcParams,
      );
    });
  });
});
