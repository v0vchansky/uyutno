import { createPlanBuilder, type PlanBuilder } from '../../document/testing/planBuilder';
import { createTestManager, ringDocument } from '../testing/testManager';

/** Пятиугольная комната по точкам p1..p5 (без стен). */
const pentagonRoom = (b: PlanBuilder): string[] => {
  const ids = [b.point(0, 0), b.point(300, 0), b.point(300, 200), b.point(150, 300), b.point(0, 200)];
  b.contour('inner', ids);
  return ids;
};

describe('document.deletePoint (ADR 0018 D2)', () => {
  it('точка контура: снята с контура, вычищена из пула normalize; одна запись, одно document:changed', () => {
    const b = createPlanBuilder();
    const ids = pentagonRoom(b);
    const { manager, events, floorId } = createTestManager(b.document());
    events.length = 0;
    expect(manager.document.deletePoint(floorId, ids[3]!)).toEqual({ ok: true, value: undefined });
    const layout = manager.document.get().floors[0]!.layout;
    expect(layout.contours[0]!.points).toEqual([ids[0], ids[1], ids[2], ids[4]]);
    expect(layout.points[ids[3]!]).toBeUndefined();
    expect(events).toEqual(['document:changed', 'history:changed', 'document:dirty-changed']);
    expect(manager.document.getDerived().floors[0]!.rooms[0]!.area).toBe(300 * 200);
    manager.history.undo();
    expect(manager.document.get().floors[0]!.layout.contours[0]!.points).toEqual(ids);
  });

  it('контур с 3 точками после удаления → удалён целиком вместе с точками и записью комнаты в производном', () => {
    const b = createPlanBuilder();
    b.contour('inner', [b.point(0, 0), b.point(300, 0), b.point(150, 200)]);
    const { manager, floorId } = createTestManager(b.document());
    expect(manager.document.getDerived().floors[0]!.rooms).toHaveLength(1);
    manager.document.deletePoint(floorId, 'p1');
    const layout = manager.document.get().floors[0]!.layout;
    expect(layout.contours).toEqual([]);
    expect(layout.points).toEqual({});
    expect(manager.document.getDerived().floors[0]!.rooms).toEqual([]);
  });

  it('outer с 3 точками после удаления → тело стены исчезает целиком', () => {
    const b = createPlanBuilder();
    b.contour('outer', [b.point(0, 0), b.point(300, 0), b.point(150, 200)]);
    const { manager, floorId } = createTestManager(b.document());
    expect(manager.document.getDerived().floors[0]!.walls).toHaveLength(1);
    expect(manager.document.deletePoint(floorId, 'p2').ok).toBe(true);
    const layout = manager.document.get().floors[0]!.layout;
    expect(layout.contours).toEqual([]);
    expect(layout.points).toEqual({});
    expect(manager.document.getDerived().floors[0]!.walls).toEqual([]);
  });

  it('стены: удаление вершины тела стены (outer) — соседние грани слиты в одну, тело осталось', () => {
    const b = createPlanBuilder();
    // Г-образное тело стены из 6 вершин; p6 — вершина внутреннего угла.
    const ids = [
      b.point(0, 0),
      b.point(300, 0),
      b.point(300, 100),
      b.point(100, 100),
      b.point(100, 300),
      b.point(0, 300),
    ];
    b.contour('outer', ids);
    const { manager, floorId } = createTestManager(b.document());
    expect(manager.document.getDerived().floors[0]!.walls).toHaveLength(1);
    expect(manager.document.deletePoint(floorId, ids[3]!).ok).toBe(true);
    const layout = manager.document.get().floors[0]!.layout;
    expect(layout.contours).toHaveLength(1);
    expect(layout.contours[0]!.points).toHaveLength(5);
    expect(layout.points[ids[3]!]).toBeUndefined();
    expect(manager.document.getDerived().floors[0]!.walls).toHaveLength(1);
  });

  describe('владельцы: пол, зона, cut, общий id', () => {
    it('пол: точка снята; пол с < 3 точек удалён', () => {
      const b = createPlanBuilder();
      const doc = b.document();
      const cover = [b.point(0, 0), b.point(100, 0), b.point(100, 100), b.point(0, 100)];
      doc.floors[0]!.layout.covers.push({ id: 'cv1', points: cover });
      const { manager, floorId } = createTestManager(doc);
      manager.document.deletePoint(floorId, cover[0]!);
      let layout = manager.document.get().floors[0]!.layout;
      expect(layout.covers[0]!.points).toEqual(cover.slice(1));
      expect(layout.points[cover[0]!]).toBeUndefined();
      manager.document.deletePoint(floorId, cover[1]!);
      layout = manager.document.get().floors[0]!.layout;
      expect(layout.covers).toEqual([]);
      expect(layout.points).toEqual({});
    });

    it('зона и cuts: cut с удаляемым концом удаляется; зона с < 3 точек удаляется вместе со своими cuts', () => {
      const b = createPlanBuilder();
      const doc = b.document();
      const area = [b.point(0, 0), b.point(100, 0), b.point(100, 100), b.point(0, 100)];
      const other = [b.point(500, 0), b.point(600, 0), b.point(600, 100)];
      const layout0 = doc.floors[0]!.layout;
      layout0.areas.push({ id: 'a1', points: area, height: 200 }, { id: 'a2', points: other, height: 200 });
      layout0.cuts.push(
        { id: 'cut-ab', a: area[0]!, b: area[1]! },
        { id: 'cut-cd', a: area[2]!, b: area[3]! },
        { id: 'cut-other', a: other[0]!, b: other[1]! },
      );
      const { manager, floorId } = createTestManager(doc);

      manager.document.deletePoint(floorId, area[0]!);
      let layout = manager.document.get().floors[0]!.layout;
      expect(layout.areas.map(a => a.points)).toEqual([area.slice(1), other]);
      expect(layout.cuts.map(c => c.id)).toEqual(['cut-cd', 'cut-other']);

      manager.document.deletePoint(floorId, area[1]!);
      layout = manager.document.get().floors[0]!.layout;
      expect(layout.areas.map(a => a.id)).toEqual(['a2']);
      // `cut-cd` — cut удалённой зоны (оба конца среди её точек) — ушёл с ней; чужой cut остался.
      expect(layout.cuts.map(c => c.id)).toEqual(['cut-other']);
      expect(Object.keys(layout.points).sort()).toEqual([...other].sort());
    });

    it('cut удаляемой зоны, который держит выжившая зона (те же две точки), остаётся', () => {
      const b = createPlanBuilder();
      const doc = b.document();
      const shared = [b.point(0, 0), b.point(100, 0)];
      const small = [...shared, b.point(50, 50)];
      const big = [...shared, b.point(100, 100), b.point(0, 100)];
      const layout0 = doc.floors[0]!.layout;
      layout0.areas.push({ id: 'small', points: small, height: 200 }, { id: 'big', points: big, height: 200 });
      layout0.cuts.push(
        { id: 'cut-shared', a: shared[0]!, b: shared[1]! },
        { id: 'cut-small', a: shared[1]!, b: small[2]! },
      );
      const { manager, floorId } = createTestManager(doc);
      manager.document.deletePoint(floorId, small[2]!);
      const layout = manager.document.get().floors[0]!.layout;
      expect(layout.areas.map(a => a.id)).toEqual(['big']);
      expect(layout.cuts.map(c => c.id)).toEqual(['cut-shared']);
    });

    it('общий id: точка снята со всех владельцев (контур + пол + зона + cut) в одной транзакции', () => {
      const b = createPlanBuilder();
      const doc = b.document();
      const ids = pentagonRoom(b);
      const shared = ids[0]!;
      const layout0 = doc.floors[0]!.layout;
      layout0.covers.push({ id: 'cv1', points: [shared, ids[1]!, ids[2]!, ids[4]!] });
      layout0.areas.push({ id: 'a1', points: [shared, ids[1]!, ids[2]!, ids[3]!], height: 200 });
      layout0.cuts.push({ id: 'cut1', a: shared, b: ids[1]! }, { id: 'cut2', a: ids[1]!, b: ids[2]! });
      const { manager, events, floorId } = createTestManager(doc);
      events.length = 0;

      manager.document.deletePoint(floorId, shared);
      const layout = manager.document.get().floors[0]!.layout;
      expect(layout.contours[0]!.points).not.toContain(shared);
      expect(layout.covers[0]!.points).toEqual([ids[1], ids[2], ids[4]]);
      expect(layout.areas[0]!.points).toEqual([ids[1], ids[2], ids[3]]);
      expect(layout.cuts.map(c => c.id)).toEqual(['cut2']);
      expect(layout.points[shared]).toBeUndefined();
      expect(events.filter(e => e === 'document:changed')).toHaveLength(1);
      manager.history.undo();
      expect(manager.document.get().floors[0]!.layout.points[shared]).toBeDefined();
    });
  });

  describe('ошибки', () => {
    it('unknown-point — документ тот же, событий нет', () => {
      const { manager, events, floorId } = createTestManager(ringDocument());
      events.length = 0;
      const doc = manager.document.get();
      expect(manager.document.deletePoint(floorId, 'ghost')).toEqual({
        ok: false,
        error: { kind: 'unknown-point', id: 'ghost' },
      });
      expect(manager.document.get()).toBe(doc);
      expect(events).toEqual([]);
    });

    it('unknown-floor', () => {
      const { manager } = createTestManager(ringDocument());
      expect(manager.document.deletePoint('f9', 'p1')).toEqual({
        ok: false,
        error: { kind: 'unknown-floor', floorId: 'f9' },
      });
    });
  });
});
