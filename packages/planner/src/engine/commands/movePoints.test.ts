import { createPlanBuilder } from '../../document/testing/planBuilder';
import { createTestManager, ringDocument } from '../testing/testManager';

describe('document.movePoints (ADR 0018 D1)', () => {
  it('сдвиг двух концов стены: одна транзакция, одно document:changed, комната пересобрана, запись одна', () => {
    const { manager, events, floorId } = createTestManager(ringDocument());
    events.length = 0;
    const result = manager.document.movePoints(floorId, [
      { id: 'p2', x: 500, y: 0 },
      { id: 'p3', x: 500, y: 300 },
      { id: 'p6', x: 490, y: 10 },
      { id: 'p7', x: 490, y: 290 },
    ]);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(events).toEqual(['document:changed', 'history:changed', 'document:dirty-changed']);
    expect(manager.document.getDerived().floors[0]!.rooms[0]!.area).toBe(480 * 280);
    manager.history.undo();
    expect(manager.history.get()).toEqual({ canUndo: false, canRedo: true });
  });

  it('координаты квантуются; те же координаты после квантования — no-op без записи', () => {
    const { manager, events, floorId } = createTestManager(ringDocument());
    events.length = 0;
    manager.document.movePoints(floorId, [{ id: 'p1', x: 0.0004, y: -0.0004 }]);
    expect(events).toEqual([]);
    manager.document.movePoints(floorId, [{ id: 'p1', x: -1.23456, y: 2.34567 }]);
    expect(manager.document.get().floors[0]!.layout.points['p1']).toEqual({ id: 'p1', x: -1.235, y: 2.346 });
  });

  it('совладельцы общего id едут сами: одна запись координат меняет геометрию и комнаты (контур), и пола', () => {
    const b = createPlanBuilder();
    const ring = b.ring(0, 0, 400, 300, 10);
    const cover = [ring.inner[0]!, ring.inner[1]!, ring.inner[2]!, ring.inner[3]!];
    b.document().floors[0]!.layout.covers.push({ id: 'cover1', points: cover });
    const { manager, floorId } = createTestManager(b.document());
    const areaBefore = manager.document.getDerived().floors[0]!.rooms[0]!.area;
    // Сдвигаем внутреннюю сторону кольца (общие точки контура комнаты и пола) на 40 см внутрь.
    const [i0, i1] = [ring.inner[0]!, ring.inner[1]!];
    manager.document.movePoints(floorId, [
      { id: i0, x: 10, y: 50 },
      { id: i1, x: 390, y: 50 },
    ]);
    const layout = manager.document.get().floors[0]!.layout;
    const coverPositions = layout.covers[0]!.points.map(id => layout.points[id]!);
    expect(coverPositions.map(p => p.y)).toEqual([50, 50, 290, 290]);
    expect(manager.document.getDerived().floors[0]!.rooms[0]!.area).toBe(areaBefore - 380 * 40);
    // Записей о переносе точек нет ни в контуре, ни в поле — та же ссылка на id.
    expect(layout.covers[0]!.points).toEqual(cover);
  });

  it('дроп на другую точку (та же координата) — тождество в normalize: одна точка, контур схлопнут', () => {
    const b = createPlanBuilder();
    b.contour('inner', [b.point(0, 0), b.point(300, 0), b.point(300, 200), b.point(0, 200), b.point(0, 100)]);
    const { manager, floorId } = createTestManager(b.document());
    expect(Object.keys(manager.document.get().floors[0]!.layout.points)).toHaveLength(5);
    manager.document.movePoints(floorId, [{ id: 'p5', x: 0, y: 200 }]);
    const layout = manager.document.get().floors[0]!.layout;
    expect(Object.keys(layout.points)).toHaveLength(4);
    expect(layout.contours[0]!.points).toHaveLength(4);
  });

  describe('ошибки: документ не тронут', () => {
    it('unknown-point — ни одна точка пакета не сдвинута', () => {
      const { manager, events, floorId } = createTestManager(ringDocument());
      events.length = 0;
      const doc = manager.document.get();
      const result = manager.document.movePoints(floorId, [
        { id: 'p1', x: 5, y: 5 },
        { id: 'ghost', x: 0, y: 0 },
      ]);
      expect(result).toEqual({ ok: false, error: { kind: 'unknown-point', id: 'ghost' } });
      expect(manager.document.get()).toBe(doc);
      expect(events).toEqual([]);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('invalid-coordinate: %p', value => {
      const { manager, floorId } = createTestManager(ringDocument());
      const doc = manager.document.get();
      expect(manager.document.movePoints(floorId, [{ id: 'p1', x: value, y: 0 }])).toEqual({
        ok: false,
        error: { kind: 'invalid-coordinate', id: 'p1' },
      });
      expect(manager.document.get()).toBe(doc);
    });

    it('unknown-floor', () => {
      const { manager } = createTestManager(ringDocument());
      expect(manager.document.movePoints('f9', [{ id: 'p1', x: 0, y: 0 }])).toEqual({
        ok: false,
        error: { kind: 'unknown-floor', floorId: 'f9' },
      });
    });
  });
});
