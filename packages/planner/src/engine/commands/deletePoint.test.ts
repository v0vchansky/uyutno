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

  /**
   * Каскад D2 на непустых наборах полов/зон/cuts — обещание ADR 0018 D10, проверяемое только со стадиями
   * (3)–(6) `normalize` (0069). Ожидания здесь — **после** нормализации, а не сразу после каскада: фаза (5)
   * досоздаёт авто-пол под каждой комнатой, поэтому «пол удалён» и «полов стало 0» — разные утверждения,
   * а набор `cuts[]` пересобирается `reconcileCuts` из интерьерных участков рёбер выживших зон. Опора зоны
   * (ADR 0017 C9): каждая её вершина обязана совпасть с вершиной комнаты, иначе `normalize` зону отбракует —
   * поэтому зоны фикстур сидят на точках контура комнаты, а не висят в воздухе.
   */
  describe('владельцы: пол, зона, cut, общий id', () => {
    it('пол: вершина снята вместе с комнатой — общий id пола и контура переживает удаление', () => {
      const b = createPlanBuilder();
      const ids = pentagonRoom(b);
      const { manager, floorId } = createTestManager(b.document());
      // Авто-пол фазы (5) лёг на комнату теми же точками (ADR 0016 B4).
      expect(manager.document.get().floors[0]!.layout.covers.map(c => c.points)).toEqual([ids]);

      manager.document.deletePoint(floorId, ids[3]!);
      const layout = manager.document.get().floors[0]!.layout;
      const survivors = [ids[0], ids[1], ids[2], ids[4]];
      expect(layout.contours[0]!.points).toEqual(survivors);
      // «Угол пола едет за углом стены»: пол — те же id, без своей копии вершины.
      expect(layout.covers.map(c => c.points)).toEqual([survivors]);
      expect(layout.points[ids[3]!]).toBeUndefined();
    });

    it('пол с < 3 точек удалён: вырез схлопнулся, пол стал сплошным; данные пола сохранены', () => {
      const b = createPlanBuilder();
      const room = [b.point(0, 0), b.point(400, 0), b.point(400, 400), b.point(0, 400)];
      b.contour('inner', room);
      // Ручной пол на всю комнату с вырезом посередине: вырез авто-полом не зарастает (спека 02).
      const hole = [b.point(100, 100), b.point(200, 100), b.point(200, 200), b.point(100, 200)];
      b.cover('outer', room, { ceilingHidden: true });
      b.cover('inner', hole);
      const { manager, floorId } = createTestManager(b.document());
      expect(manager.document.get().floors[0]!.layout.covers.map(c => c.kind)).toEqual(['outer', 'inner']);

      // 4 → 3 точки: вырез жив, вершина снята.
      manager.document.deletePoint(floorId, hole[0]!);
      let layout = manager.document.get().floors[0]!.layout;
      expect(layout.covers.map(c => c.kind)).toEqual(['outer', 'inner']);
      expect(layout.covers[1]!.points).not.toContain(hole[0]);
      expect(layout.covers[1]!.points).toHaveLength(3);
      expect(layout.points[hole[0]!]).toBeUndefined();

      // 3 → 2 точки: вырез удалён целиком, пол сплошной; `ceilingHidden` пережил пересборку (донор — он сам).
      manager.document.deletePoint(floorId, hole[1]!);
      layout = manager.document.get().floors[0]!.layout;
      expect(layout.covers.map(c => c.kind)).toEqual(['outer']);
      expect(layout.covers[0]!.points).toEqual(room);
      expect(layout.covers[0]!.ceilingHidden).toBe(true);
      expect(Object.keys(layout.points).sort()).toEqual([...room].sort());
    });

    it('зона и cuts: cut с удаляемым концом удаляется; зона с < 3 точек удаляется вместе со своими cuts', () => {
      const b = createPlanBuilder();
      // Комната с серединными точками сверху и снизу — зона сидит на её вершинах (опора ADR 0017 C9).
      const room = [
        b.point(0, 0),
        b.point(150, 0),
        b.point(300, 0),
        b.point(300, 300),
        b.point(150, 300),
        b.point(0, 300),
      ];
      b.contour('inner', room);
      const doc = b.document();
      doc.floors[0]!.layout.areas.push({ id: 'a1', points: [room[0]!, room[1]!, room[4]!, room[5]!], height: 200 });
      const { manager, floorId } = createTestManager(doc);
      const firstCut = manager.document.get().floors[0]!.layout.cuts[0]!;
      // Единственная интерьерная грань зоны — перегородка по x = 150.
      expect({ a: firstCut.a, b: firstCut.b }).toEqual({ a: room[1], b: room[4] });

      manager.document.deletePoint(floorId, room[1]!);
      let layout = manager.document.get().floors[0]!.layout;
      expect(layout.areas.map(a => a.points)).toEqual([[room[0], room[4], room[5]]]);
      // Прежняя запись ушла с концом `room[1]`, новая грань зоны получила свою.
      expect(layout.cuts).toHaveLength(1);
      expect({ a: layout.cuts[0]!.a, b: layout.cuts[0]!.b }).toEqual({ a: room[0], b: room[4] });
      expect(layout.cuts[0]!.id).not.toBe(firstCut.id);

      manager.document.deletePoint(floorId, room[4]!);
      layout = manager.document.get().floors[0]!.layout;
      expect(layout.areas).toEqual([]);
      expect(layout.cuts).toEqual([]);
      expect(Object.keys(layout.points).sort()).toEqual([room[0], room[2], room[3], room[5]].sort());
    });

    it('cut удаляемой зоны, который держит выжившая зона, остаётся со своим id', () => {
      const b = createPlanBuilder();
      const p = [
        b.point(0, 0),
        b.point(150, 0),
        b.point(300, 0),
        b.point(300, 150),
        b.point(300, 300),
        b.point(150, 300),
        b.point(0, 300),
        b.point(0, 150),
      ];
      b.contour('inner', p);
      const doc = b.document();
      // `small` — треугольник, все три грани интерьерные; `top` держит одну из них (`p[7]`–`p[3]`).
      doc.floors[0]!.layout.areas.push(
        { id: 'small', points: [p[1]!, p[3]!, p[7]!], height: 200 },
        { id: 'top', points: [p[7]!, p[3]!, p[4]!, p[5]!, p[6]!], height: 220 },
      );
      const { manager, floorId } = createTestManager(doc);
      const isShared = (cut: { a: string; b: string }) => [cut.a, cut.b].sort().join() === [p[3]!, p[7]!].sort().join();
      const shared = manager.document.get().floors[0]!.layout.cuts.find(isShared)!;
      expect(manager.document.get().floors[0]!.layout.cuts).toHaveLength(3);

      manager.document.deletePoint(floorId, p[1]!);
      const layout = manager.document.get().floors[0]!.layout;
      // `small` осталась с двумя точками — удалена; `top` цела.
      expect(layout.areas.map(a => a.id)).toEqual(['top']);
      // Две грани `small` ушли с её вершиной, третью держит `top` — запись переживает пересборку со своим id.
      expect(layout.cuts.map(c => c.id)).toEqual([shared.id]);
      expect(layout.cuts[0]!).toBe(shared);
    });

    it('общий id: точка снята со всех владельцев (контур + пол + зона + cut) в одной транзакции', () => {
      const b = createPlanBuilder();
      const room = [
        b.point(0, 0),
        b.point(150, 0),
        b.point(300, 0),
        b.point(300, 300),
        b.point(150, 300),
        b.point(0, 300),
      ];
      b.contour('inner', room);
      const doc = b.document();
      doc.floors[0]!.layout.areas.push({ id: 'a1', points: [room[0]!, room[1]!, room[4]!, room[5]!], height: 200 });
      const { manager, events, floorId } = createTestManager(doc);
      const shared = room[1]!;
      const before = manager.document.get().floors[0]!.layout;
      // Один и тот же id держат контур, авто-пол, зона и запись `cuts[]`.
      expect(before.contours[0]!.points).toContain(shared);
      expect(before.covers[0]!.points).toContain(shared);
      expect(before.areas[0]!.points).toContain(shared);
      expect(before.cuts[0]!.a).toBe(shared);
      events.length = 0;

      manager.document.deletePoint(floorId, shared);
      const layout = manager.document.get().floors[0]!.layout;
      expect(layout.contours[0]!.points).not.toContain(shared);
      expect(layout.covers[0]!.points).not.toContain(shared);
      expect(layout.areas[0]!.points).not.toContain(shared);
      expect(layout.cuts.every(cut => cut.a !== shared && cut.b !== shared)).toBe(true);
      expect(layout.points[shared]).toBeUndefined();
      expect(events.filter(e => e === 'document:changed')).toHaveLength(1);
      manager.history.undo();
      expect(manager.document.get().floors[0]!.layout).toEqual(before);
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
