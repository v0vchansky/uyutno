import type { FaceRef, WallAxis } from '../../document/geometry/axes/findAxes';
import { createPlanBuilder } from '../../document/testing/planBuilder';
import { createTestManager, ringDocument } from '../testing/testManager';
import { MAX_EDGE_LENGTH } from './setEdgeLength';
import { MIN_WALL_WIDTH, wallWidthCoalesceKey } from './setWallWidth';

type TM = ReturnType<typeof createTestManager>;

/** Ось нижней стены кольца (y = 5) и её грани: `outer` — на y = 0, `inner` — на y = 10. */
const bottomAxis = (tm: TM): { axis: WallAxis; outerFace: FaceRef; innerFace: FaceRef } => {
  const derived = tm.manager.document.getDerived().floors[0]!;
  const layout = tm.manager.document.get().floors[0]!.layout;
  const axis = derived.axes.find(a => a.a.y === 5 && a.b.y === 5)!;
  const kindOf = (face: FaceRef) => layout.contours.find(c => c.id === face.contourId)!.kind;
  const outerFace = axis.faces.find(f => kindOf(f) === 'outer')!;
  const innerFace = axis.faces.find(f => kindOf(f) === 'inner')!;
  return { axis, outerFace, innerFace };
};

const yOf = (tm: TM, id: string): number => tm.manager.document.get().floors[0]!.layout.points[id]!.y;

describe('document.setWallWidth (ADR 0018 D1, спека 01)', () => {
  it('faces[0] — сдвигаемая грань: её концы уходят по нормали от faces[1] на Δ; depth оси = новая ширина', () => {
    const tm = createTestManager(ringDocument());
    const { axis, outerFace, innerFace } = bottomAxis(tm);
    expect(axis.depth).toBe(10);
    tm.events.length = 0;
    expect(tm.manager.document.setWallWidth(tm.floorId, [outerFace, innerFace], 30)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(yOf(tm, outerFace.a)).toBe(-20);
    expect(yOf(tm, outerFace.b)).toBe(-20);
    expect(yOf(tm, innerFace.a)).toBe(10);
    expect(tm.events).toEqual(['document:changed', 'history:changed', 'document:dirty-changed']);
    const after = tm.manager.document.getDerived().floors[0]!.axes.find(a => a.a.y === -5)!;
    expect(after.depth).toBe(30);
  });

  it('порядок пары свободный: с faces[0] = внутренняя грань сдвигается она (внутрь комнаты)', () => {
    const tm = createTestManager(ringDocument());
    const { outerFace, innerFace } = bottomAxis(tm);
    expect(tm.manager.document.setWallWidth(tm.floorId, [innerFace, outerFace], 25).ok).toBe(true);
    expect(yOf(tm, innerFace.a)).toBe(25);
    expect(yOf(tm, innerFace.b)).toBe(25);
    expect(yOf(tm, outerFace.a)).toBe(0);
    expect(tm.manager.document.getDerived().floors[0]!.rooms[0]!.area).toBe(380 * (290 - 25));
  });

  it('уменьшение ширины и коалесинг: серия по одной грани = одна запись', () => {
    const tm = createTestManager(ringDocument());
    const { outerFace, innerFace } = bottomAxis(tm);
    const layout0 = tm.manager.document.get().floors[0]!.layout;
    tm.manager.document.setWallWidth(tm.floorId, [outerFace, innerFace], 20);
    tm.manager.document.setWallWidth(tm.floorId, [outerFace, innerFace], 5);
    expect(yOf(tm, outerFace.a)).toBe(5);
    tm.manager.history.undo();
    expect(tm.manager.document.get().floors[0]!.layout).toBe(layout0);
    expect(wallWidthCoalesceKey([outerFace, innerFace])).toBe(`wall-width:${outerFace.a}|${outerFace.b}`);
  });

  it('та же ширина — no-op без записи и событий', () => {
    const tm = createTestManager(ringDocument());
    const { outerFace, innerFace } = bottomAxis(tm);
    tm.events.length = 0;
    expect(tm.manager.document.setWallWidth(tm.floorId, [outerFace, innerFace], 10).ok).toBe(true);
    expect(tm.events).toEqual([]);
  });

  describe('ошибки: документ тот же, событий нет', () => {
    const expectRejected = (tm: TM, run: () => unknown, error: unknown): void => {
      tm.events.length = 0;
      const doc = tm.manager.document.get();
      expect(run()).toEqual({ ok: false, error });
      expect(tm.manager.document.get()).toBe(doc);
      expect(tm.events).toEqual([]);
    };

    it('unknown-axis: несуществующая пара граней; пара, устаревшая после rebuild', () => {
      const tm = createTestManager(ringDocument());
      const { outerFace, innerFace } = bottomAxis(tm);
      const bogus: FaceRef = { contourId: outerFace.contourId, a: 'p1', b: 'p3' };
      expectRejected(tm, () => tm.manager.document.setWallWidth(tm.floorId, [bogus, innerFace], 20), {
        kind: 'unknown-axis',
        faces: [bogus, innerFace],
      });
      // Стена сдвинута так, что грани больше не образуют ось (ширина > MAX_WALL_WIDTH).
      tm.manager.document.movePoints(tm.floorId, [
        { id: outerFace.a, x: tm.manager.document.get().floors[0]!.layout.points[outerFace.a]!.x, y: -100 },
        { id: outerFace.b, x: tm.manager.document.get().floors[0]!.layout.points[outerFace.b]!.x, y: -100 },
      ]);
      expectRejected(tm, () => tm.manager.document.setWallWidth(tm.floorId, [outerFace, innerFace], 20), {
        kind: 'unknown-axis',
        faces: [outerFace, innerFace],
      });
    });

    it.each([0, 0.999, -5])('too-short: %p', width => {
      const tm = createTestManager(ringDocument());
      const { outerFace, innerFace } = bottomAxis(tm);
      expectRejected(tm, () => tm.manager.document.setWallWidth(tm.floorId, [outerFace, innerFace], width), {
        kind: 'too-short',
        width,
        min: MIN_WALL_WIDTH,
      });
    });

    it.each([100_000.001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      'out-of-range: %p',
      width => {
        const tm = createTestManager(ringDocument());
        const { outerFace, innerFace } = bottomAxis(tm);
        expectRejected(tm, () => tm.manager.document.setWallWidth(tm.floorId, [outerFace, innerFace], width), {
          kind: 'out-of-range',
          width,
          max: MAX_EDGE_LENGTH,
        });
      },
    );

    it('границы: MIN_WALL_WIDTH проходит; ширина > MAX_WALL_WIDTH проходит, но ось исчезает (следующая правка — unknown-axis)', () => {
      const tm = createTestManager(ringDocument());
      const { outerFace, innerFace } = bottomAxis(tm);
      expect(tm.manager.document.setWallWidth(tm.floorId, [outerFace, innerFace], MIN_WALL_WIDTH).ok).toBe(true);
      expect(tm.manager.document.setWallWidth(tm.floorId, [outerFace, innerFace], 90).ok).toBe(true);
      expect(tm.manager.document.getDerived().floors[0]!.axes.some(a => a.a.y === -35)).toBe(false);
      expect(tm.manager.document.setWallWidth(tm.floorId, [outerFace, innerFace], 20)).toEqual({
        ok: false,
        error: { kind: 'unknown-axis', faces: [outerFace, innerFace] },
      });
    });

    it('unknown-floor', () => {
      const tm = createTestManager(ringDocument());
      const { outerFace, innerFace } = bottomAxis(tm);
      expectRejected(tm, () => tm.manager.document.setWallWidth('f9', [outerFace, innerFace], 20), {
        kind: 'unknown-floor',
        floorId: 'f9',
      });
    });

    it('contour-self-intersected: сдвиг грани комнаты-пятиугольника внутрь протыкает её скошенную сторону', () => {
      const b = createPlanBuilder();
      b.rect('outer', 0, 0, 400, 300);
      b.contour('inner', [b.point(10, 10), b.point(390, 10), b.point(390, 100), b.point(200, 50), b.point(10, 100)]);
      const tm = createTestManager(b.document());
      const { outerFace, innerFace, axis } = bottomAxis(tm);
      expect(axis.depth).toBe(10);
      expectRejected(tm, () => tm.manager.document.setWallWidth(tm.floorId, [innerFace, outerFace], 80), {
        kind: 'contour-self-intersected',
      });
      // Та же ширина со сдвигом наружной грани — проходит.
      expect(tm.manager.document.setWallWidth(tm.floorId, [outerFace, innerFace], 80).ok).toBe(true);
    });
  });
});
