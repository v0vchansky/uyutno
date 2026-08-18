import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { contourArea, contourValid } from '../predicates/contourArea';
import { contourSelfIntersected } from '../predicates/contourSelfIntersected';
import { arbConvexPolygon, fcParams } from '../testing/arbitraries';
import { type ContourGroup, type RebuildContoursResult, rebuildContours } from './rebuildContours';

const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Митрованное кольцо стен: 4 квада с общими вершинами, как коммитит инструмент «Стены». */
const ring = (x0: number, y0: number, x1: number, y1: number, w: number): PlanPosition[][] => {
  const o = rect(x0, y0, x1, y1);
  const i = rect(x0 + w, y0 + w, x1 - w, y1 - w);
  return [0, 1, 2, 3].map(k => {
    const j = (k + 1) % 4;
    return [o[k]!, o[j]!, i[j]!, i[k]!];
  });
};

const positions = (result: RebuildContoursResult, loop: readonly number[]): PlanPosition[] =>
  loop.map(index => result.triangulation.vertices[index]!);
const outlineOf = (result: RebuildContoursResult, group: ContourGroup): PlanPosition[] =>
  positions(result, group.outline);
/** Обводы групп, отсортированные по x первой вершины — порядок групп контрактом не является (его задаёт sortByArea в normalize). */
const outlines = (result: RebuildContoursResult, groups: readonly ContourGroup[]): PlanPosition[][] =>
  groups.map(group => outlineOf(result, group)).sort((a, b) => a[0]!.x - b[0]!.x || a[0]!.y - b[0]!.y);

describe('rebuildContours', () => {
  it('4 квада ленты → одно тело стен (слитые fill-группы) и одна комната; ориентация и старт каноничны', () => {
    const result = rebuildContours({ outer: ring(0, 0, 400, 300, 10), inner: [] });
    expect(result.softFail).toBe(false);
    expect(result.walls).toHaveLength(1);
    expect(result.rooms).toHaveLength(1);
    expect(outlineOf(result, result.walls[0]!)).toEqual(rect(0, 0, 400, 300));
    expect(result.walls[0]!.holes.map(h => positions(result, h))).toEqual([
      [
        { x: 10, y: 10 },
        { x: 10, y: 290 },
        { x: 390, y: 290 },
        { x: 390, y: 10 },
      ],
    ]);
    expect(outlineOf(result, result.rooms[0]!)).toEqual(rect(10, 10, 390, 290));
    expect(result.walls[0]!.triangles).toHaveLength(8);
    expect(result.rooms[0]!.triangles).toHaveLength(2);
    // Обводы против часовой (> 0), дырки по часовой (< 0).
    expect(contourArea(outlineOf(result, result.walls[0]!))).toBeGreaterThan(0);
    expect(contourArea(positions(result, result.walls[0]!.holes[0]!))).toBeLessThan(0);
  });

  it('separateContacting: касающиеся fill-группы не сливаются, дырки остаются у своих групп', () => {
    const merged = rebuildContours({ outer: ring(0, 0, 400, 300, 10), inner: [] });
    const separate = rebuildContours({ outer: ring(0, 0, 400, 300, 10), inner: [], separateContacting: true });
    expect(merged.walls).toHaveLength(1);
    expect(separate.walls).toHaveLength(4);
    expect(separate.rooms).toHaveLength(1);
  });

  it('вход по часовой стрелке даёт тот же результат — ориентация входа не важна', () => {
    const cw = ring(0, 0, 400, 300, 10).map(quad => [...quad].reverse());
    const a = rebuildContours({ outer: ring(0, 0, 400, 300, 10), inner: [] });
    const b = rebuildContours({ outer: cw, inner: [] });
    expect(outlineOf(b, b.rooms[0]!)).toEqual(outlineOf(a, a.rooms[0]!));
    expect(outlineOf(b, b.walls[0]!)).toEqual(outlineOf(a, a.walls[0]!));
  });

  it('внутренняя стенка делит комнату надвое (T-стыки на гранях)', () => {
    const result = rebuildContours({ outer: [...ring(0, 0, 400, 300, 10), rect(195, 10, 205, 290)], inner: [] });
    expect(result.walls).toHaveLength(1);
    expect(outlines(result, result.rooms)).toEqual([rect(10, 10, 195, 290), rect(205, 10, 390, 290)]);
  });

  it('комната в комнате: внешняя получает дырку по членству в группе, внутренняя — отдельная комната', () => {
    const result = rebuildContours({
      outer: [...ring(0, 0, 400, 300, 10), ...ring(100, 100, 250, 200, 10)],
      inner: [],
    });
    expect(result.walls).toHaveLength(2);
    expect(result.rooms).toHaveLength(2);
    const outerRoom = result.rooms.find(room => room.holes.length === 1)!;
    expect(outlineOf(result, outerRoom)).toEqual(rect(10, 10, 390, 290));
    expect(positions(result, outerRoom.holes[0]!)).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 250, y: 200 },
      { x: 250, y: 100 },
    ]);
  });

  it('висячая стена внутри комнаты — вырез в обводе, ложных контуров нет; отдельно стоящий квад — просто тело', () => {
    const result = rebuildContours({
      outer: [...ring(0, 0, 400, 300, 10), rect(195, 10, 205, 150), rect(500, 0, 600, 10)],
      inner: [],
    });
    expect(result.walls).toHaveLength(2);
    expect(result.rooms).toHaveLength(1);
    expect(outlineOf(result, result.rooms[0]!)).toEqual([
      { x: 10, y: 10 },
      { x: 195, y: 10 },
      { x: 195, y: 150 },
      { x: 205, y: 150 },
      { x: 205, y: 10 },
      { x: 390, y: 10 },
      { x: 390, y: 290 },
      { x: 10, y: 290 },
    ]);
  });

  it('незамкнутый контур стен (три стороны) — комнаты нет: полость касается выпуклой оболочки', () => {
    const result = rebuildContours({ outer: ring(0, 0, 400, 300, 10).slice(0, 3), inner: [] });
    expect(result.walls).toHaveLength(1);
    expect(result.rooms).toHaveLength(0);
  });

  it('одиночный inner («Комната по точкам») — комната без стен по объявленной полости', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
      { x: 150, y: 250 },
      { x: 0, y: 200 },
    ];
    const result = rebuildContours({ outer: [], inner: [polygon] });
    expect(result.walls).toHaveLength(0);
    expect(result.rooms).toHaveLength(1);
    expect(outlineOf(result, result.rooms[0]!)).toEqual(polygon);
  });

  it('два смежных inner с общим ребром — две комнаты (не-fill группы не сливаются через fixed-ребро)', () => {
    const result = rebuildContours({ outer: [], inner: [rect(0, 0, 100, 100), rect(100, 0, 200, 100)] });
    expect(result.rooms).toHaveLength(2);
  });

  it('стены внутри «Комнаты по точкам» остаются стенами (ближайший объемлющий контур — outer), их полость — комната', () => {
    const result = rebuildContours({ outer: ring(50, 50, 250, 200, 10), inner: [rect(0, 0, 400, 300)] });
    expect(result.walls).toHaveLength(1);
    expect(outlines(result, result.rooms)).toEqual([rect(0, 0, 400, 300), rect(60, 60, 240, 190)]);
    expect(result.rooms.find(room => room.holes.length === 1)).toBeDefined();
  });

  it('inner поверх сплошного outer той же площади вырезает его: комната есть, тела нет', () => {
    const result = rebuildContours({ outer: [rect(0, 0, 100, 300)], inner: [rect(0, 0, 100, 300)] });
    expect(result.walls).toHaveLength(0);
    expect(result.rooms).toHaveLength(1);
  });

  it('вырожденные входные контуры отбрасываются filterContours: площадь < 50, сливер, < 3 точек', () => {
    const result = rebuildContours({
      outer: [
        rect(0, 0, 5, 5),
        rect(0, 0, 400, 0.5),
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      ],
      inner: [],
    });
    expect(result.walls).toHaveLength(0);
    expect(result.rooms).toHaveLength(0);
  });

  it('вырожденная щель между стенами (contourValid) не становится комнатой и уходит в тело', () => {
    const result = rebuildContours({ outer: [...ring(0, 0, 400, 300, 10), rect(379, 10, 389, 290)], inner: [] });
    expect(result.rooms).toHaveLength(1);
    expect(outlineOf(result, result.rooms[0]!)).toEqual(rect(10, 10, 379, 290));
    expect(result.walls).toHaveLength(1);
  });

  it('самопересекающийся outer (площадь ~0) отбрасывается на входе', () => {
    const bowTie = [
      { x: 0, y: 0 },
      { x: 200, y: 100 },
      { x: 200, y: 0 },
      { x: 0, y: 100 },
    ];
    const result = rebuildContours({ outer: [bowTie], inner: [] });
    expect(result.walls).toHaveLength(0);
    expect(result.rooms).toHaveLength(0);
  });

  it('перекрывающиеся квады: точки пересечения квантованы до 0.001 и становятся вершинами обвода', () => {
    const result = rebuildContours({ outer: [rect(0, 0, 100, 10), rect(45.0004, -50, 55.0004, 50)], inner: [] });
    expect(result.walls).toHaveLength(1);
    const outline = outlineOf(result, result.walls[0]!);
    expect(outline).toHaveLength(12);
    for (const p of outline) {
      expect(Math.round(p.x * 1000) / 1000).toBe(p.x);
      expect(Math.round(p.y * 1000) / 1000).toBe(p.y);
    }
    expect(outline).toContainEqual({ x: 45, y: 0 });
  });

  it('пустой вход — пустой результат без исключений', () => {
    const result = rebuildContours({ outer: [], inner: [] });
    expect(result.walls).toEqual([]);
    expect(result.rooms).toEqual([]);
    expect(result.softFail).toBe(false);
  });

  it('property: комнаты и тела — валидные, против часовой, без самопересечений; повторный прогон на выходе стабилен', () => {
    fc.assert(
      fc.property(fc.array(arbConvexPolygon, { minLength: 1, maxLength: 4 }), polygons => {
        const first = rebuildContours({ outer: polygons.slice(0, 2), inner: polygons.slice(2) });
        const loops = [...first.walls, ...first.rooms].map(group => outlineOf(first, group));
        for (const loop of loops) {
          expect(contourArea(loop)).toBeGreaterThan(0);
          expect(contourValid(loop)).toBe(true);
          expect(contourSelfIntersected(loop)).toBe(false);
          for (const p of loop) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        }
        const second = rebuildContours({
          outer: first.walls.map(group => outlineOf(first, group)),
          inner: first.rooms.map(group => outlineOf(first, group)),
        });
        const key = (result: RebuildContoursResult) =>
          [
            ...result.walls.map(
              g =>
                `w ${outlineOf(result, g)
                  .map(p => `${p.x},${p.y}`)
                  .join(' ')}`,
            ),
            ...result.rooms.map(
              g =>
                `r ${outlineOf(result, g)
                  .map(p => `${p.x},${p.y}`)
                  .join(' ')}`,
            ),
          ].sort();
        expect(key(second)).toEqual(key(first));
      }),
      { ...fcParams, numRuns: 150 },
    );
  });
});
