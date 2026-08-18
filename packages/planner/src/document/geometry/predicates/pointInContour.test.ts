import * as fc from 'fast-check';

import { arbConvexPolygon, arbQuantizedPoint, fcParams } from '../testing/arbitraries';
import { locatePointInContour, pointInContour, pointInContours } from './pointInContour';
import { B_EPS } from './pointOnSegment';

const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
const SQUARE_CW = [...SQUARE].reverse();

/** Невыпуклый «гребень»: вершины и горизонтальные рёбра на уровне луча. */
const COMB = [
  { x: 0, y: 0 },
  { x: 60, y: 0 },
  { x: 60, y: 40 },
  { x: 40, y: 40 },
  { x: 40, y: 20 },
  { x: 20, y: 20 },
  { x: 20, y: 40 },
  { x: 0, y: 40 },
];

describe('locatePointInContour', () => {
  it('внутри / снаружи / граница (B_EPS) квадрата', () => {
    expect(locatePointInContour({ x: 50, y: 50 }, SQUARE)).toBe('inside');
    expect(locatePointInContour({ x: 150, y: 50 }, SQUARE)).toBe('outside');
    expect(locatePointInContour({ x: -1, y: 50 }, SQUARE)).toBe('outside');
    expect(locatePointInContour({ x: 100, y: 50 }, SQUARE)).toBe('boundary');
    expect(locatePointInContour({ x: 100 + B_EPS * 0.99, y: 50 }, SQUARE)).toBe('boundary');
    expect(locatePointInContour({ x: 100 + B_EPS * 1.01, y: 50 }, SQUARE)).toBe('outside');
    expect(locatePointInContour({ x: 100 - B_EPS * 1.01, y: 50 }, SQUARE)).toBe('inside');
  });

  it('ориентация обхода не важна', () => {
    expect(locatePointInContour({ x: 50, y: 50 }, SQUARE_CW)).toBe('inside');
    expect(locatePointInContour({ x: 150, y: 50 }, SQUARE_CW)).toBe('outside');
  });

  it('вершина на горизонтали точки считается ровно один раз (полуоткрытые рёбра): луч через вершину', () => {
    const diamond = [
      { x: 0, y: -10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: -10, y: 0 },
    ];
    // Луч из (−3, 0) проходит через вершину (10, 0) справа: одно пересечение → внутри.
    expect(locatePointInContour({ x: -3, y: 0 }, diamond)).toBe('inside');
    // Луч из (−30, 0) проходит через обе вершины на y = 0: снаружи.
    expect(locatePointInContour({ x: -30, y: 0 }, diamond)).toBe('outside');
    expect(locatePointInContour({ x: 30, y: 0 }, diamond)).toBe('outside');
  });

  it('горизонтальные рёбра и вершины на уровне луча в невыпуклом контуре', () => {
    expect(locatePointInContour({ x: 10, y: 30 }, COMB)).toBe('inside');
    expect(locatePointInContour({ x: 30, y: 30 }, COMB)).toBe('outside'); // в вырезе гребня
    expect(locatePointInContour({ x: 50, y: 30 }, COMB)).toBe('inside');
    expect(locatePointInContour({ x: 30, y: 10 }, COMB)).toBe('inside');
    expect(locatePointInContour({ x: 10, y: 20 }, COMB)).toBe('inside'); // на уровне ребра выреза, левее него
    expect(locatePointInContour({ x: 50, y: 20 }, COMB)).toBe('inside');
    expect(locatePointInContour({ x: 30, y: 20 }, COMB)).toBe('boundary');
    expect(locatePointInContour({ x: 70, y: 20 }, COMB)).toBe('outside');
    expect(locatePointInContour({ x: 30, y: 40 }, COMB)).toBe('outside'); // между зубьями на уровне их верха
  });

  it('вертикальное ребро точно на x точки (риск 0/0 референса) — детерминированно', () => {
    expect(locatePointInContour({ x: 100, y: 200 }, SQUARE)).toBe('outside');
    expect(locatePointInContour({ x: 100, y: -200 }, SQUARE)).toBe('outside');
    expect(locatePointInContour({ x: 0, y: 200 }, SQUARE)).toBe('outside');
  });

  it('вырожденные контуры: < 3 точек — граница на рёбрах, иначе снаружи; пустой — снаружи', () => {
    expect(locatePointInContour({ x: 0, y: 0 }, [])).toBe('outside');
    expect(
      locatePointInContour({ x: 5, y: 0 }, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe('boundary');
    expect(
      locatePointInContour({ x: 5, y: 1 }, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe('outside');
  });

  it('NaN — снаружи, не исключение', () => {
    expect(locatePointInContour({ x: Number.NaN, y: 50 }, SQUARE)).toBe('outside');
  });

  it('property: центр выпуклого многоугольника внутри, точка вне bbox снаружи, вершины — граница', () => {
    fc.assert(
      fc.property(arbConvexPolygon, polygon => {
        const center = {
          x: polygon.reduce((s, p) => s + p.x, 0) / polygon.length,
          y: polygon.reduce((s, p) => s + p.y, 0) / polygon.length,
        };
        expect(locatePointInContour(center, polygon)).toBe('inside');
        const maxX = Math.max(...polygon.map(p => p.x));
        expect(locatePointInContour({ x: maxX + 1, y: center.y }, polygon)).toBe('outside');
        for (const vertex of polygon) expect(locatePointInContour(vertex, polygon)).toBe('boundary');
      }),
      fcParams,
    );
  });

  it('property: классификация не зависит от ориентации обхода и точки старта контура', () => {
    fc.assert(
      fc.property(arbConvexPolygon, arbQuantizedPoint, fc.nat(), (polygon, point, shift) => {
        const location = locatePointInContour(point, polygon);
        expect(['inside', 'boundary', 'outside']).toContain(location);
        expect(locatePointInContour(point, [...polygon].reverse())).toBe(location);
        const k = shift % polygon.length;
        expect(locatePointInContour(point, [...polygon.slice(k), ...polygon.slice(0, k)])).toBe(location);
      }),
      fcParams,
    );
  });
});

describe('pointInContour / pointInContours', () => {
  it('pointInContour — строго внутри; граница — false', () => {
    expect(pointInContour({ x: 50, y: 50 }, SQUARE)).toBe(true);
    expect(pointInContour({ x: 100, y: 50 }, SQUARE)).toBe(false);
    expect(pointInContour({ x: 150, y: 50 }, SQUARE)).toBe(false);
  });

  it('pointInContours — число содержащих контуров; one — ранний выход 1', () => {
    const inner = [
      { x: 25, y: 25 },
      { x: 75, y: 25 },
      { x: 75, y: 75 },
      { x: 25, y: 75 },
    ];
    expect(pointInContours({ x: 50, y: 50 }, [SQUARE, inner])).toBe(2);
    expect(pointInContours({ x: 10, y: 10 }, [SQUARE, inner])).toBe(1);
    expect(pointInContours({ x: 150, y: 10 }, [SQUARE, inner])).toBe(0);
    expect(pointInContours({ x: 50, y: 50 }, [SQUARE, inner], true)).toBe(1);
    expect(pointInContours({ x: 150, y: 10 }, [SQUARE, inner], true)).toBe(0);
    expect(pointInContours({ x: 50, y: 50 }, [])).toBe(0);
  });
});
