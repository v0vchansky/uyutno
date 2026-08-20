import type { PlanPosition } from '../../PlannerDocument';
import { COORDINATE_QUANTUM } from '../../quantize';
import {
  type AreaEdgeSegment,
  type AreaFace,
  areaPairs,
  classifyAreaEdges,
  contourFaces,
  edgeOnFace,
  FACE_COLLINEAR_EPS,
} from './areaEdges';

const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Полость-комната 380 × 280 — грани, против которых классифицируются рёбра зоны. */
const roomFaces: AreaFace[] = contourFaces([rect(10, 10, 390, 290)]);

describe('areaPairs', () => {
  it('замкнутый обход: n точек → n рёбер, последнее — замыкающее', () => {
    const pairs = areaPairs(rect(0, 0, 100, 100));
    expect(pairs).toHaveLength(4);
    expect(pairs[3]).toEqual([
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ]);
  });

  it('треугольник — три ребра', () => {
    expect(
      areaPairs([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ]),
    ).toHaveLength(3);
  });

  it('две точки — одно ребро (замыкающее совпало бы с ним же), одна и ноль — рёбер нет', () => {
    expect(
      areaPairs([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toHaveLength(1);
    expect(areaPairs([{ x: 0, y: 0 }])).toEqual([]);
    expect(areaPairs([])).toEqual([]);
  });

  it('рёбра нулевой длины отбрасываются: `segmentsOverlay` ждёт отрезки ненулевой длины', () => {
    const pairs = areaPairs([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ]);
    expect(pairs).toHaveLength(3);
    expect(pairs.every(([a, b]) => a.x !== b.x || a.y !== b.y)).toBe(true);
  });

  it('порог вырожденности: ребро в один квант отбрасывается, чуть длиннее — остаётся', () => {
    const short = [
      { x: 0, y: 0 },
      { x: FACE_COLLINEAR_EPS, y: 0 },
    ];
    const long = [
      { x: 0, y: 0 },
      { x: FACE_COLLINEAR_EPS * 1.1, y: 0 },
    ];
    expect(areaPairs(short)).toEqual([]);
    expect(areaPairs(long)).toHaveLength(1);
  });

  it('точки переиспользуются по ссылке, вход не мутируется', () => {
    const points = rect(0, 0, 100, 100);
    const snapshot = [...points];
    const pairs = areaPairs(points);
    expect(pairs[0]![0]).toBe(points[0]);
    expect(points).toEqual(snapshot);
  });
});

describe('contourFaces', () => {
  it('грани контура — все рёбра обхода, включая замыкающее', () => {
    expect(contourFaces([rect(0, 0, 100, 50)])).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
      { a: { x: 100, y: 0 }, b: { x: 100, y: 50 } },
      { a: { x: 100, y: 50 }, b: { x: 0, y: 50 } },
      { a: { x: 0, y: 50 }, b: { x: 0, y: 0 } },
    ]);
  });

  it('грани нескольких контуров складываются в один плоский набор', () => {
    expect(contourFaces([rect(0, 0, 100, 100), rect(200, 0, 300, 100)])).toHaveLength(8);
    expect(contourFaces([])).toEqual([]);
  });
});

describe('edgeOnFace', () => {
  const face: AreaFace[] = [{ a: { x: 0, y: 0 }, b: { x: 400, y: 0 } }];

  it('ребро внутри грани — наложение', () => {
    expect(edgeOnFace({ x: 100, y: 0 }, { x: 200, y: 0 }, face)).toBe(true);
  });

  it('ребро совпало с гранью целиком — наложение', () => {
    expect(edgeOnFace({ x: 0, y: 0 }, { x: 400, y: 0 }, face)).toBe(true);
  });

  it('касание только концом грани наложением не считается', () => {
    expect(edgeOnFace({ x: 400, y: 0 }, { x: 500, y: 0 }, face)).toBe(false);
  });

  it('перпендикуляр через середину грани — не наложение (коллинеарность обязательна)', () => {
    expect(edgeOnFace({ x: 200, y: -50 }, { x: 200, y: 50 }, face)).toBe(false);
  });

  it('константа порога (ADR 0017 C3): допуск коллинеарности — шаг квантования, не `L_EPS` и не `B_EPS`', () => {
    expect(FACE_COLLINEAR_EPS).toBe(COORDINATE_QUANTUM);
    expect(FACE_COLLINEAR_EPS).toBe(0.001);
  });

  it('порог коллинеарности в литералах: полкванта — ещё грань, полтора кванта — уже интерьер', () => {
    // 0.0007 — предельный увод точки, лежащей на грани по построению, после квантования (полкванта по оси).
    expect(edgeOnFace({ x: 100, y: 0.0007 }, { x: 200, y: 0.0007 }, face)).toBe(true);
    expect(edgeOnFace({ x: 100, y: 0.0011 }, { x: 200, y: 0.0011 }, face)).toBe(false);
    // С `B_EPS = 1e-4` первый случай читался бы как интерьер, с `L_EPS = 1e-8` — тем более.
    expect(edgeOnFace({ x: 100, y: 1e-4 }, { x: 200, y: 1e-4 }, face)).toBe(true);
  });

  it('порог коллинеарности: отступ ровно в квант — ещё грань, чуть больше — уже интерьер', () => {
    const on = FACE_COLLINEAR_EPS;
    const off = FACE_COLLINEAR_EPS * 1.1;
    expect(edgeOnFace({ x: 100, y: on }, { x: 200, y: on }, face)).toBe(true);
    expect(edgeOnFace({ x: 100, y: off }, { x: 200, y: off }, face)).toBe(false);
  });

  it('пустой набор граней — ничего не совпадает', () => {
    expect(edgeOnFace({ x: 100, y: 0 }, { x: 200, y: 0 }, [])).toBe(false);
  });
});

describe('classifyAreaEdges', () => {
  const kinds = (segments: readonly AreaEdgeSegment[]): string[] => segments.map(segment => segment.kind);

  it('зона целиком внутри комнаты — все участки интерьерные, по одному на ребро', () => {
    expect(kinds(classifyAreaEdges(rect(100, 100, 200, 200), roomFaces))).toEqual([
      'interior',
      'interior',
      'interior',
      'interior',
    ]);
  });

  it('зона касается стены одной стороной — ровно этот участок `wall`', () => {
    // Левая сторона зоны лежит на грани комнаты x = 10.
    expect(kinds(classifyAreaEdges(rect(10, 100, 200, 200), roomFaces))).toEqual([
      'interior',
      'interior',
      'interior',
      'wall',
    ]);
  });

  it('зона совпала с комнатой по всем сторонам — все участки `wall`, разрезов нет', () => {
    const segments = classifyAreaEdges(rect(10, 10, 390, 290), roomFaces);
    expect(kinds(segments)).toEqual(['wall', 'wall', 'wall', 'wall']);
  });

  it('ребро, стартующее из угла комнаты внутрь, остаётся интерьерным', () => {
    expect(
      kinds(
        classifyAreaEdges(
          [
            { x: 10, y: 10 },
            { x: 200, y: 100 },
            { x: 10, y: 200 },
          ],
          roomFaces,
        ),
      ),
    ).toEqual(['interior', 'interior', 'wall']);
  });

  it('ребро, идущее по грани и продолжающееся за её конец, режется: кусок за концом — интерьер', () => {
    const face: AreaFace[] = [{ a: { x: 10, y: 10 }, b: { x: 200, y: 10 } }];
    const segments = classifyAreaEdges(
      [
        { x: 10, y: 10 },
        { x: 300, y: 10 },
        { x: 300, y: 100 },
      ],
      face,
    );
    expect(segments[0]).toEqual({ a: { x: 10, y: 10 }, b: { x: 200, y: 10 }, kind: 'wall' });
    expect(segments[1]).toEqual({ a: { x: 200, y: 10 }, b: { x: 300, y: 10 }, kind: 'interior' });
  });

  it('L-образная комната: ребро зоны вдоль короткой стены и дальше через интерьер даёт два участка', () => {
    // Полость: прямоугольник 10..390 × 10..290 с вырезом — грань x = 200 идёт только от y = 150 до y = 290.
    const lShaped: PlanPosition[] = [
      { x: 10, y: 10 },
      { x: 390, y: 10 },
      { x: 390, y: 150 },
      { x: 200, y: 150 },
      { x: 200, y: 290 },
      { x: 10, y: 290 },
    ];
    const segments = classifyAreaEdges(
      [
        { x: 200, y: 290 },
        { x: 200, y: 50 },
        { x: 100, y: 50 },
      ],
      contourFaces([lShaped]),
    );
    expect(segments.map(segment => [segment.a, segment.b, segment.kind])).toEqual([
      [{ x: 200, y: 290 }, { x: 200, y: 150 }, 'wall'],
      [{ x: 200, y: 150 }, { x: 200, y: 50 }, 'interior'],
      [{ x: 200, y: 50 }, { x: 100, y: 50 }, 'interior'],
      [{ x: 100, y: 50 }, { x: 200, y: 290 }, 'interior'],
    ]);
  });

  it('несколько разрезов идут вдоль ребра по порядку, даже если грани перечислены наоборот', () => {
    // Грани поданы в порядке x = 300, затем x = 200 — сортировка обязана выстроить участки слева направо.
    const faces: AreaFace[] = [
      { a: { x: 300, y: 0 }, b: { x: 300, y: -80 } },
      { a: { x: 200, y: 0 }, b: { x: 200, y: -80 } },
    ];
    const segments = classifyAreaEdges(
      [
        { x: 100, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 100 },
      ],
      faces,
    );
    expect(segments.slice(0, 3).map(segment => [segment.a.x, segment.b.x])).toEqual([
      [100, 200],
      [200, 300],
      [300, 400],
    ]);
  });

  it('ориентация обхода зоны не важна: по часовой те же участки в обратном порядке, виды те же', () => {
    const ccw = rect(10, 100, 200, 200);
    const cw = [...ccw].reverse();
    expect(kinds(classifyAreaEdges(cw, roomFaces)).sort()).toEqual(kinds(classifyAreaEdges(ccw, roomFaces)).sort());
    // Стеновой участок — та же сторона x = 10, независимо от направления обхода.
    const wall = classifyAreaEdges(cw, roomFaces).find(segment => segment.kind === 'wall')!;
    expect([wall.a.x, wall.b.x]).toEqual([10, 10]);
  });

  it('отрицательный квадрант классифицируется так же, как положительный', () => {
    const negativeRoom = contourFaces([rect(-390, -290, -10, -10)]);
    expect(kinds(classifyAreaEdges(rect(-390, -200, -200, -100), negativeRoom))).toEqual([
      'interior',
      'interior',
      'interior',
      'wall',
    ]);
  });

  it('концы участков — те же объекты точек, что во входе: id доезжают без поиска', () => {
    const points = rect(100, 100, 200, 200);
    const face = { a: { x: 150, y: 100 }, b: { x: 150, y: 0 } };
    const segments = classifyAreaEdges(points, [face]);
    expect(segments[0]!.a).toBe(points[0]);
    // Разрез прошёл по концу грани — и это ровно объект грани, а не его копия.
    expect(segments[0]!.b).toBe(face.a);
  });

  it('вырожденные входы участков не дают', () => {
    expect(classifyAreaEdges([{ x: 10, y: 10 }], roomFaces)).toEqual([]);
    expect(classifyAreaEdges([], roomFaces)).toEqual([]);
  });

  it('без граней всё интерьерное и без разрезов', () => {
    expect(kinds(classifyAreaEdges(rect(10, 10, 390, 290), []))).toEqual([
      'interior',
      'interior',
      'interior',
      'interior',
    ]);
  });
});
