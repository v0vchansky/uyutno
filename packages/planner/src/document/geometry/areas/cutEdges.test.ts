import type { PlanPosition } from '../../PlannerDocument';
import { type Triangulation, triangulateContours } from '../triangulate/triangulateContours';
import { areaPairs, contourFaces } from './areaEdges';
import { interiorCutEdges } from './cutEdges';

const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Митрованное кольцо стен: 4 квада, полость `rect(x0 + w, y0 + w, x1 − w, y1 − w)`. */
const ring = (x0: number, y0: number, x1: number, y1: number, w: number): PlanPosition[][] => {
  const o = rect(x0, y0, x1, y1);
  const i = rect(x0 + w, y0 + w, x1 - w, y1 - w);
  return [0, 1, 2, 3].map(k => {
    const j = (k + 1) % 4;
    return [o[k]!, o[j]!, i[j]!, i[k]!];
  });
};

const WALLS = ring(0, 0, 400, 300, 10);

const cutsFor = (area: readonly PlanPosition[]): Set<number> => {
  const cutPairs = areaPairs(area);
  const triangulation = triangulateContours({ outer: WALLS, inner: [], cutPairs });
  return interiorCutEdges(triangulation, cutPairs, contourFaces(WALLS));
};

describe('interiorCutEdges на литеральной триангуляции', () => {
  // Сигнатура — `Pick<Triangulation, 'vertices' | 'edges'>` именно ради таких фикстур: ветки видно без cdt2d.
  const structure = (vertices: PlanPosition[], fixed: boolean): Pick<Triangulation, 'vertices' | 'edges'> => ({
    vertices,
    edges: [{ a: 0, b: 1, fixed, triangles: [0, 1] }],
  });
  const alongX: readonly [PlanPosition, PlanPosition][] = [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  ];

  it('не-fixed ребро в набор не попадает, даже если лежит ровно на cut-паре', () => {
    const onCut = structure(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      false,
    );
    expect(interiorCutEdges(onCut, alongX, []).size).toBe(0);
    // То же ребро, помеченное fixed, — интерьерное: различает именно флаг.
    expect(interiorCutEdges({ ...onCut, edges: [{ ...onCut.edges[0]!, fixed: true }] }, alongX, []).size).toBe(1);
  });

  it('fixed-ребро, пересекающее cut-пару поперёк, интерьерным не считается (серединный тест обманулся бы)', () => {
    const across = structure(
      [
        { x: 50, y: -10 },
        { x: 50, y: 10 },
      ],
      true,
    );
    expect(interiorCutEdges(across, alongX, []).size).toBe(0);
  });

  it('fixed-ребро вдоль cut-пары, но и вдоль грани контура, — барьер, а не интерьер', () => {
    const along = structure(
      [
        { x: 20, y: 0 },
        { x: 80, y: 0 },
      ],
      true,
    );
    expect(interiorCutEdges(along, alongX, [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }]).size).toBe(0);
    expect(interiorCutEdges(along, alongX, [{ a: { x: 0, y: 50 }, b: { x: 100, y: 50 } }]).size).toBe(1);
  });

  it('рёбер нет — набор пуст без обхода', () => {
    expect(interiorCutEdges({ vertices: [], edges: [] }, alongX, []).size).toBe(0);
  });
});

describe('interiorCutEdges', () => {
  it('зона целиком внутри комнаты — все четыре её ребра интерьерные', () => {
    expect(cutsFor(rect(100, 100, 200, 200)).size).toBe(4);
  });

  it('ребро зоны, лежащее по стене, барьером остаётся: интерьерных рёбер на одно меньше', () => {
    expect(cutsFor(rect(10, 100, 200, 200)).size).toBe(3);
  });

  it('зона, совпавшая с комнатой по всем сторонам, интерьерных рёбер не даёт вовсе', () => {
    expect(cutsFor(rect(10, 10, 390, 290)).size).toBe(0);
  });

  it('без cut-пар набор пуст — обхода рёбер не происходит', () => {
    const triangulation = triangulateContours({ outer: WALLS, inner: [] });
    expect(interiorCutEdges(triangulation, [], contourFaces(WALLS)).size).toBe(0);
  });

  it('найденные рёбра действительно лежат вдоль рёбер зоны, а не поперёк', () => {
    const area = rect(100, 100, 200, 200);
    const cutPairs = areaPairs(area);
    const triangulation = triangulateContours({ outer: WALLS, inner: [], cutPairs });
    for (const index of interiorCutEdges(triangulation, cutPairs, contourFaces(WALLS))) {
      const edge = triangulation.edges[index]!;
      const a = triangulation.vertices[edge.a]!;
      const b = triangulation.vertices[edge.b]!;
      const horizontal = a.y === b.y && (a.y === 100 || a.y === 200);
      const vertical = a.x === b.x && (a.x === 100 || a.x === 200);
      expect(horizontal || vertical).toBe(true);
      expect(edge.fixed).toBe(true);
    }
  });

  it('дробление cut-пары T-стыком: обе половинки остаются интерьерными', () => {
    // Зона с вершиной посередине верхнего ребра — ребро приходит в триангуляцию двумя отрезками.
    const area = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 150, y: 200 },
      { x: 100, y: 200 },
    ];
    expect(cutsFor(area).size).toBe(5);
  });

  it('без граней контуров всякое cut-ребро интерьерное', () => {
    const area = rect(10, 10, 390, 290);
    const cutPairs = areaPairs(area);
    const triangulation = triangulateContours({ outer: WALLS, inner: [], cutPairs });
    expect(interiorCutEdges(triangulation, cutPairs, []).size).toBeGreaterThan(0);
  });
});
