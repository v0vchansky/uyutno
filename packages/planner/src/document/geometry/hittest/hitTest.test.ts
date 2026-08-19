import type { FloorLayout } from '../../PlannerDocument';
import { createPlanBuilder } from '../../testing/planBuilder';
import { SNAP_DIST } from '../snap/getSnapPoint';
import type { Viewport } from '../viewport';
import { type HitRoom, hitTest, POINT_SIZE, sameHitTarget, WALL_HIT_DIST } from './hitTest';

const vp = (scale: number): Viewport => ({ scale, center: { x: 0, y: 0 }, width: 1024, height: 768 });

/** Один `inner`-контур 0..400 × 0..300 (комната) плюс `outer`-квад стены сверху 0..400 × 300..310. */
const fixture = (): { layout: FloorLayout; rooms: HitRoom[]; roomContour: string; wallContour: string } => {
  const b = createPlanBuilder();
  const roomContour = b.rect('inner', 0, 0, 400, 300);
  const wallContour = b.rect('outer', 0, 300, 400, 310);
  const layout = b.document().floors[0]!.layout;
  const inner = layout.contours.find(c => c.id === roomContour)!;
  const rooms: HitRoom[] = [{ roomId: 'r1', outline: inner.points, area: 400 * 300 }];
  return { layout, rooms, roomContour, wallContour };
};

describe('hitTest — хит-тест конструктора (ADR 0019 E4)', () => {
  it('константы: POINT_SIZE = 6 px, WALL_HIT_DIST = SNAP_DIST / 2', () => {
    expect(POINT_SIZE).toBe(6);
    expect(WALL_HIT_DIST).toBe(SNAP_DIST / 2);
    expect(WALL_HIT_DIST).toBe(5);
  });

  describe('вершина', () => {
    it('ближайшая по манхэттену в радиусе POINT_SIZE/scale включительно; за радиусом — не вершина', () => {
      const { layout, rooms } = fixture();
      // Вершина (0,0): манхэттен 3+3 = 6 = радиус при scale 1 → попадание.
      expect(hitTest({ x: 3, y: 3 }, layout, rooms, vp(1))).toEqual({ kind: 'point', id: 'p1' });
      // 3.001 + 3 > 6 → мимо вершины; точка (3.001, 3) — внутри комнаты, но в коридоре стороны y=0 (5 см; до неё 3 < 3.001 до x=0) → сторона.
      expect(hitTest({ x: 3.001, y: 3 }, layout, rooms, vp(1))).toEqual({
        kind: 'wall',
        face: { contourId: 'c1', a: 'p1', b: 'p2' },
      });
    });

    it('порог делится на scale: при scale 2 радиус 3 см', () => {
      const { layout, rooms } = fixture();
      expect(hitTest({ x: 1.5, y: 1.5 }, layout, rooms, vp(2))).toEqual({ kind: 'point', id: 'p1' });
      expect(hitTest({ x: 1.501, y: 1.5 }, layout, rooms, vp(2))?.kind).toBe('wall');
    });

    it('при нескольких вершинах в радиусе — ближайшая; вершина приоритетнее стороны и комнаты', () => {
      const b = createPlanBuilder();
      b.rect('inner', 0, 0, 400, 300);
      b.point(4, 0); // p5 — рядом с p1 на ребре
      const layout = b.document().floors[0]!.layout;
      expect(hitTest({ x: 3, y: 0 }, layout, [], vp(1))).toEqual({ kind: 'point', id: 'p5' });
      expect(hitTest({ x: 1, y: 0 }, layout, [], vp(1))).toEqual({ kind: 'point', id: 'p1' });
    });

    it('exceptPointIds исключает вершину и её рёбра (перетаскиваемая точка не цель для самой себя)', () => {
      const { layout, rooms } = fixture();
      const at = { x: 0, y: 0 };
      expect(hitTest(at, layout, rooms, vp(1))).toEqual({ kind: 'point', id: 'p1' });
      // Без p1: рёбра p1–p2 и p4–p1 исключены, точка (0,0) — на границе комнаты (не строго внутри) → null.
      expect(hitTest(at, layout, rooms, vp(1), { exceptPointIds: ['p1'] })).toBeNull();
      // Точка на ребре p1–p2, но не в радиусе p1: без исключения — сторона; с исключением p1 — ребро тоже исключено.
      expect(hitTest({ x: 50, y: 0 }, layout, rooms, vp(1), { exceptPointIds: ['p1'] })).toBeNull();
      // Вершина-совладелец двух контуров: исключаются рёбра обоих.
      const b = createPlanBuilder();
      const shared = b.point(0, 0);
      b.contour('outer', [shared, b.point(100, 0), b.point(100, 100)]);
      b.contour('outer', [shared, b.point(0, -100), b.point(-100, -100)]);
      const two = b.document().floors[0]!.layout;
      expect(hitTest({ x: 50, y: 0 }, two, [], vp(1))?.kind).toBe('wall');
      expect(hitTest({ x: 0, y: -50 }, two, [], vp(1))?.kind).toBe('wall');
      expect(hitTest({ x: 50, y: 0 }, two, [], vp(1), { exceptPointIds: [shared] })).toBeNull();
      expect(hitTest({ x: 0, y: -50 }, two, [], vp(1), { exceptPointIds: [shared] })).toBeNull();
    });
  });

  describe('сторона', () => {
    it('коридор SNAP_DIST/2/scale вокруг ребра контура (обе стороны порога), грань — в порядке обхода', () => {
      const { layout, rooms } = fixture();
      // Ребро p2(400,0) → p3(400,300): x = 400 ± 4.999 попадает, ± 5 — нет (pointOnSegment строгий).
      expect(hitTest({ x: 404.999, y: 150 }, layout, rooms, vp(1))).toEqual({
        kind: 'wall',
        face: { contourId: 'c1', a: 'p2', b: 'p3' },
      });
      expect(hitTest({ x: 405, y: 150 }, layout, rooms, vp(1))).toBeNull();
      // Внутри комнаты за коридором — комната.
      expect(hitTest({ x: 395, y: 150 }, layout, rooms, vp(1))).toEqual({ kind: 'room', roomId: 'r1' });
      expect(hitTest({ x: 395.001, y: 150 }, layout, rooms, vp(1))?.kind).toBe('wall');
    });

    it('замыкающее ребро контура тоже сторона; при scale 2 коридор 2.5 см', () => {
      const { layout, rooms } = fixture();
      // p4(0,300) → p1(0,0) — замыкающее ребро комнаты.
      expect(hitTest({ x: -2, y: 150 }, layout, rooms, vp(2))).toEqual({
        kind: 'wall',
        face: { contourId: 'c1', a: 'p4', b: 'p1' },
      });
      expect(hitTest({ x: -2.5, y: 150 }, layout, rooms, vp(2))).toBeNull();
    });

    it('несколько рёбер в коридоре — ближайшее по перпендикуляру', () => {
      const { layout, rooms, wallContour } = fixture();
      // y = 302: ребро комнаты y=300 (расстояние 2) и ребро стены y=300 (то же 2, первое побеждает); y = 306 → ребро стены y=310 (4) против 6.
      expect(hitTest({ x: 200, y: 306 }, layout, rooms, vp(1))).toEqual({
        kind: 'wall',
        face: { contourId: wallContour, a: 'p7', b: 'p8' },
      });
      expect(hitTest({ x: 200, y: 302 }, layout, rooms, vp(1))).toEqual({
        kind: 'wall',
        face: { contourId: 'c1', a: 'p3', b: 'p4' },
      });
    });
  });

  describe('комната', () => {
    it('строго внутри обвода — комната; на границе за пределами коридора стороны — нет такого; снаружи — null', () => {
      const { layout, rooms } = fixture();
      expect(hitTest({ x: 200, y: 150 }, layout, rooms, vp(1))).toEqual({ kind: 'room', roomId: 'r1' });
      expect(hitTest({ x: 200, y: -50 }, layout, rooms, vp(1))).toBeNull();
    });

    it('вложение комнат — побеждает меньшая по площади; skipRooms — уровень пропущен', () => {
      const b = createPlanBuilder();
      const big = b.rect('inner', 0, 0, 400, 300);
      const small = b.rect('inner', 100, 100, 200, 200);
      const layout = b.document().floors[0]!.layout;
      const outline = (id: string) => layout.contours.find(c => c.id === id)!.points;
      const rooms: HitRoom[] = [
        { roomId: 'big', outline: outline(big), area: 120_000 },
        { roomId: 'small', outline: outline(small), area: 10_000 },
      ];
      expect(hitTest({ x: 150, y: 150 }, layout, rooms, vp(1))).toEqual({ kind: 'room', roomId: 'small' });
      expect(hitTest({ x: 50, y: 50 }, layout, rooms, vp(1))).toEqual({ kind: 'room', roomId: 'big' });
      expect(hitTest({ x: 150, y: 150 }, layout, rooms, vp(1), { skipRooms: true })).toBeNull();
    });

    it('обвод с пропавшей точкой не участвует', () => {
      const { layout } = fixture();
      const rooms: HitRoom[] = [{ roomId: 'r1', outline: ['p1', 'p2', 'ghost', 'p4'], area: 1 }];
      expect(hitTest({ x: 200, y: 150 }, layout, rooms, vp(1))).toBeNull();
    });
  });

  it('пустая планировка / NaN во входе → null', () => {
    const layout = createPlanBuilder().document().floors[0]!.layout;
    expect(hitTest({ x: 0, y: 0 }, layout, [], vp(1))).toBeNull();
    const { layout: full, rooms } = fixture();
    expect(hitTest({ x: Number.NaN, y: 0 }, full, rooms, vp(1))).toBeNull();
  });

  it('sameHitTarget сравнивает по значению для каждого вида цели', () => {
    expect(sameHitTarget(null, null)).toBe(true);
    expect(sameHitTarget({ kind: 'point', id: 'a' }, { kind: 'point', id: 'a' })).toBe(true);
    expect(sameHitTarget({ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' })).toBe(false);
    expect(sameHitTarget({ kind: 'point', id: 'a' }, null)).toBe(false);
    const face = { contourId: 'c', a: 'a', b: 'b' };
    expect(sameHitTarget({ kind: 'wall', face }, { kind: 'wall', face: { ...face } })).toBe(true);
    expect(sameHitTarget({ kind: 'wall', face }, { kind: 'wall', face: { ...face, b: 'x' } })).toBe(false);
    expect(sameHitTarget({ kind: 'room', roomId: 'r' }, { kind: 'room', roomId: 'r' })).toBe(true);
    expect(sameHitTarget({ kind: 'room', roomId: 'r' }, { kind: 'point', id: 'r' })).toBe(false);
  });
});
