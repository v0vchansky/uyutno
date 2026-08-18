import { MIN_WALL_LENGTH } from '../../document/geometry/contours/validateContour';
import { createPlanBuilder } from '../../document/testing/planBuilder';
import { createTestManager, ringDocument } from '../testing/testManager';
import { edgeLengthCoalesceKey, MAX_EDGE_LENGTH } from './setEdgeLength';

const pointOf = (m: ReturnType<typeof createTestManager>, id: string) =>
  m.manager.document.get().floors[0]!.layout.points[id]!;

describe('document.setEdgeLength (ADR 0018 D1, спека 01/07)', () => {
  it('без anchor: оба конца симметрично на ±Δ/2 по направлению ребра; одна запись, одно document:changed', () => {
    const tm = createTestManager(ringDocument());
    const { manager, events, floorId } = tm;
    events.length = 0;
    expect(manager.document.setEdgeLength(floorId, { a: 'p1', b: 'p2' }, 500)).toEqual({ ok: true, value: undefined });
    expect(pointOf(tm, 'p1')).toEqual({ id: 'p1', x: -50, y: 0 });
    expect(pointOf(tm, 'p2')).toEqual({ id: 'p2', x: 450, y: 0 });
    expect(events).toEqual(['document:changed', 'history:changed', 'document:dirty-changed']);
    expect(manager.history.get()).toEqual({ canUndo: true, canRedo: false });
    manager.history.undo();
    expect(manager.history.get()).toEqual({ canUndo: false, canRedo: true });
    expect(pointOf(tm, 'p1')).toEqual({ id: 'p1', x: 0, y: 0 });
    manager.history.redo();
    // Соседние рёбра тянутся вместе с концами: p4–p1 и p2–p3 стали наклонными, но контур цел.
    expect(manager.document.get().floors[0]!.layout.contours.map(c => c.kind)).toEqual(['outer', 'inner']);
  });

  it('с anchor: вся Δ на противоположный конец', () => {
    const tm = createTestManager(ringDocument());
    const { manager, floorId } = tm;
    manager.document.setEdgeLength(floorId, { a: 'p1', b: 'p2' }, 500, { anchor: 'p1' });
    expect(pointOf(tm, 'p1')).toEqual({ id: 'p1', x: 0, y: 0 });
    expect(pointOf(tm, 'p2')).toEqual({ id: 'p2', x: 500, y: 0 });
    manager.document.setEdgeLength(floorId, { a: 'p1', b: 'p2' }, 400, { anchor: 'p2' });
    expect(pointOf(tm, 'p1')).toEqual({ id: 'p1', x: 100, y: 0 });
    expect(pointOf(tm, 'p2')).toEqual({ id: 'p2', x: 500, y: 0 });
  });

  it('укорачивание и наклонное ребро: координаты квантованы, длина после = заданной (±0.001)', () => {
    const b = createPlanBuilder();
    b.contour('inner', [b.point(0, 0), b.point(300, 0), b.point(300, 300), b.point(0, 300)]);
    const tm = createTestManager(b.document());
    const { manager, floorId } = tm;
    // Диагональ p1–p3 — не ребро контура, но команда адресует любую пару точек: длина 424.264 → 100.
    manager.document.setEdgeLength(floorId, { a: 'p1', b: 'p3' }, 100);
    const p1 = pointOf(tm, 'p1');
    const p3 = pointOf(tm, 'p3');
    expect(Math.hypot(p3.x - p1.x, p3.y - p1.y)).toBeCloseTo(100, 2);
    expect(Number.isInteger(p1.x * 1000) && Number.isInteger(p1.y * 1000)).toBe(true);
  });

  it('коалесинг: серия правок одного ребра = одна запись; другое ребро — новая запись', () => {
    const tm = createTestManager(ringDocument());
    const { manager, floorId } = tm;
    const layout0 = manager.document.get().floors[0]!.layout;
    manager.document.setEdgeLength(floorId, { a: 'p1', b: 'p2' }, 500);
    manager.document.setEdgeLength(floorId, { a: 'p1', b: 'p2' }, 600);
    manager.document.setEdgeLength(floorId, { a: 'p1', b: 'p2' }, 450);
    expect(pointOf(tm, 'p2').x).toBe(425);
    manager.history.undo();
    expect(manager.document.get().floors[0]!.layout).toBe(layout0);
    manager.history.redo();
    manager.document.setEdgeLength(floorId, { a: 'p2', b: 'p3' }, 350);
    manager.history.undo();
    expect(pointOf(tm, 'p2').x).toBe(425);
    expect(edgeLengthCoalesceKey({ a: 'p1', b: 'p2' })).toBe('edge-length:p1|p2');
  });

  it('та же длина — no-op без записи', () => {
    const { manager, events, floorId } = createTestManager(ringDocument());
    events.length = 0;
    expect(manager.document.setEdgeLength(floorId, { a: 'p1', b: 'p2' }, 400).ok).toBe(true);
    expect(events).toEqual([]);
  });

  describe('ошибки: документ тот же, событий нет', () => {
    const expectRejected = (
      tm: ReturnType<typeof createTestManager>,
      run: () => { ok: boolean; error?: unknown },
      error: unknown,
    ): void => {
      tm.events.length = 0;
      const doc = tm.manager.document.get();
      expect(run()).toEqual({ ok: false, error });
      expect(tm.manager.document.get()).toBe(doc);
      expect(tm.events).toEqual([]);
    };

    it.each([0, 14.999, -10])('too-short: %p', length => {
      const tm = createTestManager(ringDocument());
      expectRejected(tm, () => tm.manager.document.setEdgeLength(tm.floorId, { a: 'p1', b: 'p2' }, length), {
        kind: 'too-short',
        length,
        min: MIN_WALL_LENGTH,
      });
    });

    it('граница: ровно MIN_WALL_LENGTH и MAX_EDGE_LENGTH проходят', () => {
      const tm = createTestManager(ringDocument());
      expect(tm.manager.document.setEdgeLength(tm.floorId, { a: 'p1', b: 'p2' }, MIN_WALL_LENGTH).ok).toBe(true);
      expect(tm.manager.document.setEdgeLength(tm.floorId, { a: 'p1', b: 'p2' }, MAX_EDGE_LENGTH).ok).toBe(true);
    });

    it.each([100_000.001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      'out-of-range: %p',
      length => {
        const tm = createTestManager(ringDocument());
        expectRejected(tm, () => tm.manager.document.setEdgeLength(tm.floorId, { a: 'p1', b: 'p2' }, length), {
          kind: 'out-of-range',
          length,
          max: MAX_EDGE_LENGTH,
        });
      },
    );

    it('unknown-point: конец ребра или anchor вне ребра', () => {
      const tm = createTestManager(ringDocument());
      expectRejected(tm, () => tm.manager.document.setEdgeLength(tm.floorId, { a: 'zz', b: 'p2' }, 100), {
        kind: 'unknown-point',
        id: 'zz',
      });
      expectRejected(tm, () => tm.manager.document.setEdgeLength(tm.floorId, { a: 'p1', b: 'zz' }, 100), {
        kind: 'unknown-point',
        id: 'zz',
      });
      expectRejected(
        tm,
        () => tm.manager.document.setEdgeLength(tm.floorId, { a: 'p1', b: 'p2' }, 100, { anchor: 'p3' }),
        {
          kind: 'unknown-point',
          id: 'p3',
        },
      );
    });

    it('unknown-floor', () => {
      const tm = createTestManager(ringDocument());
      expectRejected(tm, () => tm.manager.document.setEdgeLength('f9', { a: 'p1', b: 'p2' }, 100), {
        kind: 'unknown-floor',
        floorId: 'f9',
      });
    });

    it('contour-self-intersected: удлинение дна выемки протыкает соседние стороны', () => {
      const b = createPlanBuilder();
      const ids = [
        b.point(0, 0),
        b.point(300, 0),
        b.point(300, 300),
        b.point(200, 300),
        b.point(200, 100),
        b.point(100, 100),
        b.point(100, 300),
        b.point(0, 300),
      ];
      b.contour('inner', ids);
      const tm = createTestManager(b.document());
      expectRejected(tm, () => tm.manager.document.setEdgeLength(tm.floorId, { a: ids[4]!, b: ids[5]! }, 400), {
        kind: 'contour-self-intersected',
      });
      // Небольшое изменение той же выемки проходит.
      expect(tm.manager.document.setEdgeLength(tm.floorId, { a: ids[4]!, b: ids[5]! }, 120).ok).toBe(true);
    });

    it('degenerate-edge: концы совпадают (две точки пола в одной координате)', () => {
      const b = createPlanBuilder();
      const doc = b.document();
      const cover = [b.point(0, 0), b.point(0, 0), b.point(100, 0), b.point(100, 100)];
      doc.floors[0]!.layout.covers.push({ id: 'cv1', points: cover });
      const tm = createTestManager(doc);
      expectRejected(tm, () => tm.manager.document.setEdgeLength(tm.floorId, { a: cover[0]!, b: cover[1]! }, 100), {
        kind: 'degenerate-edge',
      });
    });
  });
});
