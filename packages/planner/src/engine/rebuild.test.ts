import * as fc from 'fast-check';
import { Immer, freeze } from 'immer';

import { contourArea, contourValid } from '../document/geometry/predicates/contourArea';
import { contourSelfIntersected } from '../document/geometry/predicates/contourSelfIntersected';
import { arbConvexPolygon, fcParams } from '../document/geometry/testing/arbitraries';
import {
  createEmptyDocument,
  createEmptyFloor,
  type FloorLayout,
  type PlanPosition,
  type PlannerDocument,
} from '../document/PlannerDocument';
import { createPlanBuilder, createSequentialIds, type PlanBuilder } from '../document/testing/planBuilder';
import { normalize, rebuild } from './rebuild';

const immer = new Immer({ autoFreeze: true });

const normalized = (doc: PlannerDocument, prefix = 'n', warnings: string[] = []): PlannerDocument =>
  immer.produce(freeze(doc, true), draft =>
    normalize(draft, { createId: createSequentialIds(prefix), warn: m => warnings.push(m) }),
  );

const layoutOf = (doc: PlannerDocument): FloorLayout => doc.floors[0]!.layout;
const coords = (layout: FloorLayout, ids: readonly string[]): PlanPosition[] =>
  ids.map(id => {
    const p = layout.points[id]!;
    return { x: p.x, y: p.y };
  });

/** Кольцо 400×300 толщиной 10 — «4 стены → 1 комната». */
const ringDocument = (): { doc: PlannerDocument; b: PlanBuilder; inner: string[]; outer: string[] } => {
  const b = createPlanBuilder();
  const { inner, outer } = b.ring(0, 0, 400, 300, 10);
  return { doc: b.document(), b, inner, outer };
};

describe('normalize', () => {
  describe('переписывание contours/points результатом слияния (ADR 0017 C1/C6)', () => {
    it('4 квада ленты → outer-обвод тела + inner-комната; квады исчезают, точки переиспользуются по координате', () => {
      const { doc, inner, outer } = ringDocument();
      const layout = layoutOf(normalized(doc));
      expect(layout.contours.map(c => c.kind)).toEqual(['outer', 'inner']);
      // Ни одной новой точки: все вершины результата совпали с существующими по квантованной координате.
      expect(Object.keys(layout.points).sort()).toEqual([...outer, ...inner].sort());
      expect(layout.contours[0]!.points).toEqual(outer);
      expect(layout.contours[1]!.points).toEqual(inner);
      // Ориентация — против часовой (площадь > 0), старт — вершина min-X/min-Y.
      for (const contour of layout.contours) expect(contourArea(coords(layout, contour.points))).toBeGreaterThan(0);
    });

    it('новые вершины (пересечения) получают id из инжектированного генератора в детерминированном порядке', () => {
      const b = createPlanBuilder();
      b.rect('outer', 0, 0, 100, 10);
      b.rect('outer', 45, -50, 55, 50); // крест: 4 точки пересечения
      const layout = layoutOf(normalized(b.document()));
      const created = Object.keys(layout.points).filter(id => id.startsWith('n'));
      expect(created).toEqual(['n1', 'n2', 'n3', 'n4']);
      expect(layout.contours).toHaveLength(1);
      expect(layout.contours[0]!.id).toBe('n5');
    });

    it('две точки в одной координате — одна: выживает меньший id, вторая удаляется вместе с осиротевшими', () => {
      const b = createPlanBuilder();
      const { outer, inner } = b.ring(0, 0, 400, 300, 10);
      const duplicate = b.point(10, 10); // p9 — дубль p5
      b.contour('outer', [duplicate, b.point(10, -50), b.point(60, -50), b.point(60, 10)]);
      const layout = layoutOf(normalized(b.document()));
      expect(layout.points[duplicate]).toBeUndefined();
      expect(layout.points[inner[0]!]).toBeDefined();
      // 8 точек кольца + 3 своих у пристройки (её (10,10) — это p5) + 2 пересечения с наружной гранью y = 0.
      expect(Object.keys(layout.points).length).toBe(outer.length + inner.length + 3 + 2);
      expect(layout.points['n1']).toEqual({ id: 'n1', x: 10, y: 0 });
      expect(layout.points['n2']).toEqual({ id: 'n2', x: 60, y: 0 });
    });

    it('точки без владельцев удаляются, точки полов/зон/cut остаются', () => {
      const b = createPlanBuilder();
      b.ring(0, 0, 400, 300, 10);
      const orphan = b.point(1000, 1000);
      const coverPoint = b.point(2000, 2000);
      const cutPoint = b.point(3000, 3000);
      const doc = b.document();
      const layout = doc.floors[0]!.layout;
      layout.covers.push({ id: 'cover', points: [coverPoint] });
      layout.cuts.push({ id: 'cut', a: cutPoint, b: cutPoint });
      const result = layoutOf(normalized(doc));
      expect(result.points[orphan]).toBeUndefined();
      expect(result.points[coverPoint]).toBeDefined();
      expect(result.points[cutPoint]).toBeDefined();
    });

    it('контур сохраняет id при той же циклической последовательности точек (сдвиг и обратный обход)', () => {
      const { doc, inner, outer } = ringDocument();
      const once = normalized(doc);
      const [outerContour, innerContour] = layoutOf(once).contours;
      const shifted = immer.produce(once, draft => {
        const layout = draft.floors[0]!.layout;
        layout.contours[0]!.points = [outer[2]!, outer[3]!, outer[0]!, outer[1]!];
        layout.contours[1]!.points = [...inner].reverse();
      });
      const again = layoutOf(normalized(shifted, 'm'));
      expect(again.contours.map(c => c.id)).toEqual([outerContour!.id, innerContour!.id]);
      // Последовательность нормализована обратно к каноничной, id прежние.
      expect(again.contours[1]!.points).toEqual(inner);
    });

    it('порядок контуров — sortByArea: по убыванию площади, при равенстве outer после inner', () => {
      const b = createPlanBuilder();
      b.ring(0, 0, 400, 300, 10);
      b.ring(1000, 0, 1100, 100, 10);
      const layout = layoutOf(normalized(b.document()));
      expect(layout.contours.map(c => c.kind)).toEqual(['outer', 'inner', 'outer', 'inner']);
      const areas = layout.contours.map(c => Math.abs(contourArea(coords(layout, c.points))));
      expect(areas[0]).toBeGreaterThan(areas[1]!);
      expect(areas[1]).toBeGreaterThan(areas[2]!);
    });

    it('идемпотентность: повторный normalize нормализованного документа не трогает черновик (тот же объект)', () => {
      const once = normalized(ringDocument().doc);
      expect(normalized(once, 'm')).toBe(once);
    });

    it('пустой этаж и документ без этажей — черновик не меняется', () => {
      const empty = createEmptyDocument();
      expect(normalized(empty)).toBe(empty);
      const none = { ...createEmptyDocument(), floors: [] };
      expect(normalized(none)).toBe(none);
    });

    it('несколько этажей нормализуются независимо', () => {
      const { doc } = ringDocument();
      doc.floors.push({ ...createEmptyFloor(), id: 'f2' });
      const result = normalized(doc);
      expect(result.floors[0]!.layout.contours).toHaveLength(2);
      expect(result.floors[1]!.layout).toBe(doc.floors[1]!.layout);
    });

    it('контур с пропавшими id точек: живые точки участвуют, < 3 живых — контур игнорируется', () => {
      const b = createPlanBuilder();
      const { inner } = b.ring(0, 0, 400, 300, 10);
      b.contour('inner', ['ghost-1', 'ghost-2', inner[0]!]);
      const layout = layoutOf(normalized(b.document()));
      expect(layout.contours).toHaveLength(2);
    });
  });

  describe('пере-привязка rooms[] (ADR 0017 C7)', () => {
    it('новая комната без донора получает запись { name: "", ceilingHeight: settings.wallHeight } с новым id', () => {
      const { doc, inner } = ringDocument();
      doc.settings.wallHeight = 265;
      const layout = layoutOf(normalized(doc));
      // n1/n2 — id новых контуров (outer/inner), n3 — запись комнаты.
      expect(layout.rooms).toEqual([{ id: 'n3', anchor: inner, name: '', ceilingHeight: 265 }]);
    });

    it('донор — первая по порядку rooms[] запись с пересечением по площади; anchor переписывается', () => {
      const b = createPlanBuilder();
      const { inner } = b.ring(0, 0, 400, 300, 10);
      const stale = [b.point(-500, -500), b.point(-400, -500), b.point(-400, -400)];
      b.room(stale, 'Чужая', 200);
      const oldAnchor = [b.point(50, 50), b.point(200, 50), b.point(200, 200), b.point(50, 200)];
      b.room(oldAnchor, 'Гостиная', 270);
      const layout = layoutOf(normalized(b.document()));
      expect(layout.rooms.map(r => r.name)).toEqual(['Гостиная', 'Чужая']);
      expect(layout.rooms[0]).toEqual({ id: 'r2', anchor: inner, name: 'Гостиная', ceilingHeight: 270 });
      // Сирота остаётся с прежним якорем; её точки удалены как безхозные, id в якоре — «пропавшие».
      expect(layout.rooms[1]).toEqual({ id: 'r1', anchor: stale, name: 'Чужая', ceilingHeight: 200 });
      expect(layout.points[stale[0]!]).toBeUndefined();
    });

    it('разделение комнаты: первая половинка — сама запись, вторая — клон атрибутов с новым id', () => {
      const b = createPlanBuilder();
      const { inner } = b.ring(0, 0, 400, 300, 10);
      b.room(inner, 'Гостиная', 270);
      b.rect('outer', 195, 10, 205, 290);
      const layout = layoutOf(normalized(b.document()));
      expect(layout.rooms.map(r => [r.id, r.name, r.ceilingHeight])).toEqual([
        ['r1', 'Гостиная', 270],
        ['n4', 'Гостиная', 270],
      ]);
      expect(layout.rooms.map(r => r.anchor)).toEqual(
        layout.contours.filter(c => c.kind === 'inner').map(c => c.points),
      );
    });

    it('якорь: пропавшие id пропускаются, меньше 3 живых точек — не донор', () => {
      const b = createPlanBuilder();
      const { inner } = b.ring(0, 0, 400, 300, 10);
      b.room(['gone', inner[1]!, inner[2]!], 'Короткий', 210);
      b.room([inner[0]!, 'gone', inner[2]!, inner[3]!], 'Живой', 220);
      const layout = layoutOf(normalized(b.document()));
      expect(layout.rooms.map(r => r.name)).toEqual(['Живой', 'Короткий']);
    });

    it('rooms[] следует порядку inner-контуров; запись без изменений сохраняет ссылку', () => {
      const b = createPlanBuilder();
      const small = b.ring(1000, 0, 1100, 100, 10);
      const big = b.ring(0, 0, 400, 300, 10);
      b.room(small.inner, 'Малая');
      b.room(big.inner, 'Большая');
      const doc = freeze(b.document(), true);
      const layout = layoutOf(normalized(doc));
      expect(layout.rooms.map(r => r.name)).toEqual(['Большая', 'Малая']);
      expect(layout.rooms[1]).toBe(doc.floors[0]!.layout.rooms[0]);
    });
  });

  describe('запись в черновик только при изменении', () => {
    it('нормализованный документ: ссылки layout, contours, points, rooms сохраняются', () => {
      const once = normalized(ringDocument().doc);
      const again = normalized(once, 'm');
      expect(again.floors[0]!.layout).toBe(once.floors[0]!.layout);
      expect(again.floors[0]!.layout.contours).toBe(once.floors[0]!.layout.contours);
    });

    it('сдвиг одной точки: неизменённые контуры и точки сохраняют ссылки, rooms не трогаются', () => {
      const once = normalized(ringDocument().doc);
      const layoutBefore = layoutOf(once);
      const moved = immer.produce(once, draft => {
        draft.floors[0]!.layout.points['p2']!.x = 420;
      });
      const again = layoutOf(normalized(moved, 'm'));
      expect(again.contours[1]).toBe(layoutBefore.contours[1]);
      expect(again.rooms).toBe(layoutBefore.rooms);
      expect(again.points['p1']).toBe(layoutBefore.points['p1']);
    });
  });
});

describe('rebuild', () => {
  it('DerivedFloor по форме ADR 0017 C1: стены, комнаты, оси; треугольники — по id точек layout', () => {
    const { doc, inner, outer } = ringDocument();
    const document = normalized(doc);
    const layout = layoutOf(document);
    const floor = rebuild(document).floors[0]!;
    expect(floor.id).toBe('f1');
    expect(floor.walls).toHaveLength(1);
    expect(floor.walls[0]!.contourId).toBe(layout.contours[0]!.id);
    expect(floor.walls[0]!.triangles).toHaveLength(8);
    expect(floor.rooms).toHaveLength(1);
    const room = floor.rooms[0]!;
    expect(room.contourId).toBe(layout.contours[1]!.id);
    expect(room.roomId).toBe(layout.rooms[0]!.id);
    expect(room.outline).toEqual(inner);
    expect(room.holes).toEqual([]);
    expect(room.triangles).toHaveLength(2);
    expect(room.area).toBe(380 * 280);
    const ids = new Set([...outer, ...inner]);
    for (const wall of floor.walls) for (const t of wall.triangles) for (const id of t) expect(ids.has(id)).toBe(true);
    expect(floor.axes).toHaveLength(4);
    for (const axis of floor.axes) {
      expect(axis.depth).toBeCloseTo(10);
      expect(axis.a.x < axis.b.x || (axis.a.x === axis.b.x && axis.a.y <= axis.b.y)).toBe(true);
    }
  });

  it('комната в комнате: внешняя получает дырку, площадь — обвод минус дырка', () => {
    const b = createPlanBuilder();
    b.ring(0, 0, 400, 300, 10);
    b.ring(100, 100, 250, 200, 10);
    const document = normalized(b.document());
    const floor = rebuild(document).floors[0]!;
    expect(floor.rooms).toHaveLength(2);
    const [big, small] = floor.rooms;
    expect(big!.holes).toHaveLength(1);
    expect(big!.area).toBe(380 * 280 - 150 * 100);
    expect(small!.holes).toEqual([]);
    expect(small!.area).toBe(130 * 80);
  });

  it('чистая функция: не мутирует вход, детерминирован (два вызова равны по значению, разные объекты)', () => {
    const document = normalized(ringDocument().doc);
    const a = rebuild(document);
    const b = rebuild(document);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('документ без этажей → пустое производное; пустой этаж → пустые массивы', () => {
    expect(rebuild({ ...createEmptyDocument(), floors: [] })).toEqual({ floors: [] });
    const empty = createEmptyDocument();
    expect(rebuild(empty).floors).toEqual([{ id: empty.floors[0]!.id, walls: [], rooms: [], axes: [] }]);
  });

  it('ненормализованный снимок: контуры без пары и комнаты без записи пропускаются с предупреждением, без исключений', () => {
    const { doc } = ringDocument();
    const warnings: string[] = [];
    const floor = rebuild(freeze(doc, true), { warn: m => warnings.push(m) }).floors[0]!;
    expect(floor.walls).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/no fill group/);
  });

  it('inner, целиком накрытый outer (нет группы-комнаты), — предупреждение «no room group»', () => {
    const b = createPlanBuilder();
    b.rect('outer', 0, 0, 100, 100);
    b.rect('inner', 20, 20, 30, 30); // площадь 100 ≥ 50, но узкий по ratio? 100/40 = 2.5 — валиден; вырезается из outer → группа есть.
    b.contour('inner', [b.point(50, 50), b.point(56, 50), b.point(56, 56), b.point(50, 56)]); // площадь 36 < 50 → отфильтрован
    const warnings: string[] = [];
    rebuild(freeze(b.document(), true), { warn: m => warnings.push(m) });
    expect(warnings).toContain('rebuild: inner contour c3 has no room group on floor f1');
  });

  it('inner без записи rooms[] — предупреждение, комната пропущена', () => {
    const b = createPlanBuilder();
    b.contour('inner', [b.point(0, 0), b.point(300, 0), b.point(300, 200), b.point(0, 200)]);
    const warnings: string[] = [];
    const floor = rebuild(freeze(b.document(), true), { warn: m => warnings.push(m) }).floors[0]!;
    expect(floor.rooms).toEqual([]);
    expect(warnings).toEqual(['rebuild: room contour c1 has no rooms[] record on floor f1']);
  });
});

describe('property (fast-check, фиксированный seed)', () => {
  /** Случайный план: кольца стен, свободные квады и полигоны-комнаты на сетке квантования. */
  const arbPlan = fc
    .record({
      rings: fc.array(
        fc.record({
          x: fc.integer({ min: -2000, max: 2000 }),
          y: fc.integer({ min: -2000, max: 2000 }),
          w: fc.integer({ min: 60, max: 800 }),
          h: fc.integer({ min: 60, max: 800 }),
          width: fc.integer({ min: 5, max: 25 }),
        }),
        { maxLength: 3 },
      ),
      quads: fc.array(
        fc.record({
          x: fc.integer({ min: -2000, max: 2000 }),
          y: fc.integer({ min: -2000, max: 2000 }),
          w: fc.integer({ min: 20, max: 600 }),
          h: fc.integer({ min: 20, max: 600 }),
        }),
        { maxLength: 3 },
      ),
      polygons: fc.array(arbConvexPolygon, { maxLength: 2 }),
    })
    .map(({ rings, quads, polygons }) => {
      const b = createPlanBuilder();
      for (const r of rings) b.ring(r.x, r.y, r.x + r.w, r.y + r.h, r.width);
      for (const q of quads) b.rect('outer', q.x, q.y, q.x + q.w, q.y + q.h);
      for (const polygon of polygons) {
        b.contour(
          'inner',
          polygon.map(p => b.point(Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000)),
        );
      }
      return b.document();
    });

  const params = { ...fcParams, numRuns: 120 };

  it('нет NaN/Infinity; комнаты — валидные полигоны без самопересечений, против часовой; treугольники по id', () => {
    fc.assert(
      fc.property(arbPlan, doc => {
        const document = normalized(doc);
        const layout = layoutOf(document);
        for (const point of Object.values(layout.points)) {
          expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
        }
        for (const contour of layout.contours) {
          const positions = coords(layout, contour.points);
          expect(positions).toHaveLength(contour.points.length);
          expect(contourArea(positions)).toBeGreaterThan(0);
          expect(contourValid(positions)).toBe(true);
          expect(contourSelfIntersected(positions)).toBe(false);
        }
        const floor = rebuild(document, { warn: m => expect(m).toBeUndefined() }).floors[0]!;
        expect(floor.rooms.length).toBe(layout.contours.filter(c => c.kind === 'inner').length);
        expect(floor.walls.length).toBe(layout.contours.filter(c => c.kind === 'outer').length);
        for (const room of floor.rooms) {
          for (const t of room.triangles) for (const id of t) expect(layout.points[id]).toBeDefined();
          expect(Number.isFinite(room.area) && room.area > 0).toBe(true);
        }
        for (const room of floor.rooms) {
          for (const hole of room.holes) {
            const positions = coords(layout, hole);
            expect(contourArea(positions)).toBeLessThan(0);
            expect(contourValid(positions)).toBe(true);
          }
        }
        for (const axis of floor.axes) {
          expect(Number.isFinite(axis.depth) && axis.depth > 0).toBe(true);
          expect([axis.a.x, axis.a.y, axis.b.x, axis.b.y].every(Number.isFinite)).toBe(true);
        }
        // Инварианты хранимого: id контуров уникальны, каждая точка кому-то принадлежит, каждая комната — с записью.
        expect(new Set(layout.contours.map(c => c.id)).size).toBe(layout.contours.length);
        const owned = new Set(layout.contours.flatMap(c => c.points));
        for (const id of Object.keys(layout.points)) expect(owned.has(id)).toBe(true);
        expect(layout.rooms.length).toBe(layout.contours.filter(c => c.kind === 'inner').length);
      }),
      params,
    );
  });

  it('normalize(normalize(x)) == normalize(x) — черновик не меняется, тот же объект', () => {
    fc.assert(
      fc.property(arbPlan, doc => {
        const once = normalized(doc);
        expect(normalized(once, 'm')).toBe(once);
      }),
      params,
    );
  });

  it('rebuild детерминирован', () => {
    fc.assert(
      fc.property(arbPlan, doc => {
        const document = normalized(doc);
        expect(rebuild(document)).toEqual(rebuild(document));
      }),
      params,
    );
  });

  it('инвариантность к порядку входных контуров: та же геометрия контуров и комнат (с точностью до id)', () => {
    const geometry = (doc: PlannerDocument): string[] => {
      const layout = layoutOf(normalized(doc));
      return layout.contours
        .map(
          c =>
            `${c.kind} ${coords(layout, c.points)
              .map(p => `${p.x},${p.y}`)
              .join(' ')}`,
        )
        .sort();
    };
    fc.assert(
      fc.property(arbPlan, fc.integer({ min: 1, max: 1000 }), (doc, seed) => {
        const shuffled = immer.produce(doc, draft => {
          const contours = draft.floors[0]!.layout.contours;
          // Детерминированная перестановка по seed (Фишер–Йетс на LCG).
          let state = seed;
          for (let i = contours.length - 1; i > 0; i--) {
            state = (state * 1103515245 + 12345) % 2147483648;
            const j = state % (i + 1);
            [contours[i], contours[j]] = [contours[j]!, contours[i]!];
          }
        });
        expect(geometry(shuffled)).toEqual(geometry(doc));
      }),
      params,
    );
  });
});
