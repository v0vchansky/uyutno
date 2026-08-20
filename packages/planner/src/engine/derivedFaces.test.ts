import type { Id } from '../document/id';
import type { PlanPosition } from '../document/PlannerDocument';
import { type FaceArea, type FaceRoom, derivedFaces } from './derivedFaces';

const at = (x: number, y: number): PlanPosition => ({ x, y });

/** Комната-прямоугольник против часовой: `p1..p4` — id её вершин, интерьер слева от каждого ребра. */
const room = (ceilingHeight = 280, reversed = false): FaceRoom => {
  const positions = [at(0, 0), at(400, 0), at(400, 300), at(0, 300)];
  const points: Id[] = ['p1', 'p2', 'p3', 'p4'];
  return {
    contourId: 'c1',
    roomId: 'r1',
    points: reversed ? [...points].reverse() : points,
    positions: reversed ? [...positions].reverse() : positions,
    ceilingHeight,
  };
};

const facesOf = (rooms: readonly FaceRoom[], areas: readonly FaceArea[] = []) => derivedFaces({ rooms, areas });

describe('derivedFaces — без зон', () => {
  it('на каждое ребро комнаты — грань с высотой комнаты и два плинтуса', () => {
    const { faces, skirtings } = facesOf([room(260)]);
    expect(faces).toEqual([
      { roomId: 'r1', contourId: 'c1', a: 'p1', b: 'p2', top: 260, underArea: false },
      { roomId: 'r1', contourId: 'c1', a: 'p2', b: 'p3', top: 260, underArea: false },
      { roomId: 'r1', contourId: 'c1', a: 'p3', b: 'p4', top: 260, underArea: false },
      { roomId: 'r1', contourId: 'c1', a: 'p4', b: 'p1', top: 260, underArea: false },
    ]);
    expect(skirtings).toHaveLength(8);
    expect(skirtings.map(s => s.kind)).toEqual(['bottom', 'top', 'bottom', 'top', 'bottom', 'top', 'bottom', 'top']);
    expect(skirtings.every(s => s.gaps.length === 0)).toBe(true);
  });

  it('сторона свипа — внутрь комнаты при любой ориентации контура', () => {
    // Против часовой: интерьер слева от p1 → p2, квад уходит в +y.
    const ccw = facesOf([room()]).skirtings[0]!;
    expect(ccw.points[2]!.y).toBeCloseTo(1, 12);
    expect(ccw.points[3]!.y).toBeCloseTo(1, 12);
    // По часовой: то же ребро проходится в обратную сторону, интерьер снова внутри прямоугольника.
    const cw = facesOf([room(280, true)]).skirtings[0]!;
    expect(cw.points[0]).toEqual(at(0, 300));
    expect(cw.points[1]).toEqual(at(400, 300));
    expect(cw.points[2]!.y).toBeCloseTo(299, 12);
    expect(cw.points[3]!.y).toBeCloseTo(299, 12);
  });

  it('вырожденное ребро (дубль вершины) гранью не считается: ни высоты, ни плинтусов', () => {
    const degenerate: FaceRoom = {
      contourId: 'c1',
      roomId: 'r1',
      points: ['p1', 'p2', 'p2b', 'p3', 'p4'],
      positions: [at(0, 0), at(400, 0), at(400, 0), at(400, 300), at(0, 300)],
      ceilingHeight: 280,
    };
    const { faces, skirtings } = facesOf([degenerate]);
    expect(faces.map(face => [face.a, face.b])).toEqual([
      ['p1', 'p2'],
      ['p2b', 'p3'],
      ['p3', 'p4'],
      ['p4', 'p1'],
    ]);
    expect(skirtings).toHaveLength(8);
  });

  it('контур короче трёх вершин и рассинхрон id/координат — комната пропускается целиком', () => {
    const short: FaceRoom = {
      contourId: 'c1',
      roomId: 'r1',
      points: ['p1', 'p2'],
      positions: [at(0, 0), at(1, 1)],
      ceilingHeight: 280,
    };
    const mismatched: FaceRoom = { ...room(), points: ['p1', 'p2', 'p3'] };
    expect(facesOf([short, mismatched])).toEqual({ faces: [], skirtings: [] });
  });
});

describe('derivedFaces — под зоной', () => {
  /**
   * Зона, опёртая на углы комнаты (иначе `normalize` её отбракует): треугольник по трём углам. Два её
   * ребра ложатся на стены целиком, третье идёт диагональю через интерьер.
   */
  const corner: FaceArea = { points: [at(0, 0), at(400, 0), at(400, 300)], height: 100 };
  /** Зона по нижней полосе комнаты — вершины не в углах, поэтому только для юнит-проверок формы. */
  const bottomStrip: FaceArea = { points: [at(0, 0), at(400, 0), at(400, 100), at(0, 100)], height: 100 };

  it('грани, совпавшие с рёбрами зоны: укорочены и без верхнего плинтуса (спека 02)', () => {
    const { faces, skirtings } = facesOf([room(280)], [corner]);
    expect(faces).toEqual([
      { roomId: 'r1', contourId: 'c1', a: 'p1', b: 'p2', top: 100, underArea: true },
      { roomId: 'r1', contourId: 'c1', a: 'p2', b: 'p3', top: 100, underArea: true },
      { roomId: 'r1', contourId: 'c1', a: 'p3', b: 'p4', top: 280, underArea: false },
      { roomId: 'r1', contourId: 'c1', a: 'p4', b: 'p1', top: 280, underArea: false },
    ]);
    expect(skirtings.filter(s => s.a === 'p1' && s.b === 'p2').map(s => s.kind)).toEqual(['bottom']);
    expect(skirtings.filter(s => s.a === 'p3' && s.b === 'p4').map(s => s.kind)).toEqual(['bottom', 'top']);
    expect(skirtings).toHaveLength(6);
  });

  it('грань, покрытая ребром зоны частично, тоже считается совпавшей (наложение вместо тождества концов)', () => {
    const half: FaceArea = { points: [at(0, 0), at(200, 0), at(200, 100), at(0, 100)], height: 120 };
    const { faces } = facesOf([room(280)], [half]);
    expect(faces[0]).toMatchObject({ a: 'p1', b: 'p2', top: 120, underArea: true });
  });

  it('грань целиком внутри зоны: укорочена, но верхний плинтус остаётся (`underArea` = false)', () => {
    // Свободностоящая перегородка внутри комнаты: её ребро лежит строго внутри контура зоны.
    const partition: FaceRoom = {
      contourId: 'c2',
      roomId: 'r2',
      points: ['q1', 'q2', 'q3'],
      positions: [at(100, 30), at(300, 30), at(200, 70)],
      ceilingHeight: 280,
    };
    const { faces, skirtings } = facesOf([partition], [bottomStrip]);
    expect(faces.every(face => face.top === 100 && !face.underArea)).toBe(true);
    expect(skirtings).toHaveLength(6);
  });

  it('один конец внутри, другой на границе — тоже «целиком внутри»; оба на границе — нет', () => {
    const touching: FaceRoom = {
      contourId: 'c2',
      roomId: 'r2',
      points: ['q1', 'q2', 'q3'],
      positions: [at(100, 100), at(300, 50), at(300, 0)],
      ceilingHeight: 280,
    };
    const { faces } = facesOf([touching], [bottomStrip]);
    // q1 → q2 и q2 → q3: граница + внутри → укорочены; q3 → q1 — хорда, оба конца на границе → нет.
    expect(faces.map(face => face.top)).toEqual([100, 100, 280]);
    expect(faces.every(face => !face.underArea)).toBe(true);
  });

  it('грань вне зоны не трогается; зона нулевой высоты — тоже зона', () => {
    const { faces } = facesOf([room(280)], [{ ...corner, height: 0 }]);
    expect(faces[0]!.top).toBe(0);
    expect(faces[2]!.top).toBe(280);
  });

  it('две зоны на одной грани: побеждает последняя по порядку `layout.areas` (как у референса)', () => {
    const second: FaceArea = { points: [at(0, 0), at(400, 0), at(0, 300)], height: 210 };
    expect(facesOf([room(280)], [corner, second]).faces[0]!.top).toBe(210);
    expect(facesOf([room(280)], [second, corner]).faces[0]!.top).toBe(100);
  });
});
