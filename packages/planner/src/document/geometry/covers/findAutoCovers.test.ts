import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { contourArea } from '../predicates/contourArea';
import { locatePointInContour, pointInContour } from '../predicates/pointInContour';
import { fcParams } from '../testing/arbitraries';
import { findAutoCovers } from './findAutoCovers';
import type { CoverShape } from './coverShape';

const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Обводы авто-полов, отсортированные по первой вершине: порядок групп триангуляции контрактом не является. */
const outlines = (covers: readonly CoverShape[]): PlanPosition[][] =>
  covers.map(cover => cover.outline).sort((a, b) => a[0]!.x - b[0]!.x || a[0]!.y - b[0]!.y);

/** Точка накрыта полом: внутри обвода и вне всех его вырезов. */
const covered = (cover: CoverShape, point: PlanPosition): boolean =>
  pointInContour(point, cover.outline) && !cover.holes.some(hole => pointInContour(point, hole));

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

/** Ручной пол внутри `BOX_ROOM`: кратен 20 см, заведомо валиден (`contourValid`). */
const arbManualCover: fc.Arbitrary<PlanPosition[]> = fc
  .record({
    x: fc.integer({ min: 1, max: 17 }),
    y: fc.integer({ min: 1, max: 12 }),
    w: fc.integer({ min: 2, max: 6 }),
    h: fc.integer({ min: 2, max: 6 }),
  })
  .map(({ x, y, w, h }) => rect(x * 20, y * 20, Math.min((x + w) * 20, 380), Math.min((y + h) * 20, 280)));

describe('findAutoCovers', () => {
  it('комната без полов застилается целиком; обвод против часовой', () => {
    const result = findAutoCovers({ rooms: BOX_ROOM, walls: BOX_WALLS, covers: [] });
    expect(result.softFail).toBe(false);
    expect(result.covers).toHaveLength(1);
    expect(result.covers[0]!.outline).toEqual(rect(10, 10, 390, 290));
    expect(result.covers[0]!.holes).toEqual([]);
    expect(contourArea(result.covers[0]!.outline)).toBeGreaterThan(0);
  });

  it('ручной пол на половине комнаты — авто-пол только на свободном месте', () => {
    const result = findAutoCovers({ rooms: BOX_ROOM, walls: BOX_WALLS, covers: [rect(10, 10, 200, 290)] });
    expect(outlines(result.covers)).toEqual([rect(200, 10, 390, 290)]);
  });

  it('ручной пол накрыл комнату целиком — авто-пола нет', () => {
    const result = findAutoCovers({ rooms: BOX_ROOM, walls: BOX_WALLS, covers: [rect(10, 10, 390, 290)] });
    expect(result.covers).toEqual([]);
  });

  it('вырез под лестницу внутри ручного пола авто-полом не зарастает: занята вся область обвода', () => {
    // Ручной пол rect(10,10,200,290) с вырезом rect(60,60,140,140); в `covers` идёт только обвод.
    const result = findAutoCovers({ rooms: BOX_ROOM, walls: BOX_WALLS, covers: [rect(10, 10, 200, 290)] });
    expect(outlines(result.covers)).toEqual([rect(200, 10, 390, 290)]);
    // Центр выреза не покрыт ни одним авто-полом — иначе дырка бы заросла.
    for (const cover of result.covers) expect(covered(cover, { x: 100, y: 100 })).toBe(false);
  });

  it('вложенные комнаты без стен: авто-пол не дублирует ручной (регресс на глубины `classifyFill`)', () => {
    // Гейт `inside(bound) >= inside(subtract)` тут даёт «2 комнаты против 1 пола» и пропускает дубль —
    // его снимает отбор области по точке-представителю.
    const result = findAutoCovers({
      rooms: [rect(0, 0, 400, 300), rect(100, 100, 300, 200)],
      walls: [],
      covers: [rect(120, 120, 280, 180)],
    });
    expect(outlines(result.covers)).toEqual([rect(0, 0, 400, 300), rect(100, 100, 300, 200)]);
    // Ни один авто-пол не накрывает область ручного.
    for (const cover of result.covers) expect(covered(cover, { x: 200, y: 150 })).toBe(false);
  });

  it('ручной пол ровно по границе комнаты (совпадение контуров) — авто-пола нет', () => {
    const result = findAutoCovers({
      rooms: [rect(10, 10, 390, 290)],
      walls: BOX_WALLS,
      covers: [rect(10, 10, 390, 290)],
    });
    expect(result.covers).toEqual([]);
  });

  it('две комнаты — по авто-полу на каждую, тело перегородки не застилается', () => {
    const result = findAutoCovers({
      rooms: [rect(10, 10, 200, 290), rect(210, 10, 390, 290)],
      walls: [rect(0, 0, 400, 300), rect(200, 10, 210, 290)],
      covers: [],
    });
    expect(outlines(result.covers)).toEqual([rect(10, 10, 200, 290), rect(210, 10, 390, 290)]);
  });

  it('две комнаты с общим ребром (перегородки нет): два авто-пола, а не один слитый (separateContacting)', () => {
    // Между комнатами нет тела стены — fill-группы касаются по x = 200 и слились бы в одно тело
    // при `separateContacting: false`. Слияние касающихся полов — дело `mergeCovers`, не заливки.
    const result = findAutoCovers({
      rooms: [rect(10, 10, 200, 290), rect(200, 10, 390, 290)],
      walls: [rect(0, 0, 400, 300)],
      covers: [],
    });
    expect(result.covers).toHaveLength(2);
    expect(outlines(result.covers)).toEqual([rect(10, 10, 200, 290), rect(200, 10, 390, 290)]);
  });

  it('комната в комнате: у внешней авто-пол с вырезом, у внутренней — свой', () => {
    const result = findAutoCovers({
      rooms: [rect(10, 10, 390, 290), rect(110, 110, 240, 190)],
      walls: [rect(0, 0, 400, 300), rect(100, 100, 250, 200)],
      covers: [],
    });
    expect(outlines(result.covers)).toEqual([rect(10, 10, 390, 290), rect(110, 110, 240, 190)]);
    const outer = result.covers.find(cover => cover.holes.length === 1)!;
    expect(outer.holes[0]).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 250, y: 200 },
      { x: 250, y: 100 },
    ]);
  });

  it('«Комната по точкам» без тел стен: ручной пол не дублируется авто-полом (расхождение с референсом)', () => {
    // Без тел стен гейт `classifyFill` вырождается в «1 комната против 1 пола» и пропустил бы дубль —
    // занятое место отсекает отбор области по точке-представителю.
    const result = findAutoCovers({
      rooms: [rect(0, 0, 400, 300)],
      walls: [],
      covers: [rect(0, 0, 200, 300)],
    });
    expect(outlines(result.covers)).toEqual([rect(200, 0, 400, 300)]);
  });

  it('комнат нет — авто-полов нет', () => {
    expect(findAutoCovers({ rooms: [], walls: BOX_WALLS, covers: [] }).covers).toEqual([]);
    expect(findAutoCovers({ rooms: [], walls: [], covers: [] })).toEqual({ covers: [], softFail: false });
  });

  it('вырожденные комнаты отбрасываются: < 3 точек, площадь < 50 см², сливер', () => {
    const result = findAutoCovers({
      rooms: [
        [
          { x: 20, y: 20 },
          { x: 30, y: 20 },
        ],
        rect(20, 20, 25, 25),
        rect(20, 20, 380, 20.5),
      ],
      walls: BOX_WALLS,
      covers: [],
    });
    expect(result.covers).toEqual([]);
  });

  it('ориентация входа не важна: те же контуры по часовой дают тот же результат', () => {
    const ccw = findAutoCovers({ rooms: BOX_ROOM, walls: BOX_WALLS, covers: [rect(10, 10, 200, 290)] });
    const cw = findAutoCovers({
      rooms: [[...BOX_ROOM[0]!].reverse()],
      walls: [[...BOX_WALLS[0]!].reverse()],
      covers: [[...rect(10, 10, 200, 290)].reverse()],
    });
    expect(cw.covers).toEqual(ccw.covers);
  });

  it('отрицательные координаты обрабатываются так же, как положительные', () => {
    const result = findAutoCovers({
      rooms: [rect(-390, -290, -10, -10)],
      walls: [rect(-400, -300, 0, 0)],
      covers: [],
    });
    expect(result.covers).toHaveLength(1);
    expect(result.covers[0]!.outline).toEqual(rect(-390, -290, -10, -10));
  });

  it('вход не мутируется, выход не делит объекты вершин со входом', () => {
    const input = { rooms: BOX_ROOM, walls: BOX_WALLS, covers: [rect(10, 10, 200, 290)] };
    const snapshot = JSON.stringify(input);
    const result = findAutoCovers(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result.covers[0]!.outline[0]).not.toBe(input.rooms[0]![0]);
  });

  it('два касающихся авто-пола не делят объекты вершин: куски полов замораживаются независимо', () => {
    const result = findAutoCovers({
      rooms: [rect(10, 10, 200, 290), rect(200, 10, 390, 290)],
      walls: BOX_WALLS,
      covers: [],
    });
    expect(result.covers).toHaveLength(2);
    const [first, second] = [result.covers[0]!.outline, result.covers[1]!.outline];
    // Общее ребро x = 200 даёт полам общие координаты — но не общие объекты точек.
    for (const point of first) for (const other of second) expect(point).not.toBe(other);
  });

  it('не-конечные координаты комнат: пустой результат без исключения', () => {
    expect(findAutoCovers({ rooms: [NAN_CONTOUR], walls: BOX_WALLS, covers: [] })).toEqual({
      covers: [],
      softFail: false,
    });
    expect(findAutoCovers({ rooms: [INFINITE_CONTOUR], walls: BOX_WALLS, covers: [] })).toEqual({
      covers: [],
      softFail: false,
    });
    // Не-конечная стена в триангуляцию не попадает (негодный контур) — комната застилается целиком.
    expect(outlines(findAutoCovers({ rooms: BOX_ROOM, walls: [NAN_CONTOUR], covers: [] }).covers)).toEqual([
      rect(10, 10, 390, 290),
    ]);
    // А не-конечный ручной пол авто-пола не даёт: из триангуляции он выброшен, но отбор области его всё ещё
    // видит (ray casting не толкует `NaN`), и место считается занятым.
    expect(findAutoCovers({ rooms: BOX_ROOM, walls: BOX_WALLS, covers: [NAN_CONTOUR] })).toEqual({
      covers: [],
      softFail: false,
    });
  });

  it('property: авто-пол не залезает в ручной и не выходит за комнаты', () => {
    fc.assert(
      fc.property(fc.array(arbManualCover, { minLength: 0, maxLength: 3 }), covers => {
        const result = findAutoCovers({ rooms: BOX_ROOM, walls: BOX_WALLS, covers });
        for (const auto of result.covers) {
          expect(contourArea(auto.outline)).toBeGreaterThan(0);
          for (const point of [...auto.outline, ...auto.holes.flat()]) {
            expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
            // Строго внутри ручного пола вершины авто-пола не бывает: они лежат на его границе.
            for (const manual of covers) expect(pointInContour(point, manual)).toBe(false);
            expect(locatePointInContour(point, BOX_ROOM[0]!)).not.toBe('outside');
          }
        }
      }),
      fcParams,
    );
  });
});
