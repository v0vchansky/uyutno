import type { Id } from '../document/id';
import type { ContourKind, Cover, PlanPosition } from '../document/PlannerDocument';
import { type CoverGeometry, type CoverRoom, derivedCovers } from './derivedCovers';
import { coordinateKey } from './normalizeIds';

const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Ключи всех перечисленных координат → синтетические id `k<x>_<y>`, как их видел бы `layout.points`. */
const index = (...groups: readonly (readonly PlanPosition[])[]): Map<string, Id> => {
  const map = new Map<string, Id>();
  for (const points of groups) for (const point of points) map.set(coordinateKey(point), `k${point.x}_${point.y}`);
  return map;
};

const idsOf = (points: readonly PlanPosition[]): Id[] => points.map(point => `k${point.x}_${point.y}`);

const cover = (id: Id, kind: ContourKind, points: readonly PlanPosition[], ceilingHidden = false): CoverGeometry => ({
  record: { id, kind, points: idsOf(points), ceilingHidden } satisfies Cover,
  positions: points,
});

const asRoom = (roomId: Id, outline: readonly PlanPosition[], ceilingHeight: number): CoverRoom => ({
  roomId,
  outline,
  ceilingHeight,
});

const run = (covers: readonly CoverGeometry[], rooms: readonly CoverRoom[] = [], wallHeight = 280) => {
  const warnings: string[] = [];
  const result = derivedCovers({
    covers,
    rooms,
    idByKey: index(...covers.map(entry => entry.positions ?? []), ...rooms.map(room => [...room.outline])),
    wallHeight,
    floorId: 'f1',
    warn: message => warnings.push(message),
  });
  return { ...result, warnings };
};

describe('derivedCovers — пол и его потолок', () => {
  const roomRect = rect(0, 0, 400, 300);

  it('пол в комнате: треугольники по id точек, площадь обвода, комната по точке-представителю', () => {
    const { covers, ceilings, warnings } = run([cover('cv1', 'outer', roomRect)], [asRoom('r1', roomRect, 260)]);
    expect(warnings).toEqual([]);
    expect(covers).toHaveLength(1);
    expect(covers[0]).toMatchObject({
      coverId: 'cv1',
      roomId: 'r1',
      outline: idsOf(roomRect),
      holes: [],
      area: 120_000,
    });
    expect(covers[0]!.triangles.length).toBeGreaterThan(0);
    for (const triangle of covers[0]!.triangles) for (const id of triangle) expect(idsOf(roomRect)).toContain(id);
    expect(ceilings).toEqual([{ coverId: 'cv1', height: 260, hidden: false }]);
  });

  it('потолок один на пол и повторяет его форму ссылкой: высота — с комнаты, `hidden` — с пола', () => {
    const left = rect(0, 0, 200, 300);
    const right = rect(200, 0, 400, 300);
    const { covers, ceilings } = run(
      [cover('cv1', 'outer', left, true), cover('cv2', 'outer', right)],
      [asRoom('r1', roomRect, 320)],
    );
    expect(covers.map(entry => entry.coverId)).toEqual(['cv1', 'cv2']);
    // Оба multi-material пола одной комнаты — с её высотой; флаг видимости у каждого свой.
    expect(ceilings).toEqual([
      { coverId: 'cv1', height: 320, hidden: true },
      { coverId: 'cv2', height: 320, hidden: false },
    ]);
  });

  it('дырка в полу: вложенность пересчитана, площадь за вычетом дырки, треугольников в дырке нет', () => {
    const hole = rect(100, 100, 200, 200);
    const { covers } = run(
      [cover('cv1', 'outer', roomRect), cover('cv2', 'inner', hole)],
      [asRoom('r1', roomRect, 280)],
    );
    expect(covers).toHaveLength(1);
    expect(covers[0]!.holes).toEqual([idsOf(hole)]);
    expect(covers[0]!.area).toBe(120_000 - 10_000);
    const inHole = covers[0]!.triangles.filter(triangle => triangle.every(id => idsOf(hole).includes(id)));
    expect(inHole).toEqual([]);
  });

  it('пол внутри дырки другого пола достаётся внутреннему, а не хозяину дырки', () => {
    const hole = rect(100, 100, 300, 200);
    const nested = rect(120, 120, 280, 180);
    const { covers } = run(
      [cover('cv1', 'outer', roomRect), cover('cv2', 'inner', hole), cover('cv3', 'outer', nested)],
      [asRoom('r1', roomRect, 280)],
    );
    expect(covers.map(entry => entry.coverId)).toEqual(['cv1', 'cv3']);
    const nestedIds = idsOf(nested);
    expect(covers[1]!.triangles.every(triangle => triangle.every(id => nestedIds.includes(id)))).toBe(true);
    expect(covers[0]!.triangles.some(triangle => triangle.every(id => nestedIds.includes(id)))).toBe(false);
  });

  it('пол вне комнат: `roomId` = null, высота потолка — `settings.wallHeight`', () => {
    const { covers, ceilings } = run(
      [cover('cv1', 'outer', roomRect)],
      [asRoom('r1', rect(1000, 1000, 1100, 1100), 200)],
    );
    expect(covers[0]!.roomId).toBeNull();
    expect(ceilings).toEqual([{ coverId: 'cv1', height: 280, hidden: false }]);
  });

  it('без полов и без обводов — пустой результат, без предупреждений', () => {
    expect(run([])).toEqual({ covers: [], ceilings: [], warnings: [] });
    const holeOnly = run([cover('cv1', 'inner', rect(0, 0, 10, 10))]);
    expect(holeOnly).toEqual({ covers: [], ceilings: [], warnings: [] });
  });
});

describe('derivedCovers — нарушенные инварианты (warn + пропуск, без исключений)', () => {
  const roomRect = rect(0, 0, 400, 300);

  it('пол с пропавшим id точки', () => {
    const { covers, warnings } = run([
      { record: { id: 'cv1', kind: 'outer', points: ['a', 'b'], ceilingHidden: false }, positions: null },
    ]);
    expect(covers).toEqual([]);
    expect(warnings).toEqual(['rebuild: cover cv1 has a point without a record on floor f1']);
  });

  it('пол короче трёх вершин', () => {
    const { covers, warnings } = run([
      cover('cv1', 'outer', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ]);
    expect(covers).toEqual([]);
    expect(warnings).toEqual(['rebuild: cover cv1 has less than 3 points on floor f1']);
  });

  it('пол без единой fill-группы (обвод целиком выеден дыркой) — пропущен вместе с потолком', () => {
    const { covers, ceilings, warnings } = run([cover('cv1', 'outer', roomRect), cover('cv2', 'inner', roomRect)]);
    expect(covers).toEqual([]);
    expect(ceilings).toEqual([]);
    expect(warnings).toEqual(['rebuild: cover cv1 has no fill group on floor f1']);
  });

  it('вершина триангуляции без точки этажа: треугольники пропущены, предупреждение одно', () => {
    const warnings: string[] = [];
    const idByKey = index(roomRect);
    idByKey.delete(coordinateKey({ x: 400, y: 300 }));
    const { covers } = derivedCovers({
      covers: [cover('cv1', 'outer', roomRect)],
      rooms: [asRoom('r1', roomRect, 280)],
      idByKey,
      wallHeight: 280,
      floorId: 'f1',
      warn: message => warnings.push(message),
    });
    expect(covers[0]!.triangles.length).toBeLessThan(2);
    expect(warnings).toEqual([
      'rebuild: cover triangulation vertex without a point id on floor f1 — layout is not normalized',
    ]);
  });
});
