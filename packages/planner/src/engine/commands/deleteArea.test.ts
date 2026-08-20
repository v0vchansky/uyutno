import { createPlanBuilder } from '../../document/testing/planBuilder';
import { createTestManager } from '../testing/testManager';

/** Квадратная «комната по точкам» 300×300 без тел стен: углы — `p1..p4`. */
const roomDocument = () => {
  const b = createPlanBuilder();
  b.contour('inner', [b.point(0, 0), b.point(300, 0), b.point(300, 300), b.point(0, 300)]);
  return b.document();
};

/** Половина комнаты ниже диагонали `p1–p3`. */
const LOWER = [
  { x: 0, y: 0 },
  { x: 300, y: 0 },
  { x: 300, y: 300 },
];
/** Половина комнаты выше диагонали `p1–p3` — касается первой по этой диагонали. */
const UPPER = [
  { x: 0, y: 0 },
  { x: 300, y: 300 },
  { x: 0, y: 300 },
];

const layoutOf = (m: ReturnType<typeof createTestManager>) => m.manager.document.get().floors[0]!.layout;

describe('document.deleteArea (ADR 0018 D1; решение (1) эпика 0066)', () => {
  it('одна запись истории, одно document:changed, dirty; undo возвращает зону вместе с её cuts[]', () => {
    const tm = createTestManager(roomDocument());
    const { manager, events, floorId } = tm;
    manager.document.addArea(floorId, LOWER, 100);
    const withArea = manager.document.get();
    const id = layoutOf(tm).areas[0]!.id;
    manager.document.markSaved();
    events.length = 0;

    expect(manager.document.deleteArea(floorId, id)).toEqual({ ok: true, value: undefined });
    // `history:changed` не летит: флаги активной зоны не менялись — запись addArea уже сделала canUndo true.
    expect(events).toEqual(['document:changed', 'document:dirty-changed']);
    expect(manager.document.isDirty()).toBe(true);
    expect(layoutOf(tm).areas).toEqual([]);

    manager.history.undo();
    expect(manager.document.get().floors[0]!.layout).toEqual(withArea.floors[0]!.layout);
  });

  it('зона уходит вместе со своими записями cuts[] — их снимает normalize, а не команда', () => {
    const tm = createTestManager(roomDocument());
    tm.manager.document.addArea(tm.floorId, LOWER, 100);
    expect(layoutOf(tm).cuts).toHaveLength(1);
    tm.manager.document.deleteArea(tm.floorId, layoutOf(tm).areas[0]!.id);
    expect(layoutOf(tm).cuts).toEqual([]);
    // Точки зоны — общие с комнатой, поэтому владелец у них остался и GC их не трогает.
    expect(Object.keys(layoutOf(tm).points).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('общее ребро двух касающихся зон переживает удаление одной — со своим id', () => {
    const tm = createTestManager(roomDocument());
    tm.manager.document.addArea(tm.floorId, LOWER, 100);
    tm.manager.document.addArea(tm.floorId, UPPER, 120);
    expect(layoutOf(tm).cuts).toHaveLength(1);
    const cut = layoutOf(tm).cuts[0]!;

    tm.manager.document.deleteArea(tm.floorId, layoutOf(tm).areas[0]!.id);
    expect(layoutOf(tm).areas.map(area => area.height)).toEqual([120]);
    // Участок остался интерьерным у выжившей зоны — запись та же (id и концы сохранены).
    expect(layoutOf(tm).cuts).toEqual([cut]);

    // Ушла и вторая зона — держать участок больше некому.
    tm.manager.document.deleteArea(tm.floorId, layoutOf(tm).areas[0]!.id);
    expect(layoutOf(tm).cuts).toEqual([]);
  });

  it('unknown-floor: документ — тот же объект, событий нет', () => {
    const tm = createTestManager(roomDocument());
    tm.manager.document.addArea(tm.floorId, LOWER, 100);
    const before = tm.manager.document.get();
    tm.events.length = 0;
    expect(tm.manager.document.deleteArea('f-nope', layoutOf(tm).areas[0]!.id)).toEqual({
      ok: false,
      error: { kind: 'unknown-floor', floorId: 'f-nope' },
    });
    expect(tm.manager.document.get()).toBe(before);
    expect(tm.events).toEqual([]);
  });

  it('unknown-area: документ — тот же объект, событий нет', () => {
    const tm = createTestManager(roomDocument());
    tm.manager.document.addArea(tm.floorId, LOWER, 100);
    const before = tm.manager.document.get();
    tm.events.length = 0;
    expect(tm.manager.document.deleteArea(tm.floorId, 'ar-nope')).toEqual({
      ok: false,
      error: { kind: 'unknown-area', id: 'ar-nope' },
    });
    expect(tm.manager.document.get()).toBe(before);
    expect(tm.events).toEqual([]);
  });
});
