import * as fc from 'fast-check';

import { arbQuantizedPoint, fcParams } from '../document/geometry/testing/arbitraries';
import { createId, type Id } from '../document/id';
import {
  type Contour,
  type Floor,
  type FloorLayout,
  type PlannerDocument,
  type Point,
  createEmptyDocument,
  createEmptyFloor,
} from '../document/PlannerDocument';
import { SnapCandidateIndex, buildSnapIndex } from './SnapCandidateIndex';

const emptyLayout = (): FloorLayout => createEmptyFloor().layout;
const contour = (points: Id[]): Contour => ({ id: createId(), kind: 'outer', points });

/** Планировка с точками по списку координат; возвращает layout и id точек в порядке списка. */
const layoutWith = (coords: readonly [number, number][]): { layout: FloorLayout; ids: Id[] } => {
  const layout = emptyLayout();
  const ids = coords.map(([x, y]) => {
    const id = createId();
    layout.points[id] = { id, x, y };
    return id;
  });
  return { layout, ids };
};

const byId = (index: ReturnType<typeof buildSnapIndex>, id: Id) => index.candidates.find(c => c.id === id);

describe('buildSnapIndex', () => {
  it('пустой layout → пусто', () => {
    expect(buildSnapIndex(emptyLayout())).toEqual({ candidates: [], segments: [] });
  });

  it('по одному кандидату на точку layout.points, координаты и id совпадают, без prev/next у осиротевших', () => {
    const { layout, ids } = layoutWith([
      [0, 0],
      [10, 20],
      [-5, 7],
    ]);
    const index = buildSnapIndex(layout);
    expect(index.candidates).toHaveLength(3);
    expect(index.candidates.map(c => c.id).sort()).toEqual([...ids].sort());
    const second = byId(index, ids[1]!)!;
    expect(second).toEqual({ id: ids[1], x: 10, y: 20 });
    expect(Object.keys(second)).toEqual(['id', 'x', 'y']);
    expect(index.segments).toEqual([]);
  });

  it('кандидат — плоская копия, не ссылка на Point документа', () => {
    const { layout, ids } = layoutWith([[1, 2]]);
    const index = buildSnapIndex(layout);
    expect(index.candidates[0]).not.toBe(layout.points[ids[0]!]);
  });

  it('соседи из кольца контура с wrap-around; segments — рёбра контура с замыканием', () => {
    const { layout, ids } = layoutWith([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    layout.contours.push(contour([...ids]));
    const index = buildSnapIndex(layout);
    const pts = ids.map(id => layout.points[id]!);
    expect(byId(index, ids[0]!)!.prev).toBe(pts[3]);
    expect(byId(index, ids[0]!)!.next).toBe(pts[1]);
    expect(byId(index, ids[3]!)!.prev).toBe(pts[2]);
    expect(byId(index, ids[3]!)!.next).toBe(pts[0]);
    expect(index.segments).toEqual([
      { a: pts[0], b: pts[1] },
      { a: pts[1], b: pts[2] },
      { a: pts[2], b: pts[3] },
      { a: pts[3], b: pts[0] },
    ]);
  });

  it('общая вершина двух контуров — соседи от первого контура (по порядку contours), кандидат один', () => {
    const { layout, ids } = layoutWith([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [200, 0],
      [200, 100],
    ]);
    const [a, b, c, d, e, f] = ids as [Id, Id, Id, Id, Id, Id];
    layout.contours.push(contour([a, b, c, d]));
    layout.contours.push(contour([b, e, f, c]));
    const index = buildSnapIndex(layout);
    expect(index.candidates.filter(candidate => candidate.id === b)).toHaveLength(1);
    // В первом контуре соседи b: prev = a, next = c; во втором были бы prev = c, next = e.
    expect(byId(index, b)!.prev).toBe(layout.points[a]);
    expect(byId(index, b)!.next).toBe(layout.points[c]);
    // Точка e — только во втором контуре: соседи оттуда.
    expect(byId(index, e)!.prev).toBe(layout.points[b]);
    expect(byId(index, e)!.next).toBe(layout.points[f]);
    // Рёбра обоих контуров.
    expect(index.segments).toHaveLength(8);
  });

  it('приоритет колец: contours → covers → areas', () => {
    const { layout, ids } = layoutWith([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [50, -50],
      [-50, 50],
    ]);
    const [a, b, c, d, e, f] = ids as [Id, Id, Id, Id, Id, Id];
    layout.areas.push({ id: createId(), points: [a, e, f], height: 200 });
    layout.covers.push({ id: createId(), points: [a, b, f] });
    layout.contours.push(contour([a, b, c, d]));
    const index = buildSnapIndex(layout);
    // a — во всех трёх: соседи из contour (prev d, next b).
    expect(byId(index, a)!.prev).toBe(layout.points[d]);
    expect(byId(index, a)!.next).toBe(layout.points[b]);
    // f — в cover и area: из cover (prev b, next a).
    expect(byId(index, f)!.prev).toBe(layout.points[b]);
    expect(byId(index, f)!.next).toBe(layout.points[a]);
    // e — только в area: prev a, next f.
    expect(byId(index, e)!.prev).toBe(layout.points[a]);
    expect(byId(index, e)!.next).toBe(layout.points[f]);
  });

  it('кольцо из 2 точек соседей не даёт, но даёт одно ребро (contours)', () => {
    const { layout, ids } = layoutWith([
      [0, 0],
      [100, 0],
    ]);
    layout.contours.push(contour([...ids]));
    const index = buildSnapIndex(layout);
    index.candidates.forEach(candidate => {
      expect(candidate.prev).toBeUndefined();
      expect(candidate.next).toBeUndefined();
    });
    expect(index.segments).toEqual([{ a: layout.points[ids[0]!], b: layout.points[ids[1]!] }]);
  });

  it('кольцо из 1 точки — ни соседей, ни рёбер', () => {
    const { layout, ids } = layoutWith([[0, 0]]);
    layout.contours.push(contour([...ids]));
    const index = buildSnapIndex(layout);
    expect(index.candidates[0]!.prev).toBeUndefined();
    expect(index.segments).toEqual([]);
  });

  it('осиротевшая точка (нет ни в одном кольце) — кандидат без prev/next', () => {
    const { layout, ids } = layoutWith([
      [0, 0],
      [100, 0],
      [100, 100],
      [500, 500],
    ]);
    layout.contours.push(contour(ids.slice(0, 3)));
    const index = buildSnapIndex(layout);
    expect(index.candidates).toHaveLength(4);
    const orphan = byId(index, ids[3]!)!;
    expect(orphan.prev).toBeUndefined();
    expect(orphan.next).toBeUndefined();
    expect(byId(index, ids[1]!)!.prev).toBeDefined();
  });

  it('ссылки на несуществующие id в кольце пропускаются (кольцо считается по живым точкам)', () => {
    const { layout, ids } = layoutWith([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
    const ghost = createId();
    layout.contours.push(contour([ids[0]!, ghost, ids[1]!, ids[2]!]));
    const index = buildSnapIndex(layout);
    expect(index.candidates).toHaveLength(3);
    expect(index.candidates.map(c => c.id)).not.toContain(ghost);
    // Кольцо живых точек: [p0, p1, p2] — соседи p0: prev p2, next p1 (призрак выпал).
    expect(byId(index, ids[0]!)!.prev).toBe(layout.points[ids[2]!]);
    expect(byId(index, ids[0]!)!.next).toBe(layout.points[ids[1]!]);
    expect(index.segments).toHaveLength(3);
  });

  it('кольцо, где после выпадения призраков осталось < 3 точек, соседей не даёт', () => {
    const { layout, ids } = layoutWith([
      [0, 0],
      [100, 0],
    ]);
    layout.contours.push(contour([ids[0]!, createId(), ids[1]!]));
    const index = buildSnapIndex(layout);
    index.candidates.forEach(candidate => expect(candidate.prev).toBeUndefined());
    expect(index.segments).toHaveLength(1);
  });

  it('segments — только из contours (не covers/areas)', () => {
    const { layout, ids } = layoutWith([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
    layout.covers.push({ id: createId(), points: [...ids] });
    layout.areas.push({ id: createId(), points: [...ids], height: 200 });
    const index = buildSnapIndex(layout);
    expect(index.segments).toEqual([]);
    // При этом соседи из cover есть.
    expect(byId(index, ids[0]!)!.prev).toBeDefined();
  });

  it('property: число кандидатов = число точек, id уникальны, координаты совпадают, рёбер = Σ по контурам', () => {
    fc.assert(
      fc.property(
        fc.array(arbQuantizedPoint, { maxLength: 10 }),
        fc.array(fc.array(fc.nat({ max: 20 }), { maxLength: 6 }), { maxLength: 3 }),
        (coords, rings) => {
          const { layout, ids } = layoutWith(coords.map(point => [point.x, point.y]));
          rings.forEach(ring => {
            layout.contours.push(contour(ring.map(i => ids[i] ?? `ghost-${i}`)));
          });
          const index = buildSnapIndex(layout);
          expect(index.candidates).toHaveLength(coords.length);
          expect(new Set(index.candidates.map(c => c.id)).size).toBe(coords.length);
          index.candidates.forEach(candidate => {
            const point = layout.points[candidate.id]!;
            expect(candidate.x).toBe(point.x);
            expect(candidate.y).toBe(point.y);
            if (candidate.prev) expect(candidate.next).toBeDefined();
          });
          const expectedSegments = layout.contours.reduce((sum, contour) => {
            const live = contour.points.filter(id => layout.points[id] !== undefined).length;
            return sum + (live < 2 ? 0 : live === 2 ? 1 : live);
          }, 0);
          expect(index.segments).toHaveLength(expectedSegments);
        },
      ),
      fcParams,
    );
  });
});

describe('SnapCandidateIndex', () => {
  const withPoints = (): { document: PlannerDocument; floor: Floor; ids: Id[] } => {
    const document = createEmptyDocument();
    const floor = document.floors[0]!;
    const { layout, ids } = layoutWith([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
    layout.contours.push(contour([...ids]));
    floor.layout = layout;
    return { document, floor, ids };
  };

  it('строит индекс этажа по документу', () => {
    const { document, floor, ids } = withPoints();
    const index = new SnapCandidateIndex().get(document, floor.id);
    expect(index.candidates.map(c => c.id).sort()).toEqual([...ids].sort());
    expect(index.segments).toHaveLength(3);
    expect(index).toEqual(buildSnapIndex(floor.layout));
  });

  it('мемоизация: одна и та же ссылка при одном document и floorId', () => {
    const { document, floor } = withPoints();
    const cache = new SnapCandidateIndex();
    const first = cache.get(document, floor.id);
    expect(cache.get(document, floor.id)).toBe(first);
    expect(cache.get(document, floor.id)).toBe(first);
  });

  it('новый документ (createEmptyDocument) → своя сборка; изменённая копия → пересборка', () => {
    const { document, floor } = withPoints();
    const cache = new SnapCandidateIndex();
    const first = cache.get(document, floor.id);

    const other = createEmptyDocument();
    const otherIndex = cache.get(other, other.floors[0]!.id);
    expect(otherIndex).not.toBe(first);
    expect(otherIndex.candidates).toEqual([]);

    // Иммутабельная копия с добавленной точкой — новая ссылка документа → пересборка.
    const extraId = createId();
    const extra: Point = { id: extraId, x: 500, y: 500 };
    const changed: PlannerDocument = {
      ...document,
      floors: [{ ...floor, layout: { ...floor.layout, points: { ...floor.layout.points, [extraId]: extra } } }],
    };
    const rebuilt = cache.get(changed, floor.id);
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.candidates).toHaveLength(4);
    expect(rebuilt.candidates.map(c => c.id)).toContain(extraId);
    // Старый снимок по-прежнему в кеше (undo/redo на прежнюю ссылку).
    expect(cache.get(document, floor.id)).toBe(first);
    expect(first.candidates).toHaveLength(3);
  });

  it('мутация документа in-place без смены ссылки не пересобирает (контракт «только транзакцией»)', () => {
    const { document, floor } = withPoints();
    const cache = new SnapCandidateIndex();
    const first = cache.get(document, floor.id);
    const id = createId();
    floor.layout.points[id] = { id, x: 1, y: 1 };
    expect(cache.get(document, floor.id)).toBe(first);
    expect(first.candidates).toHaveLength(3);
  });

  it('разные floorId одного документа — независимые записи кеша', () => {
    const { document, floor } = withPoints();
    const secondFloor = createEmptyFloor();
    document.floors.push(secondFloor);
    const cache = new SnapCandidateIndex();
    const a = cache.get(document, floor.id);
    const b = cache.get(document, secondFloor.id);
    expect(a).not.toBe(b);
    expect(b.candidates).toEqual([]);
    expect(cache.get(document, floor.id)).toBe(a);
    expect(cache.get(document, secondFloor.id)).toBe(b);
  });

  it('неизвестный floorId → пустой индекс (заморожен, стабильная ссылка)', () => {
    const { document } = withPoints();
    const cache = new SnapCandidateIndex();
    const missing = cache.get(document, 'no-such-floor');
    expect(missing).toEqual({ candidates: [], segments: [] });
    expect(Object.isFrozen(missing)).toBe(true);
    expect(cache.get(document, 'no-such-floor')).toBe(missing);
    expect(cache.get(createEmptyDocument(), 'no-such-floor')).toBe(missing);
  });

  it('результат заморожен глубоко (Object.isFrozen на индексе и массивах)', () => {
    const { document, floor } = withPoints();
    const index = new SnapCandidateIndex().get(document, floor.id);
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(index.candidates)).toBe(true);
    expect(Object.isFrozen(index.segments)).toBe(true);
  });

  it('ключ кеша — ссылка на layout: новый документ с той же планировкой (смена view/settings) индекс не пересобирает', () => {
    const { document, floor } = withPoints();
    const cache = new SnapCandidateIndex();
    const first = cache.get(document, floor.id);
    const viewChanged: PlannerDocument = { ...document, view: { ...document.view, activeView: 'plan' } };
    expect(cache.get(viewChanged, floor.id)).toBe(first);
    const sceneChanged: PlannerDocument = { ...document, floors: [{ ...floor, scene: { ...floor.scene } }] };
    expect(cache.get(sceneChanged, floor.id)).toBe(first);
  });

  it('разные экземпляры индекса не делят кеш', () => {
    const { document, floor } = withPoints();
    const a = new SnapCandidateIndex().get(document, floor.id);
    const b = new SnapCandidateIndex().get(document, floor.id);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
