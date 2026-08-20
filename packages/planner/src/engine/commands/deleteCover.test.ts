import { createPlanBuilder } from '../../document/testing/planBuilder';
import { createTestManager, ringDocument } from '../testing/testManager';

const layoutOf = (m: ReturnType<typeof createTestManager>) => m.manager.document.get().floors[0]!.layout;

const HOLE = [
  { x: 100, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 200 },
  { x: 100, y: 200 },
];

describe('document.deleteCover (ADR 0018 D1, спека 02 «Полы»)', () => {
  it('одна запись истории, одно document:changed, dirty; undo возвращает планировку', () => {
    const tm = createTestManager(ringDocument());
    const { manager, events, floorId } = tm;
    manager.document.addCover(floorId, HOLE, { kind: 'inner' });
    const withHole = manager.document.get();
    const hole = layoutOf(tm).covers.find(cover => cover.kind === 'inner')!;
    manager.document.markSaved();
    events.length = 0;

    expect(manager.document.deleteCover(floorId, hole.id)).toEqual({ ok: true, value: undefined });
    // `history:changed` не летит: флаги активной зоны не менялись — запись addCover уже сделала canUndo true.
    expect(events).toEqual(['document:changed', 'document:dirty-changed']);
    expect(manager.document.isDirty()).toBe(true);

    manager.history.undo();
    expect(manager.document.get().floors[0]!.layout).toEqual(withHole.floors[0]!.layout);
  });

  it('удаление выреза: дырка исчезает, обвод хозяина остаётся целым', () => {
    const tm = createTestManager(ringDocument());
    tm.manager.document.addCover(tm.floorId, HOLE, { kind: 'inner' });
    expect(layoutOf(tm).covers.map(cover => cover.kind)).toEqual(['outer', 'inner']);
    tm.manager.document.deleteCover(tm.floorId, layoutOf(tm).covers[1]!.id);
    expect(layoutOf(tm).covers.map(cover => cover.kind)).toEqual(['outer']);
    // Точки выреза остались без владельцев и сняты GC точек в конце `normalize`.
    expect(Object.values(layoutOf(tm).points).some(point => point.x === 100 && point.y === 100)).toBe(false);
  });

  it('удаление обвода внутри комнаты: normalize тут же застилает площадь авто-полом (новая запись, ceilingHidden сбрасывается)', () => {
    const b = createPlanBuilder();
    b.ring(0, 0, 400, 300, 10);
    b.cover('outer', [b.point(10, 10), b.point(390, 10), b.point(390, 290), b.point(10, 290)], {
      ceilingHidden: true,
    });
    const tm = createTestManager(b.document());
    const before = layoutOf(tm).covers[0]!;
    expect(before.ceilingHidden).toBe(true);

    expect(tm.manager.document.deleteCover(tm.floorId, before.id)).toEqual({ ok: true, value: undefined });
    // «Комната без покрытия» в 2b недостижима: признака «пол удалён намеренно» модель не хранит,
    // поэтому фаза (5) заводит дефолтный пол на той же площади — с новым id и без флага донора.
    const after = layoutOf(tm).covers;
    expect(after).toHaveLength(1);
    expect(after[0]!.id).not.toBe(before.id);
    expect(after[0]!.ceilingHidden).toBe(false);
    expect(after[0]!.points).toEqual(before.points);
  });

  it('unknown-floor: документ — тот же объект, событий нет', () => {
    const tm = createTestManager(ringDocument());
    const before = tm.manager.document.get();
    tm.events.length = 0;
    expect(tm.manager.document.deleteCover('f-nope', layoutOf(tm).covers[0]!.id)).toEqual({
      ok: false,
      error: { kind: 'unknown-floor', floorId: 'f-nope' },
    });
    expect(tm.manager.document.get()).toBe(before);
    expect(tm.events).toEqual([]);
  });

  it('unknown-cover: документ — тот же объект, событий нет', () => {
    const tm = createTestManager(ringDocument());
    const before = tm.manager.document.get();
    tm.events.length = 0;
    expect(tm.manager.document.deleteCover(tm.floorId, 'cv-nope')).toEqual({
      ok: false,
      error: { kind: 'unknown-cover', id: 'cv-nope' },
    });
    expect(tm.manager.document.get()).toBe(before);
    expect(tm.events).toEqual([]);
  });
});
