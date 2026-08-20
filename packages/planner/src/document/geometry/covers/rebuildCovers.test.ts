import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { contourArea, contourValid } from '../predicates/contourArea';
import { contourSelfIntersected } from '../predicates/contourSelfIntersected';
import { arbConvexPolygon, fcParams } from '../testing/arbitraries';
import type { CoverShape } from './coverShape';
import { rebuildCovers } from './rebuildCovers';

const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Обводы полов, отсортированные по первой вершине: порядок групп триангуляции контрактом не является. */
const outlines = (covers: readonly CoverShape[]): PlanPosition[][] =>
  covers.map(cover => cover.outline).sort((a, b) => a[0]!.x - b[0]!.x || a[0]!.y - b[0]!.y);

/** Коробка 400×300 со стенами 10 см: хранимый `outer` — обвод тела, хранимый `inner` — полость. */
const BOX_WALLS = [rect(0, 0, 400, 300)];
const BOX_ROOM = [rect(10, 10, 390, 290)];

/** Контур с `NaN` в одной вершине; `Infinity` — тот же случай, площадь обоих `NaN`. */
const NAN_CONTOUR: PlanPosition[] = [
  { x: Number.NaN, y: 10 },
  { x: 390, y: 10 },
  { x: 390, y: 290 },
  { x: 10, y: 290 },
];
const INFINITE_CONTOUR: PlanPosition[] = [
  { x: 10, y: 10 },
  { x: Number.POSITIVE_INFINITY, y: 10 },
  { x: 390, y: 290 },
  { x: 10, y: 290 },
];

describe('rebuildCovers', () => {
  it('пол по всей комнате переживает пересборку без изменений; ориентация обвода — против часовой', () => {
    const result = rebuildCovers({
      covers: [rect(10, 10, 390, 290)],
      coverHoles: [],
      rooms: BOX_ROOM,
      walls: BOX_WALLS,
    });
    expect(result.softFail).toBe(false);
    expect(result.covers).toHaveLength(1);
    expect(result.covers[0]!.outline).toEqual(rect(10, 10, 390, 290));
    expect(result.covers[0]!.holes).toEqual([]);
    expect(contourArea(result.covers[0]!.outline)).toBeGreaterThan(0);
  });

  it('комната сжалась — пол подрезан по новой границе, висящего за её пределами куска не остаётся', () => {
    // Стена уехала с x = 400 на x = 210; пол нарисован по старой (широкой) комнате.
    const result = rebuildCovers({
      covers: [rect(10, 10, 390, 290)],
      coverHoles: [],
      rooms: [rect(10, 10, 200, 290)],
      walls: [rect(0, 0, 210, 300)],
    });
    expect(outlines(result.covers)).toEqual([rect(10, 10, 200, 290)]);
  });

  it('новая перегородка режет пол на два куска (касающиеся куски не сливаются)', () => {
    const result = rebuildCovers({
      covers: [rect(10, 10, 390, 290)],
      coverHoles: [],
      rooms: [rect(10, 10, 200, 290), rect(210, 10, 390, 290)],
      walls: [rect(0, 0, 400, 300), rect(200, 10, 210, 290)],
    });
    expect(outlines(result.covers)).toEqual([rect(10, 10, 200, 290), rect(210, 10, 390, 290)]);
  });

  it('полы двух слитых комнат остаются на местах: перегородки нет, но полы не сливаются', () => {
    const result = rebuildCovers({
      covers: [rect(10, 10, 200, 290), rect(210, 10, 390, 290)],
      coverHoles: [],
      rooms: BOX_ROOM,
      walls: BOX_WALLS,
    });
    expect(outlines(result.covers)).toEqual([rect(10, 10, 200, 290), rect(210, 10, 390, 290)]);
  });

  it('полы, касающиеся общей границей, остаются раздельными (separateContacting)', () => {
    const result = rebuildCovers({
      covers: [rect(10, 10, 200, 290), rect(200, 10, 390, 290)],
      coverHoles: [],
      rooms: BOX_ROOM,
      walls: BOX_WALLS,
    });
    expect(outlines(result.covers)).toEqual([rect(10, 10, 200, 290), rect(200, 10, 390, 290)]);
  });

  it('пол-вычитание становится дыркой: обвод против часовой, дырка по часовой', () => {
    const result = rebuildCovers({
      covers: [rect(10, 10, 390, 290)],
      coverHoles: [rect(100, 100, 200, 200)],
      rooms: BOX_ROOM,
      walls: BOX_WALLS,
    });
    expect(result.covers).toHaveLength(1);
    expect(result.covers[0]!.outline).toEqual(rect(10, 10, 390, 290));
    expect(result.covers[0]!.holes).toEqual([
      [
        { x: 100, y: 100 },
        { x: 100, y: 200 },
        { x: 200, y: 200 },
        { x: 200, y: 100 },
      ],
    ]);
    expect(contourArea(result.covers[0]!.holes[0]!)).toBeLessThan(0);
  });

  it('комната в комнате: пол внешней получает вырез под внутреннюю, внутренняя полость — отдельный кусок', () => {
    const result = rebuildCovers({
      covers: [rect(10, 10, 390, 290)],
      coverHoles: [],
      rooms: [rect(10, 10, 390, 290), rect(110, 110, 240, 190)],
      walls: [rect(0, 0, 400, 300), rect(100, 100, 250, 200)],
    });
    expect(outlines(result.covers)).toEqual([rect(10, 10, 390, 290), rect(110, 110, 240, 190)]);
    const outer = result.covers.find(cover => cover.holes.length === 1)!;
    expect(outer.outline).toEqual(rect(10, 10, 390, 290));
    expect(outer.holes[0]).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 250, y: 200 },
      { x: 250, y: 100 },
    ]);
  });

  it('пол, целиком выпавший из комнат, исчезает (расхождение с гейтом референса `inside(bound) >= inside(subtract)`)', () => {
    const result = rebuildCovers({
      covers: [rect(500, 10, 600, 290)],
      coverHoles: [],
      rooms: BOX_ROOM,
      walls: BOX_WALLS,
    });
    expect(result.covers).toEqual([]);
  });

  it('пол, целиком накрытый телом стены, исчезает', () => {
    const result = rebuildCovers({
      covers: [rect(0, 0, 400, 10)],
      coverHoles: [],
      rooms: BOX_ROOM,
      walls: BOX_WALLS,
    });
    expect(result.covers).toEqual([]);
  });

  it('комнат не осталось — не осталось и полов', () => {
    const result = rebuildCovers({
      covers: [rect(10, 10, 390, 290)],
      coverHoles: [],
      rooms: [],
      walls: BOX_WALLS,
    });
    expect(result.covers).toEqual([]);
    expect(result.softFail).toBe(false);
  });

  it('пустой вход — пустой результат без исключений', () => {
    expect(rebuildCovers({ covers: [], coverHoles: [], rooms: [], walls: [] })).toEqual({
      covers: [],
      softFail: false,
    });
    expect(rebuildCovers({ covers: [], coverHoles: [], rooms: BOX_ROOM, walls: BOX_WALLS }).covers).toEqual([]);
  });

  it('вырожденные полы отбрасываются: < 3 точек, площадь < 50 см², сливер, совпадающие точки', () => {
    const result = rebuildCovers({
      covers: [
        [
          { x: 20, y: 20 },
          { x: 30, y: 20 },
        ],
        rect(20, 20, 25, 25),
        rect(20, 20, 380, 20.5),
        [
          { x: 100, y: 100 },
          { x: 100, y: 100 },
          { x: 100, y: 100 },
        ],
      ],
      coverHoles: [],
      rooms: BOX_ROOM,
      walls: BOX_WALLS,
    });
    expect(result.covers).toEqual([]);
  });

  it('ориентация входа не важна: тот же пол по часовой даёт тот же результат', () => {
    const ccw = rebuildCovers({
      covers: [rect(10, 10, 390, 290)],
      coverHoles: [],
      rooms: BOX_ROOM,
      walls: BOX_WALLS,
    });
    const cw = rebuildCovers({
      covers: [[...rect(10, 10, 390, 290)].reverse()],
      coverHoles: [],
      rooms: [[...BOX_ROOM[0]!].reverse()],
      walls: [[...BOX_WALLS[0]!].reverse()],
    });
    expect(cw.covers).toEqual(ccw.covers);
  });

  it('отрицательные координаты обрабатываются так же, как положительные', () => {
    const result = rebuildCovers({
      covers: [rect(-390, -290, -10, -10)],
      coverHoles: [],
      rooms: [rect(-390, -290, -10, -10)],
      walls: [rect(-400, -300, 0, 0)],
    });
    expect(result.covers).toHaveLength(1);
    expect(result.covers[0]!.outline).toEqual(rect(-390, -290, -10, -10));
    expect(contourArea(result.covers[0]!.outline)).toBeGreaterThan(0);
  });

  it('вход не мутируется, выход не делит объекты вершин со входом', () => {
    const input = {
      covers: [rect(10, 10, 390, 290)],
      coverHoles: [rect(100, 100, 200, 200)],
      rooms: BOX_ROOM,
      walls: BOX_WALLS,
    };
    const snapshot = JSON.stringify(input);
    const result = rebuildCovers(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result.covers[0]!.outline[0]).not.toBe(input.covers[0]![0]);
  });

  it('не-конечные координаты: пустой результат без исключения', () => {
    const empty = { covers: [], softFail: false };
    expect(rebuildCovers({ covers: [NAN_CONTOUR], coverHoles: [], rooms: BOX_ROOM, walls: BOX_WALLS })).toEqual(empty);
    expect(rebuildCovers({ covers: [INFINITE_CONTOUR], coverHoles: [], rooms: BOX_ROOM, walls: BOX_WALLS })).toEqual(
      empty,
    );
    // Не-конечные комнаты — граница, за которую не выйти, исчезает вместе с полом.
    expect(
      rebuildCovers({ covers: [rect(10, 10, 390, 290)], coverHoles: [], rooms: [NAN_CONTOUR], walls: BOX_WALLS }),
    ).toEqual(empty);
    // А не-конечный пол-вычитание просто выбрасывается как негодный контур: пол остаётся без дырки.
    const withNanHole = rebuildCovers({
      covers: [rect(10, 10, 390, 290)],
      coverHoles: [NAN_CONTOUR],
      rooms: BOX_ROOM,
      walls: BOX_WALLS,
    });
    expect(withNanHole.covers).toEqual([{ outline: rect(10, 10, 390, 290), holes: [] }]);
    expect(withNanHole.softFail).toBe(false);
  });

  it('обрыв обхода: softFail = true, уцелевшие куски остаются в результате', () => {
    // Регресс, найденный фаззингом и минимизированный до явных координат: самопересекающийся пол, у которого
    // вершина стоит в одном кванте (0.001 см) от чужого ребра. Точка пересечения после квантования слипается
    // с существующей вершиной, окрестность вырождается, и в одной fill-группе остаётся fixed-ребро без
    // продолжения — обход по экстремальному углу упирается в вершину без соседа (`contoursFromGroup`).
    // Контракт: исключения нет, сломанная группа пропущена, флаг доходит до вызывающего (движок логирует, 0069).
    const tangled = [
      { x: 0, y: 0 },
      { x: 50, y: 100 },
      { x: 50, y: 0 },
      { x: 99.999, y: 150 },
      { x: 0.001, y: 50 },
    ];
    const wedge = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 75, y: 0 },
    ];
    const result = rebuildCovers({
      covers: [tangled, wedge],
      coverHoles: [],
      rooms: [rect(-500, -500, 500, 500)],
      walls: [rect(-600, -600, 600, 600)],
    });
    expect(result.softFail).toBe(true);
    expect(result.covers.length).toBeGreaterThan(0);
    for (const cover of result.covers) {
      expect(contourArea(cover.outline)).toBeGreaterThan(0);
      for (const point of cover.outline) expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  });

  it('куски полов не делят объекты вершин: два касающихся пола — разные объекты точек на общем ребре', () => {
    const result = rebuildCovers({
      covers: [rect(10, 10, 200, 290), rect(200, 10, 390, 290)],
      coverHoles: [],
      rooms: BOX_ROOM,
      walls: BOX_WALLS,
    });
    expect(result.covers).toHaveLength(2);
    const [first, second] = [result.covers[0]!.outline, result.covers[1]!.outline];
    // Вершины (200, 10) и (200, 290) есть у обоих полов — но это разные объекты: снимок документа
    // замораживает куски независимо друг от друга.
    expect(first.map(point => `${point.x},${point.y}`)).toContain('200,10');
    expect(second.map(point => `${point.x},${point.y}`)).toContain('200,10');
    for (const point of first) for (const other of second) expect(point).not.toBe(other);
  });

  it('property: полы — валидные полигоны против часовой без NaN; повторный прогон на выходе стабилен', () => {
    const rooms = [rect(-13_000, -13_000, 13_000, 13_000)];
    const walls = [rect(-13_100, -13_100, 13_100, 13_100)];
    const key = (covers: readonly CoverShape[]): string[] =>
      covers.map(cover => cover.outline.map(p => `${p.x},${p.y}`).join(' ')).sort();
    fc.assert(
      fc.property(fc.array(arbConvexPolygon, { minLength: 1, maxLength: 3 }), polygons => {
        const first = rebuildCovers({ covers: polygons, coverHoles: [], rooms, walls });
        for (const cover of first.covers) {
          expect(contourArea(cover.outline)).toBeGreaterThan(0);
          expect(contourValid(cover.outline)).toBe(true);
          expect(contourSelfIntersected(cover.outline)).toBe(false);
          for (const p of cover.outline) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
          for (const hole of cover.holes) expect(contourArea(hole)).toBeLessThan(0);
        }
        const second = rebuildCovers({
          covers: first.covers.map(cover => cover.outline),
          coverHoles: first.covers.flatMap(cover => cover.holes),
          rooms,
          walls,
        });
        expect(key(second.covers)).toEqual(key(first.covers));
      }),
      { ...fcParams, numRuns: 100 },
    );
  });
});
