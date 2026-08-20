import { createPlanBuilder } from '../../document/testing/planBuilder';
import { createTestManager, ringDocument } from '../testing/testManager';

/** Квадратная «комната по точкам» 300×300 без тел стен: углы — `p1..p4`. */
const roomDocument = () => {
  const b = createPlanBuilder();
  b.contour('inner', [b.point(0, 0), b.point(300, 0), b.point(300, 300), b.point(0, 300)]);
  return b.document();
};

/** Половина комнаты по диагонали `p1–p3`: три угла комнаты, значит опора есть. */
const HALF = [
  { x: 0, y: 0 },
  { x: 300, y: 0 },
  { x: 300, y: 300 },
];

const layoutOf = (m: ReturnType<typeof createTestManager>) => m.manager.document.get().floors[0]!.layout;

describe('document.addArea (ADR 0018 D1, спека 02 «Зоны (Areas)»)', () => {
  it('зона на половине комнаты: одна запись истории, одно document:changed, dirty; undo возвращает планировку', () => {
    const tm = createTestManager(roomDocument());
    const { manager, events, floorId } = tm;
    const before = manager.document.get();
    manager.document.markSaved();
    events.length = 0;

    expect(manager.document.addArea(floorId, HALF, 100)).toEqual({ ok: true, value: undefined });
    expect(events).toEqual(['document:changed', 'history:changed', 'document:dirty-changed']);
    expect(manager.document.isDirty()).toBe(true);
    expect(layoutOf(tm).areas).toEqual([{ id: expect.any(String), points: ['p1', 'p2', 'p3'], height: 100 }]);
    expect(manager.history.get()).toEqual({ canUndo: true, canRedo: false });

    manager.history.undo();
    expect(manager.history.get()).toEqual({ canUndo: false, canRedo: true });
    expect(manager.document.get().floors[0]!.layout).toEqual(before.floors[0]!.layout);
  });

  it('опора: вершины зоны берут id углов комнаты, новых точек не заводится', () => {
    const tm = createTestManager(roomDocument());
    tm.manager.document.addArea(tm.floorId, HALF, 100);
    expect(Object.keys(layoutOf(tm).points).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(layoutOf(tm).areas[0]!.points).toEqual(['p1', 'p2', 'p3']);
  });

  it('интерьерное ребро зоны даёт запись cuts[]; рёбра по стене — нет', () => {
    const tm = createTestManager(roomDocument());
    tm.manager.document.addArea(tm.floorId, HALF, 100);
    // p1–p2 и p2–p3 идут по контуру комнаты, интерьером идёт только диагональ p3–p1.
    expect(layoutOf(tm).cuts).toEqual([{ id: expect.any(String), a: 'p3', b: 'p1' }]);
  });

  it('зона по всему контуру комнаты (coincide) допустима и вертикальных граней не даёт', () => {
    const tm = createTestManager(roomDocument());
    expect(
      tm.manager.document.addArea(
        tm.floorId,
        [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
          { x: 300, y: 300 },
          { x: 0, y: 300 },
        ],
        100,
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(layoutOf(tm).areas).toHaveLength(1);
    expect(layoutOf(tm).cuts).toEqual([]);
  });

  it('две касающиеся зоны допустимы: общий участок даёт одну запись cuts[]', () => {
    const tm = createTestManager(roomDocument());
    tm.manager.document.addArea(tm.floorId, HALF, 100);
    expect(
      tm.manager.document.addArea(
        tm.floorId,
        [
          { x: 0, y: 0 },
          { x: 300, y: 300 },
          { x: 0, y: 300 },
        ],
        120,
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(layoutOf(tm).areas.map(area => area.height)).toEqual([100, 120]);
    expect(layoutOf(tm).cuts).toHaveLength(1);
  });

  it('координаты квантуются до 0.001 на границе; опора считается по квантованной координате', () => {
    const tm = createTestManager(roomDocument());
    expect(
      tm.manager.document.addArea(
        tm.floorId,
        [
          { x: -0, y: 0.0004 },
          { x: 300.0004, y: -0.0004 },
          { x: 299.9996, y: 300 },
        ],
        100,
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(layoutOf(tm).areas[0]!.points).toEqual(['p1', 'p2', 'p3']);
    expect(Object.keys(layoutOf(tm).points).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  describe('ошибки: документ — тот же объект, событий нет', () => {
    const expectRejected = (tm: ReturnType<typeof createTestManager>, before: unknown) => {
      expect(tm.manager.document.get()).toBe(before);
      expect(tm.events).toEqual([]);
      expect(tm.manager.history.get()).toEqual({ canUndo: false, canRedo: false });
    };

    /** Менеджер на комнате 300×300 с обнулённым журналом событий. */
    const room = () => {
      const tm = createTestManager(roomDocument());
      const before = tm.manager.document.get();
      tm.events.length = 0;
      return { tm, before };
    };

    it('unknown-floor', () => {
      const { tm, before } = room();
      expect(tm.manager.document.addArea('f-nope', HALF, 100)).toEqual({
        ok: false,
        error: { kind: 'unknown-floor', floorId: 'f-nope' },
      });
      expectRejected(tm, before);
    });

    it('invalid-coordinate', () => {
      const { tm, before } = room();
      expect(tm.manager.document.addArea(tm.floorId, [{ x: Number.NaN, y: 0 }, ...HALF.slice(1)], 100)).toEqual({
        ok: false,
        error: { kind: 'invalid-coordinate' },
      });
      expect(
        tm.manager.document.addArea(tm.floorId, [{ x: 0, y: Number.NEGATIVE_INFINITY }, ...HALF.slice(1)], 100),
      ).toEqual({ ok: false, error: { kind: 'invalid-coordinate' } });
      expectRejected(tm, before);
    });

    it('invalid-height: не конечная или <= 0', () => {
      const { tm, before } = room();
      for (const height of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(tm.manager.document.addArea(tm.floorId, HALF, height)).toEqual({
          ok: false,
          error: { kind: 'invalid-height', height },
        });
      }
      expectRejected(tm, before);
    });

    it('contour-self-intersected («бабочка»)', () => {
      const { tm, before } = room();
      expect(
        tm.manager.document.addArea(
          tm.floorId,
          [
            { x: 0, y: 0 },
            { x: 300, y: 0 },
            { x: 0, y: 300 },
            { x: 300, y: 300 },
          ],
          100,
        ),
      ).toEqual({ ok: false, error: { kind: 'contour-self-intersected' } });
      expectRejected(tm, before);
    });

    it('contour-degenerate: меньше трёх точек, дубли, площадь/сливер ниже порога', () => {
      const { tm, before } = room();
      expect(tm.manager.document.addArea(tm.floorId, HALF.slice(0, 2), 100)).toEqual({
        ok: false,
        error: { kind: 'contour-degenerate' },
      });
      expect(tm.manager.document.addArea(tm.floorId, [...HALF, { x: 0, y: 0 }], 100)).toEqual({
        ok: false,
        error: { kind: 'contour-degenerate' },
      });
      expect(
        tm.manager.document.addArea(
          tm.floorId,
          [
            { x: 100, y: 100 },
            { x: 105, y: 100 },
            { x: 105, y: 105 },
          ],
          100,
        ),
      ).toEqual({ ok: false, error: { kind: 'contour-degenerate' } });
      expectRejected(tm, before);
    });

    it('area-crosses-walls: граница выходит за комнату', () => {
      const { tm, before } = room();
      expect(
        tm.manager.document.addArea(
          tm.floorId,
          [
            { x: 0, y: 0 },
            { x: 300, y: 0 },
            { x: 300, y: 400 },
            { x: 0, y: 400 },
          ],
          100,
        ),
      ).toEqual({ ok: false, error: { kind: 'area-crosses-walls' } });
      expectRejected(tm, before);
    });

    it('area-crosses-walls: зона в толще стены (комнаты вокруг неё нет)', () => {
      const tm = createTestManager(ringDocument());
      tm.events.length = 0;
      const before = tm.manager.document.get();
      // Прямоугольник целиком внутри тела стены 400×300 толщиной 10 — телу принадлежит, комнате нет.
      expect(
        tm.manager.document.addArea(
          tm.floorId,
          [
            { x: 100, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 10 },
            { x: 100, y: 10 },
          ],
          100,
        ),
      ).toEqual({ ok: false, error: { kind: 'area-crosses-walls' } });
      expect(tm.manager.document.get()).toBe(before);
      expect(tm.events).toEqual([]);
    });

    it('area-overlaps-area: перекрытие существующей зоны строже касания', () => {
      const tm = createTestManager(roomDocument());
      tm.manager.document.addArea(
        tm.floorId,
        [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
          { x: 300, y: 300 },
          { x: 0, y: 300 },
        ],
        100,
      );
      const before = tm.manager.document.get();
      tm.events.length = 0;
      expect(tm.manager.document.addArea(tm.floorId, HALF, 120)).toEqual({
        ok: false,
        error: { kind: 'area-overlaps-area' },
      });
      expect(tm.manager.document.get()).toBe(before);
      expect(tm.events).toEqual([]);
    });

    it('area-unsupported: вершина не совпала ни с одним углом комнаты', () => {
      const { tm, before } = room();
      expect(
        tm.manager.document.addArea(
          tm.floorId,
          [
            { x: 0, y: 0 },
            { x: 300, y: 0 },
            { x: 150, y: 150 },
          ],
          100,
        ),
      ).toEqual({ ok: false, error: { kind: 'area-unsupported' } });
      expectRejected(tm, before);
    });
  });
});
