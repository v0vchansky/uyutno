import type { Contour, Point } from '../../PlannerDocument';
import type { Id } from '../../id';
import { layoutFaces } from './layoutFaces';

const point = (id: Id, x: number, y: number): Point => ({ id, x, y });
/** Квадрат 100 против часовой (площадь > 0): p1 (0,0) → p2 (100,0) → p3 (100,100) → p4 (0,100). */
const points: Record<Id, Point> = {
  p1: point('p1', 0, 0),
  p2: point('p2', 100, 0),
  p3: point('p3', 100, 100),
  p4: point('p4', 0, 100),
};
const ccw = ['p1', 'p2', 'p3', 'p4'];
const cw = ['p4', 'p3', 'p2', 'p1'];
const contour = (id: Id, kind: Contour['kind'], ids: Id[]): Contour => ({ id, kind, points: ids });

describe('layoutFaces', () => {
  it('inner против часовой: полость слева, тело справа → faceRight = true у всех граней', () => {
    const faces = layoutFaces([contour('c', 'inner', ccw)], points);
    expect(faces).toHaveLength(4);
    expect(faces.every(f => f.faceRight)).toBe(true);
  });

  it('outer против часовой: тело слева → faceRight = false', () => {
    const faces = layoutFaces([contour('c', 'outer', ccw)], points);
    expect(faces).toHaveLength(4);
    expect(faces.every(f => !f.faceRight)).toBe(true);
  });

  it('обратная ориентация (по часовой) переворачивает признак у обоих видов', () => {
    expect(layoutFaces([contour('c', 'inner', cw)], points).every(f => !f.faceRight)).toBe(true);
    expect(layoutFaces([contour('c', 'outer', cw)], points).every(f => f.faceRight)).toBe(true);
  });

  it('по грани на каждое ребро, включая замыкающее; ref = { contourId, a: id_i, b: id_{i+1} }, a/b — объекты пула', () => {
    const faces = layoutFaces([contour('c1', 'outer', ccw)], points);
    expect(faces.map(f => f.ref)).toEqual([
      { contourId: 'c1', a: 'p1', b: 'p2' },
      { contourId: 'c1', a: 'p2', b: 'p3' },
      { contourId: 'c1', a: 'p3', b: 'p4' },
      { contourId: 'c1', a: 'p4', b: 'p1' },
    ]);
    expect(faces[0]!.a).toBe(points.p1);
    expect(faces[0]!.b).toBe(points.p2);
    expect(faces[3]!.a).toBe(points.p4);
    expect(faces[3]!.b).toBe(points.p1);
  });

  it('пропавшие id точек пропускаются: грани строятся по оставшимся', () => {
    const faces = layoutFaces([contour('c', 'outer', ['p1', 'missing', 'p2', 'p3', 'p4'])], points);
    expect(faces).toHaveLength(4);
    expect(faces.map(f => f.ref.a)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('контур с < 3 разрешёнными точками не даёт граней (в т.ч. из-за пропавших id)', () => {
    expect(layoutFaces([contour('c', 'outer', ['p1', 'p2'])], points)).toEqual([]);
    expect(layoutFaces([contour('c', 'outer', ['p1', 'p2', 'gone'])], points)).toEqual([]);
    expect(layoutFaces([contour('c', 'outer', [])], points)).toEqual([]);
  });

  it('несколько контуров: грани идут подряд в порядке контуров, contourId у каждой свой', () => {
    const faces = layoutFaces([contour('a', 'outer', ccw), contour('b', 'inner', ['p1', 'p2', 'p3'])], points);
    expect(faces).toHaveLength(7);
    expect(faces.slice(0, 4).every(f => f.ref.contourId === 'a' && !f.faceRight)).toBe(true);
    expect(faces.slice(4).every(f => f.ref.contourId === 'b' && f.faceRight)).toBe(true);
  });

  it('вырожденный контур нулевой площади (коллинеарные точки) — площадь не > 0 → как по часовой', () => {
    const flat: Record<Id, Point> = { a: point('a', 0, 0), b: point('b', 50, 0), c: point('c', 100, 0) };
    const faces = layoutFaces([contour('c', 'inner', ['a', 'b', 'c'])], flat);
    expect(faces).toHaveLength(3);
    expect(faces.every(f => !f.faceRight)).toBe(true);
  });

  it('пустой вход → []', () => {
    expect(layoutFaces([], points)).toEqual([]);
  });
});
