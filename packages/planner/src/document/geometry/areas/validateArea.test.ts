import type { PlanPosition } from '../../PlannerDocument';
import { COORDINATE_QUANTUM } from '../../quantize';
import { validateArea, type ValidateAreaInput } from './validateArea';

const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Комната-кольцо: полость 380 × 280, тело стен — обвод 400 × 300. */
const ROOM = rect(10, 10, 390, 290);
const WALL = rect(0, 0, 400, 300);

const check = (points: readonly PlanPosition[], patch: Partial<ValidateAreaInput> = {}) =>
  validateArea({ points, rooms: [ROOM], walls: [WALL], areas: [], ...patch });

describe('validateArea', () => {
  it('зона целиком внутри комнаты — годна', () => {
    expect(check(rect(100, 100, 200, 200))).toBeNull();
  });

  it('зона, касающаяся стены одной стороной, — годна (касание допустимо)', () => {
    expect(check(rect(10, 100, 200, 200))).toBeNull();
  });

  it('зона, совпавшая с комнатой по всем сторонам, — годна', () => {
    expect(check(ROOM)).toBeNull();
  });

  it('зона, пересекающая стену, — `crosses-walls`', () => {
    expect(check(rect(-5, 100, 200, 200))).toBe('crosses-walls');
  });

  it('зона целиком вне комнаты — `crosses-walls`: своей комнаты у неё нет', () => {
    expect(check(rect(500, 100, 600, 200))).toBe('crosses-walls');
  });

  it('зона в толще стены — `crosses-walls`', () => {
    expect(check(rect(0, 100, 10, 200))).toBe('crosses-walls');
  });

  it('комнат нет вовсе — `crosses-walls`', () => {
    expect(check(rect(100, 100, 200, 200), { rooms: [] })).toBe('crosses-walls');
  });

  it('зона, режущая свободностоящую стену внутри комнаты, — `crosses-walls`', () => {
    const stub = rect(195, 100, 205, 200);
    expect(check(rect(150, 120, 250, 180), { walls: [WALL, stub] })).toBe('crosses-walls');
  });

  it('зона, целиком накрывшая свободностоящую стену, годна — такая стена просто укорачивается', () => {
    const stub = rect(195, 100, 205, 200);
    expect(check(rect(100, 50, 300, 250), { walls: [WALL, stub] })).toBeNull();
  });

  it('зона в толще свободностоящей колонны — `crosses-walls`, хотя она и внутри комнаты', () => {
    const column = rect(150, 100, 250, 200);
    expect(check(rect(170, 120, 230, 180), { walls: [WALL, column] })).toBe('crosses-walls');
  });

  it('вложенность в объемлющее комнату тело стен конфликтом не является (иначе годных зон не было бы вовсе)', () => {
    // Тот же `belong`, что и у колонны, но это обвод кольца — он объемлет саму комнату.
    expect(check(rect(170, 120, 230, 180), { walls: [WALL] })).toBeNull();
  });

  it('зона, совпавшая с колонной по контуру, — `crosses-walls`: её граница лежит на стене, а не внутри комнаты', () => {
    const column = rect(150, 100, 250, 200);
    expect(check(column, { walls: [WALL, column] })).toBe('crosses-walls');
  });

  it('две касающиеся зоны — обе годны (касание границами допустимо), в любом порядке проверки', () => {
    const left = rect(100, 100, 200, 200);
    const right = rect(200, 100, 300, 200);
    expect(check(right, { areas: [left] })).toBeNull();
    expect(check(left, { areas: [right] })).toBeNull();
  });

  it('две пересекающиеся зоны — вторая `overlaps-area`', () => {
    expect(check(rect(150, 100, 300, 200), { areas: [rect(100, 100, 200, 200)] })).toBe('overlaps-area');
  });

  it('зона внутри существующей зоны — `overlaps-area`', () => {
    expect(check(rect(120, 120, 180, 180), { areas: [rect(100, 100, 200, 200)] })).toBe('overlaps-area');
  });

  it('зона, накрывшая существующую, — `overlaps-area` (симметрия отношения)', () => {
    expect(check(rect(50, 50, 300, 250), { areas: [rect(100, 100, 200, 200)] })).toBe('overlaps-area');
  });

  it('зона поодаль от существующей — годна', () => {
    expect(check(rect(250, 100, 350, 200), { areas: [rect(100, 100, 200, 200)] })).toBeNull();
  });

  it('самопересечение — `self-intersected`, и оно важнее вырожденной площади «бабочки»', () => {
    const bowTie = [
      { x: 100, y: 100 },
      { x: 300, y: 200 },
      { x: 300, y: 100 },
      { x: 100, y: 200 },
    ];
    expect(check(bowTie)).toBe('self-intersected');
  });

  it('меньше трёх точек — `degenerate`', () => {
    expect(
      check([
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ]),
    ).toBe('degenerate');
    expect(check([])).toBe('degenerate');
  });

  it('порог площади (`contourValid`): 8 × 8 см годна, 7 × 7 — `degenerate`', () => {
    expect(check(rect(100, 100, 108, 108))).toBeNull();
    expect(check(rect(100, 100, 107, 107))).toBe('degenerate');
  });

  it('сливер (площадь есть, отношение к периметру нет) — `degenerate`', () => {
    expect(check(rect(100, 100, 300, 100.6))).toBe('degenerate');
  });

  it('опора проверяется только при `requireSupport`', () => {
    const area = rect(100, 100, 200, 200);
    expect(check(area, { requireSupport: false, roomPoints: ROOM })).toBeNull();
    expect(check(area, { requireSupport: true, roomPoints: ROOM })).toBe('unsupported');
  });

  it('опёртая зона годна; сдвиг точки комнаты на квант ломает опору', () => {
    const area = [
      { x: 10, y: 10 },
      { x: 390, y: 10 },
      { x: 390, y: 290 },
    ];
    expect(check(area, { requireSupport: true, roomPoints: ROOM })).toBeNull();
    expect(
      check(area, {
        requireSupport: true,
        roomPoints: ROOM.map(p => (p.x === 390 && p.y === 290 ? { x: p.x, y: p.y + COORDINATE_QUANTUM } : p)),
      }),
    ).toBe('unsupported');
  });

  it('`requireSupport` без `roomPoints` — зона неопёрта', () => {
    expect(check(rect(100, 100, 200, 200), { requireSupport: true })).toBe('unsupported');
  });

  describe('порядок проверок', () => {
    const bowTie = [
      { x: 100, y: 100 },
      { x: 300, y: 200 },
      { x: 300, y: 100 },
      { x: 100, y: 200 },
    ];

    it('стены важнее зон: зона вне комнаты и поверх такой же зоны — `crosses-walls`', () => {
      expect(check(rect(500, 100, 600, 200), { areas: [rect(500, 100, 600, 200)] })).toBe('crosses-walls');
    });

    it('самопересечение важнее опоры: «бабочка» без опоры — `self-intersected`', () => {
      expect(check(bowTie, { requireSupport: true, roomPoints: [] })).toBe('self-intersected');
    });

    it('зоны важнее опоры: пересечение зон при неопёртой зоне — `overlaps-area`', () => {
      expect(check(rect(150, 100, 300, 200), { areas: [rect(100, 100, 200, 200)], requireSupport: true })).toBe(
        'overlaps-area',
      );
    });
  });

  it('ориентация обхода зоны не важна: тот же контур по часовой — годен', () => {
    const ccw = rect(100, 100, 200, 200);
    expect(check([...ccw].reverse())).toBeNull();
  });

  it('знак координат не важен: комната и зона в отрицательном квадранте', () => {
    expect(
      validateArea({
        points: rect(-300, -200, -200, -100),
        rooms: [rect(-390, -290, -10, -10)],
        walls: [rect(-400, -300, 0, 0)],
        areas: [],
      }),
    ).toBeNull();
  });

  it('зона по часовой в отрицательном квадранте пересекает стену так же, как по часовой в положительном', () => {
    expect(
      validateArea({
        points: [...rect(-405, -200, -200, -100)].reverse(),
        rooms: [rect(-390, -290, -10, -10)],
        walls: [rect(-400, -300, 0, 0)],
        areas: [],
      }),
    ).toBe('crosses-walls');
  });

  it('`NaN` и `±Infinity` в точке зоны — `degenerate`: контур без площади', () => {
    expect(
      check([
        { x: Number.NaN, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
      ]),
    ).toBe('degenerate');
    expect(
      check([
        { x: Number.POSITIVE_INFINITY, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
      ]),
    ).toBe('degenerate');
    expect(
      check([
        { x: Number.NEGATIVE_INFINITY, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
      ]),
    ).toBe('degenerate');
  });

  it('вход не мутируется', () => {
    const points = rect(100, 100, 200, 200);
    const snapshot = JSON.stringify(points);
    check(points, { requireSupport: true, roomPoints: ROOM });
    expect(JSON.stringify(points)).toBe(snapshot);
  });
});
