import { contourFaces } from '../document/geometry/areas/areaEdges';
import { triangulateContours } from '../document/geometry/triangulate/triangulateContours';
import type { Id } from '../document/id';
import type { Area, Cut, PlanPosition } from '../document/PlannerDocument';
import { type AreaGeometry, type AreaRoom, type CutGeometry, derivedAreas, derivedCuts } from './derivedAreas';
import { createTriangleResolver } from './derivedRegions';
import { coordinateKey } from './normalizeIds';

const at = (x: number, y: number): PlanPosition => ({ x, y });
const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  at(x0, y0),
  at(x1, y0),
  at(x1, y1),
  at(x0, y1),
];

const idOfPoint = (point: PlanPosition): Id => `k${point.x}_${point.y}`;
const idsOf = (points: readonly PlanPosition[]): Id[] => points.map(idOfPoint);
const index = (...groups: readonly PlanPosition[][]): Map<string, Id> =>
  new Map(groups.flat().map(point => [coordinateKey(point), idOfPoint(point)]));

const area = (id: Id, points: readonly PlanPosition[], height: number): AreaGeometry => ({
  record: { id, points: idsOf(points), height } satisfies Area,
  positions: points,
});

const asRoom = (roomId: Id, outline: readonly PlanPosition[], ceilingHeight: number): AreaRoom => ({
  roomId,
  outline,
  ceilingHeight,
});

/** Триангуляция контуров этажа с рёбрами зон как cut-парами — ровно то, что подаёт `rebuildFloor`. */
const triangulate = (
  outer: readonly PlanPosition[][],
  inner: readonly PlanPosition[][],
  areas: readonly AreaGeometry[],
) =>
  triangulateContours({
    outer,
    inner,
    cutPairs: areas.flatMap(entry =>
      (entry.positions ?? []).map(
        (point, i, all) => [point, all[(i + 1) % all.length]!] as [PlanPosition, PlanPosition],
      ),
    ),
  });

describe('derivedAreas — крышки зон', () => {
  const roomRect = rect(0, 0, 400, 300);
  /** Зона по трём углам комнаты: диагональ идёт через интерьер, два ребра ложатся по стенам. */
  const corner = [at(0, 0), at(400, 0), at(400, 300)];

  const run = (areas: readonly AreaGeometry[], rooms: readonly AreaRoom[] = [asRoom('r1', roomRect, 260)]) => {
    const warnings: string[] = [];
    const triangulation = triangulate([], [roomRect], areas);
    const resolver = createTriangleResolver(triangulation, index(roomRect, corner), () =>
      warnings.push('missing vertex'),
    );
    const result = derivedAreas({
      areas,
      rooms,
      triangulation,
      resolver,
      floorId: 'f1',
      warn: message => warnings.push(message),
    });
    return { areas: result, warnings, triangulation };
  };

  it('крышка набирается целыми группами разреза: треугольники по id точек, обвод — хранимый', () => {
    const { areas, warnings } = run([area('ar1', corner, 100)]);
    expect(warnings).toEqual([]);
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ areaId: 'ar1', roomId: 'r1', outline: idsOf(corner), height: 100 });
    expect(areas[0]!.triangles.length).toBeGreaterThan(0);
    for (const triangle of areas[0]!.triangles) for (const id of triangle) expect(idsOf(corner)).toContain(id);
  });

  it('вторая половина комнаты крышки не получает: группа за диагональю зоне не принадлежит', () => {
    const { areas, triangulation } = run([area('ar1', corner, 100)]);
    const interior = triangulation.groups.filter(group => !group.fill).flatMap(group => group.triangles).length;
    expect(areas[0]!.triangles.length).toBeLessThan(interior);
  });

  it('две зоны: каждая забирает свои группы, порядок выхода — порядок `layout.areas`', () => {
    const second = [at(0, 0), at(400, 300), at(0, 300)];
    const { areas } = run([area('ar1', corner, 100), area('ar2', second, 150)]);
    expect(areas.map(entry => entry.areaId)).toEqual(['ar1', 'ar2']);
    const shared = areas[0]!.triangles.filter(triangle =>
      areas[1]!.triangles.some(other => other.join() === triangle.join()),
    );
    expect(shared).toEqual([]);
  });

  it('зона вне комнат: `roomId` = null', () => {
    const { areas } = run([area('ar1', corner, 100)], [asRoom('r1', rect(1000, 1000, 1100, 1100), 200)]);
    expect(areas[0]!.roomId).toBeNull();
  });

  it('зона с пропавшим id точки — warn и пропуск', () => {
    const { areas, warnings } = run([{ record: { id: 'ar1', points: ['a'], height: 100 }, positions: null }]);
    expect(areas).toEqual([]);
    expect(warnings).toEqual(['rebuild: area ar1 has a point without a record on floor f1']);
  });

  it('зона без единой группы (лежит в теле стены) — warn и пропуск', () => {
    const wall = rect(0, 0, 400, 300);
    const inside = rect(100, 100, 200, 200);
    const areas = [area('ar1', inside, 100)];
    const triangulation = triangulate([wall], [], areas);
    const warnings: string[] = [];
    const result = derivedAreas({
      areas,
      rooms: [],
      triangulation,
      resolver: createTriangleResolver(triangulation, index(wall, inside), () => {}),
      floorId: 'f1',
      warn: message => warnings.push(message),
    });
    expect(result).toEqual([]);
    expect(warnings).toEqual(['rebuild: area ar1 has no triangle group on floor f1']);
  });

  it('без зон — пустой результат и ни одного обхода групп', () => {
    expect(run([]).areas).toEqual([]);
  });
});

describe('derivedCuts — высоты вертикальных граней', () => {
  /** Шестиугольная комната: вершины не коллинеарны, поэтому переживают `clearContour`. */
  const hexagon = [at(0, 0), at(200, -50), at(400, 0), at(400, 200), at(200, 250), at(0, 200)];
  const left = [at(0, 0), at(200, -50), at(200, 250), at(0, 200)];
  const right = [at(200, -50), at(400, 0), at(400, 200), at(200, 250)];
  const chord: Cut = { id: 'ct1', a: idOfPoint(at(200, -50)), b: idOfPoint(at(200, 250)) };

  const run = (
    cuts: readonly CutGeometry[],
    areas: readonly AreaGeometry[],
    rooms: readonly AreaRoom[] = [asRoom('r1', hexagon, 260)],
    wallHeight = 280,
  ) => {
    const warnings: string[] = [];
    const derived = derivedCuts({
      cuts,
      areas,
      rooms,
      faces: contourFaces([hexagon]),
      idOf: point => index(hexagon).get(coordinateKey(point)) ?? null,
      wallHeight,
      floorId: 'f1',
      warn: message => warnings.push(message),
    });
    return { cuts: derived, warnings };
  };

  const chordGeometry: CutGeometry = { record: chord, positions: [at(200, -50), at(200, 250)] };

  it('две соседние зоны разной высоты: `height` = max, `low` = min', () => {
    const { cuts, warnings } = run([chordGeometry], [area('ar1', left, 100), area('ar2', right, 210)]);
    expect(warnings).toEqual([]);
    expect(cuts).toEqual([{ cutId: 'ct1', a: chord.a, b: chord.b, low: 100, height: 210 }]);
  });

  it('порядок зон на результат не влияет: min/max, а не «первая/вторая»', () => {
    expect(run([chordGeometry], [area('ar1', right, 210), area('ar2', left, 100)]).cuts[0]).toMatchObject({
      low: 100,
      height: 210,
    });
  });

  it('одна соседняя зона: `low` — её высота, `height` — высота комнаты, а не глобальная', () => {
    expect(run([chordGeometry], [area('ar1', left, 100)]).cuts[0]).toEqual({
      cutId: 'ct1',
      a: chord.a,
      b: chord.b,
      low: 100,
      height: 260,
    });
  });

  it('запись без зоны-владельца (ненормализованный снимок): `low` = 0, `height` — высота комнаты', () => {
    expect(run([chordGeometry], []).cuts[0]).toMatchObject({ low: 0, height: 260 });
  });

  it('вырез вне комнат: верх — `settings.wallHeight`', () => {
    expect(run([chordGeometry], [], [], 300).cuts[0]).toMatchObject({ low: 0, height: 300 });
  });

  it('зона выше потолка комнаты даёт `low > height` — производное хранимое не чинит', () => {
    expect(run([chordGeometry], [area('ar1', left, 400)]).cuts[0]).toMatchObject({ low: 400, height: 260 });
  });

  it('вырез с пропавшим концом — warn и пропуск', () => {
    const { cuts, warnings } = run([{ record: chord, positions: null }], [area('ar1', left, 100)]);
    expect(cuts).toEqual([]);
    expect(warnings).toEqual(['rebuild: cut ct1 has an end without a record on floor f1']);
  });

  it('стеновые участки рёбер зоны высот не дают: соседями считаются только интерьерные', () => {
    // Ребро (0,0) → (200,−50) идёт по стене: записи `cuts[]` у него нет, высоту зоны оно никуда не добавляет,
    // а его середина лежит на границе комнаты, а не внутри — верх падает на `settings.wallHeight`.
    const wallEdge: CutGeometry = {
      record: { id: 'ct2', a: idOfPoint(at(0, 0)), b: idOfPoint(at(200, -50)) },
      positions: [at(0, 0), at(200, -50)],
    };
    expect(run([wallEdge], [area('ar1', left, 100)]).cuts[0]).toMatchObject({ low: 0, height: 280 });
  });
});
