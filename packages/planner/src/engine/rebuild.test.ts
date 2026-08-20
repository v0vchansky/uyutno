import * as fc from 'fast-check';
import { Immer, freeze } from 'immer';

import { contourArea, contourValid } from '../document/geometry/predicates/contourArea';
import { contourSelfIntersected } from '../document/geometry/predicates/contourSelfIntersected';
import { pointOnContour } from '../document/geometry/predicates/pointOnContour';
import { arbConvexPolygon, fcParams } from '../document/geometry/testing/arbitraries';
import type { Id } from '../document/id';
import {
  createEmptyDocument,
  createEmptyFloor,
  type FloorLayout,
  type PlanPosition,
  type PlannerDocument,
} from '../document/PlannerDocument';
import { createPlanBuilder, createSequentialIds, type PlanBuilder } from '../document/testing/planBuilder';
import { type DerivedFloor, normalize, rebuild } from './rebuild';

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
      const { inner } = b.ring(0, 0, 400, 300, 10);
      const orphan = b.point(1000, 1000);
      // Зона по двум углам комнаты: её диагональ идёт через интерьер и даёт запись `cuts[]`.
      b.area([inner[0]!, inner[1]!, inner[2]!], 100);
      const result = layoutOf(normalized(b.document()));
      expect(result.points[orphan]).toBeUndefined();
      for (const id of inner) expect(result.points[id]).toBeDefined();
      expect(result.cuts).toHaveLength(1);
      expect(result.points[result.cuts[0]!.a]).toBeDefined();
      expect(result.points[result.cuts[0]!.b]).toBeDefined();
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

  describe('стадии (3)–(6): зоны, cuts, полы (ADR 0017 C6/C9, спека 02)', () => {
    /** Квадратный пол-обвод по углам `(x0,y0)–(x1,y1)` — новые точки билдера. */
    const coverRect = (b: PlanBuilder, kind: 'outer' | 'inner', x0: number, y0: number, x1: number, y1: number) =>
      b.cover(kind, [b.point(x0, y0), b.point(x1, y0), b.point(x1, y1), b.point(x0, y1)]);

    it('(5) авто-пол ложится под комнату её же точками — общий id с контуром (ADR 0016 B4)', () => {
      const { doc, inner } = ringDocument();
      const layout = layoutOf(normalized(doc));
      expect(layout.covers).toEqual([{ id: 'n4', kind: 'outer', points: inner, ceilingHidden: false }]);
      // Своих точек у пола нет: пул — ровно точки контуров.
      expect(Object.keys(layout.points)).toHaveLength(8);
    });

    it('(5) без комнат авто-пола нет, а ручной пол уходит вместе с исчезнувшей комнатой', () => {
      const b = createPlanBuilder();
      b.rect('outer', 0, 0, 400, 300); // сплошное тело стены, полости нет
      coverRect(b, 'outer', 50, 50, 200, 200);
      const layout = layoutOf(normalized(b.document()));
      expect(layout.covers).toEqual([]);
    });

    it('(4)+(5) ручной пол ужимается под комнату, остаток заращивается авто-полом и сливается с ним', () => {
      const b = createPlanBuilder();
      const { inner } = b.ring(0, 0, 400, 300, 10);
      // Пол вылезает за комнату слева и снизу: подрезка по границе, остаток комнаты — авто-пол, слияние по касанию.
      const manual = b.cover('outer', [b.point(-50, -50), b.point(200, -50), b.point(200, 200), b.point(-50, 200)], {
        ceilingHidden: true,
      });
      const layout = layoutOf(normalized(b.document()));
      expect(layout.covers).toHaveLength(1);
      // Пол на всю комнату; в обводе — вершины T-стыков там, где границы ручного куска упёрлись в стену.
      expect(coords(layout, layout.covers[0]!.points)).toEqual([
        { x: 10, y: 10 },
        { x: 200, y: 10 },
        { x: 390, y: 10 },
        { x: 390, y: 290 },
        { x: 10, y: 290 },
        { x: 10, y: 200 },
      ]);
      expect(layout.covers[0]!.points.filter(id => inner.includes(id))).toEqual(inner);
      // Цикл точек изменился — id записи новый (та же дисциплина, что у контуров), а данные переехали по
      // перекрытию площади: «скрыть потолок» — от первого пола-донора (спека 02, `matchCoverRecords`).
      expect(layout.covers[0]!.id).not.toBe(manual);
      expect(layout.covers[0]!.ceilingHidden).toBe(true);
    });

    it('(6) вырез остаётся вырезом и авто-полом не зарастает; осиротевший внутренний пол удаляется', () => {
      const b = createPlanBuilder();
      const { inner } = b.ring(0, 0, 400, 300, 10);
      b.cover('outer', inner);
      const hole = coverRect(b, 'inner', 100, 100, 200, 200);
      const orphan = coverRect(b, 'inner', 1000, 1000, 1100, 1100);
      const layout = layoutOf(normalized(b.document()));
      expect(layout.covers.map(c => [c.id, c.kind])).toEqual([
        ['cv1', 'outer'],
        [hole, 'inner'],
      ]);
      expect(layout.covers.find(c => c.id === orphan)).toBeUndefined();
    });

    it('(3) зона без опоры на точках комнаты отбраковывается вместе со своими cuts', () => {
      const b = createPlanBuilder();
      const { inner } = b.ring(0, 0, 400, 300, 10);
      const supported = b.area([inner[0]!, inner[1]!, inner[2]!], 100);
      const floating = b.area([b.point(100, 100), b.point(200, 100), b.point(200, 200)], 100);
      const layout = layoutOf(normalized(b.document()));
      expect(layout.areas.map(a => a.id)).toEqual([supported]);
      expect(layout.areas.find(a => a.id === floating)).toBeUndefined();
      // Единственная интерьерная грань — диагональ выжившей зоны.
      expect(layout.cuts).toHaveLength(1);
    });

    it('(3) запись cuts без зоны-владельца удаляется; выжившая грань сохраняет свою запись по ссылке', () => {
      const b = createPlanBuilder();
      const { inner } = b.ring(0, 0, 400, 300, 10);
      b.area([inner[0]!, inner[1]!, inner[2]!], 100);
      const doc = b.document();
      doc.floors[0]!.layout.cuts.push({ id: 'stale', a: inner[0]!, b: inner[2]! });
      const once = normalized(freeze(doc, true));
      const layout = layoutOf(once);
      expect(layout.cuts.map(c => c.id)).toEqual(['stale']);
      // Лишнюю добавим второй — она без зоны и уходит, а живая переживает пересборку тем же объектом.
      const withStale = immer.produce(once, draft => {
        draft.floors[0]!.layout.cuts.push({ id: 'ghost', a: inner[1]!, b: inner[3]! });
      });
      const again = layoutOf(normalized(withStale, 'm'));
      expect(again.cuts.map(c => c.id)).toEqual(['stale']);
      expect(again.cuts[0]).toBe(layout.cuts[0]);
    });

    it('идемпотентность на документе с зоной, ручным полом, авто-полом и вырезом — тот же объект', () => {
      const b = createPlanBuilder();
      const { inner } = b.ring(0, 0, 400, 300, 10);
      b.ring(1000, 0, 1200, 150, 10);
      b.area([inner[0]!, inner[1]!, inner[2]!], 100);
      b.cover('outer', [b.point(-50, -50), b.point(200, -50), b.point(200, 200), b.point(-50, 200)]);
      coverRect(b, 'inner', 100, 100, 150, 150);
      const once = normalized(b.document());
      // Порядок записей — `sortByArea` по всему набору: большая комната, малая комната, вырез.
      expect(layoutOf(once).covers.map(c => c.kind)).toEqual(['outer', 'outer', 'inner']);
      expect(normalized(once, 'm')).toBe(once);
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
    expect(rebuild(empty).floors).toEqual([
      {
        id: empty.floors[0]!.id,
        walls: [],
        rooms: [],
        axes: [],
        covers: [],
        ceilings: [],
        areas: [],
        cuts: [],
        faces: [],
        skirtings: [],
      },
    ]);
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

describe('rebuild — производное 2b: полы, потолки, зоны, вырезы, грани, плинтусы', () => {
  const derivedOf = (doc: PlannerDocument, prefix = 'n') => {
    const document = normalized(doc, prefix);
    return { layout: layoutOf(document), floor: rebuild(document).floors[0]! };
  };

  it('авто-пол комнаты: свой потолок ссылкой на пол, высота — с комнаты, флаг видимости — с пола', () => {
    const { doc, inner } = ringDocument();
    const { layout, floor } = derivedOf(doc);
    expect(floor.covers).toHaveLength(1);
    expect(floor.covers[0]).toMatchObject({
      coverId: layout.covers[0]!.id,
      roomId: layout.rooms[0]!.id,
      outline: inner,
      holes: [],
      area: 380 * 280,
    });
    expect(floor.covers[0]!.triangles).toHaveLength(2);
    expect(floor.ceilings).toEqual([{ coverId: layout.covers[0]!.id, height: 280, hidden: false }]);
  });

  it('высота потолка едет с комнаты, `hidden` — с пола: две комнаты, разные высоты и флаги', () => {
    const b = createPlanBuilder();
    const kitchen = b.ring(0, 0, 400, 300, 10).inner;
    const hall = b.ring(1000, 0, 1300, 200, 10).inner;
    b.cover('outer', kitchen, { ceilingHidden: true });
    b.room(kitchen, 'Кухня', 320);
    b.room(hall, 'Холл', 240);
    const { layout, floor } = derivedOf(b.document());
    expect(floor.covers).toHaveLength(2);
    const roomHeight = new Map(layout.rooms.map(room => [room.id, room.ceilingHeight]));
    const hiddenOf = new Map(layout.covers.map(cover => [cover.id, cover.ceilingHidden]));
    const roomOf = new Map(floor.covers.map(cover => [cover.coverId, cover.roomId]));
    expect(new Set(roomHeight.values())).toEqual(new Set([320, 240]));
    for (const ceiling of floor.ceilings) {
      expect(ceiling.height).toBe(roomHeight.get(roomOf.get(ceiling.coverId)!));
      expect(ceiling.hidden).toBe(hiddenOf.get(ceiling.coverId));
    }
    expect(floor.ceilings.filter(ceiling => ceiling.hidden)).toHaveLength(1);
  });

  it('потолок повторяет форму пола с дырками: у пола с вырезом — те же дырки и та же площадь', () => {
    const b = createPlanBuilder();
    const { inner } = b.ring(0, 0, 400, 300, 10);
    const hole = [b.point(100, 100), b.point(200, 100), b.point(200, 200), b.point(100, 200)];
    b.cover('outer', inner);
    b.cover('inner', hole);
    const { layout, floor } = derivedOf(b.document());
    expect(floor.covers).toHaveLength(1);
    expect(floor.covers[0]!.holes).toEqual([layout.covers[1]!.points]);
    expect(floor.covers[0]!.area).toBe(380 * 280 - 100 * 100);
    // Потолок геометрии не дублирует — только ссылку: ровно один на пол, и форма читается через `coverId`.
    expect(floor.ceilings).toHaveLength(1);
    expect(floor.ceilings[0]!.coverId).toBe(floor.covers[0]!.coverId);
  });

  it('без зон: у каждой грани комнаты высота комнаты, оба плинтуса и пустые разрывы', () => {
    const { doc, inner } = ringDocument();
    const { floor } = derivedOf(doc);
    expect(floor.faces).toHaveLength(4);
    expect(floor.faces.map(face => [face.a, face.b])).toEqual([
      [inner[0], inner[1]],
      [inner[1], inner[2]],
      [inner[2], inner[3]],
      [inner[3], inner[0]],
    ]);
    expect(floor.faces.every(face => face.top === 280 && !face.underArea)).toBe(true);
    expect(floor.skirtings).toHaveLength(8);
    expect(floor.skirtings.every(skirting => skirting.gaps.length === 0)).toBe(true);
    // Прямой угол: осевой квад нижней грани уходит внутрь комнаты на 1 см и митрится на √2.
    const first = floor.skirtings[0]!;
    expect(first.kind).toBe('bottom');
    expect(first.points[0]).toEqual({ x: 10, y: 10 });
    expect(first.points[2]!.x).toBeCloseTo(11, 9);
    expect(first.points[2]!.y).toBeCloseTo(11, 9);
    expect(floor.cuts).toEqual([]);
    expect(floor.areas).toEqual([]);
  });

  it('зона по трём углам комнаты: крышка, вырез по диагонали и две укороченные грани без молдинга', () => {
    const b = createPlanBuilder();
    const { inner } = b.ring(0, 0, 400, 300, 10);
    b.area([inner[0]!, inner[1]!, inner[2]!], 100);
    b.room(inner, '', 260);
    const { layout, floor } = derivedOf(b.document());
    expect(floor.areas).toHaveLength(1);
    expect(floor.areas[0]).toMatchObject({
      areaId: layout.areas[0]!.id,
      roomId: layout.rooms[0]!.id,
      outline: layout.areas[0]!.points,
      height: 100,
    });
    expect(floor.areas[0]!.triangles).toHaveLength(1);
    // Одна соседняя зона: низ грани — по зоне, верх — по комнате (а не по глобальной высоте стен).
    expect(floor.cuts).toEqual([
      { cutId: layout.cuts[0]!.id, a: layout.cuts[0]!.a, b: layout.cuts[0]!.b, low: 100, height: 260 },
    ]);
    const under = floor.faces.filter(face => face.underArea);
    expect(under.map(face => [face.a, face.b])).toEqual([
      [inner[0], inner[1]],
      [inner[1], inner[2]],
    ]);
    expect(under.every(face => face.top === 100)).toBe(true);
    expect(floor.faces.filter(face => !face.underArea).every(face => face.top === 260)).toBe(true);
    // Верхний плинтус пропал ровно у совпавших граней: 4 нижних + 2 верхних.
    expect(floor.skirtings).toHaveLength(6);
    for (const face of under) {
      expect(floor.skirtings.filter(s => s.a === face.a && s.b === face.b).map(s => s.kind)).toEqual(['bottom']);
    }
  });

  it('вырез между двумя зонами разной высоты: `low` = min, `height` = max, а не высота комнаты', () => {
    const b = createPlanBuilder();
    // Шестиугольная комната по точкам: вершины не коллинеарны и переживают нормализацию.
    const hexagon = [
      b.point(0, 0),
      b.point(200, -50),
      b.point(400, 0),
      b.point(400, 200),
      b.point(200, 250),
      b.point(0, 200),
    ];
    b.contour('inner', hexagon);
    b.area([hexagon[0]!, hexagon[1]!, hexagon[4]!, hexagon[5]!], 100);
    b.area([hexagon[1]!, hexagon[2]!, hexagon[3]!, hexagon[4]!], 210);
    const { layout, floor } = derivedOf(b.document());
    expect(layout.areas).toHaveLength(2);
    expect(layout.cuts).toHaveLength(1);
    expect(floor.areas.map(entry => entry.height)).toEqual([100, 210]);
    expect(floor.cuts).toEqual([
      { cutId: layout.cuts[0]!.id, a: layout.cuts[0]!.a, b: layout.cuts[0]!.b, low: 100, height: 210 },
    ]);
    // Крышки делят комнату без пересечений и без остатка.
    const covered = floor.areas.flatMap(entry => entry.triangles).map(triangle => triangle.join());
    expect(new Set(covered).size).toBe(covered.length);
  });

  it('ненормализованный снимок: пол с пропавшей точкой и вырез без концов — warn и пропуск, без исключений', () => {
    const b = createPlanBuilder();
    const { inner } = b.ring(0, 0, 400, 300, 10);
    b.room(inner);
    b.cover('outer', [...inner, 'нет-такой-точки']);
    b.document().floors[0]!.layout.cuts.push({ id: 'ct1', a: 'нет-такой-точки', b: inner[0]! });
    const warnings: string[] = [];
    const floor = rebuild(freeze(b.document(), true), { warn: m => warnings.push(m) }).floors[0]!;
    expect(floor.covers).toEqual([]);
    expect(floor.cuts).toEqual([]);
    expect(warnings).toContain('rebuild: cover cv1 has a point without a record on floor f1');
    expect(warnings).toContain('rebuild: cut ct1 has an end without a record on floor f1');
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
        expectDerivedInvariants(floor, layout);
        // Инварианты хранимого: id контуров уникальны, каждая точка кому-то принадлежит, каждая комната — с записью.
        expect(new Set(layout.contours.map(c => c.id)).size).toBe(layout.contours.length);
        const owned = new Set(layout.contours.flatMap(c => c.points));
        for (const id of Object.keys(layout.points)) expect(owned.has(id)).toBe(true);
        expect(layout.rooms.length).toBe(layout.contours.filter(c => c.kind === 'inner').length);
      }),
      params,
    );
  });

  /**
   * Ни одного `NaN`/`±Infinity` во всём поддереве значения — производное тоже plain-данные (ADR 0016 B5).
   * Возвращает флаг, а не зовёт `expect` на каждом числе: `DerivedFloor` — тысячи чисел на прогон.
   */
  const allFinite = (value: unknown): boolean => {
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(allFinite);
    if (value !== null && typeof value === 'object') return Object.values(value).every(allFinite);
    return true;
  };

  /**
   * Каждая запись `cuts[]` принадлежит хотя бы одной живой зоне (задача 0072): вырез набирается из
   * интерьерных участков рёбер выживших зон, значит оба конца **и середина** участка лежат на границе
   * какой-то зоны из `layout.areas`. Зона отбракована — её вырезы обязаны уйти вместе с ней.
   */
  const expectCutsOwned = (layout: FloorLayout): void => {
    for (const cut of layout.cuts) {
      const a = layout.points[cut.a];
      const b = layout.points[cut.b];
      expect(a !== undefined && b !== undefined).toBe(true);
      const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      const owner = layout.areas.some(area => {
        const outline = coords(layout, area.points);
        return [a!, b!, mid].every(point => pointOnContour(point, outline));
      });
      expect(owner).toBe(true);
    }
  };

  /**
   * Инварианты производного 2b, общие для любого плана (задачи 0070/0072): конечные числа, полы — валидные
   * полигоны с ориентацией по контракту (обвод против часовой, дырки по часовой), ровно один потолок на пол
   * и в том же порядке, `low <= height` у вырезов, «плинтусов = граней + граней без `underArea`», а каждый
   * вырез `layout.cuts` сидит на границе живой зоны.
   */
  const expectDerivedInvariants = (floor: DerivedFloor, layout: FloorLayout): void => {
    expect(allFinite(floor)).toBe(true);
    expect(floor.ceilings.map(ceiling => ceiling.coverId)).toEqual(floor.covers.map(cover => cover.coverId));
    for (const cover of floor.covers) {
      expect(Number.isFinite(cover.area) && cover.area > 0).toBe(true);
      for (const t of cover.triangles) for (const id of t) expect(layout.points[id]).toBeDefined();
      const outline = coords(layout, cover.outline);
      expect(outline).toHaveLength(cover.outline.length);
      expect(contourArea(outline)).toBeGreaterThan(0);
      expect(contourSelfIntersected(outline)).toBe(false);
      for (const hole of cover.holes) {
        for (const id of hole) expect(layout.points[id]).toBeDefined();
        const positions = coords(layout, hole);
        expect(contourArea(positions)).toBeLessThan(0);
        expect(contourSelfIntersected(positions)).toBe(false);
      }
    }
    expectCutsOwned(layout);
    for (const ceiling of floor.ceilings) expect(Number.isFinite(ceiling.height)).toBe(true);
    for (const area of floor.areas) {
      expect(Number.isFinite(area.height)).toBe(true);
      for (const t of area.triangles) for (const id of t) expect(layout.points[id]).toBeDefined();
    }
    for (const cut of floor.cuts) {
      expect(Number.isFinite(cut.low) && Number.isFinite(cut.height)).toBe(true);
      expect(cut.low).toBeLessThanOrEqual(cut.height);
    }
    for (const face of floor.faces) expect(Number.isFinite(face.top)).toBe(true);
    for (const skirting of floor.skirtings) {
      for (const point of skirting.points) expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      expect(skirting.gaps).toEqual([]);
    }
    expect(floor.skirtings.length).toBe(floor.faces.length + floor.faces.filter(face => !face.underArea).length);
  };

  /**
   * Кольцо стен с зоной по трём из четырёх внутренних углов: диагональ идёт через интерьер и даёт вырез.
   * Плюс два «мусорных» входа, без которых отбраковка (3) не проверяется: зона на интерьерных точках
   * (опоры нет — уходит целиком) и запись `cuts[]` по второй диагонали, ребром живых зон не являющаяся
   * (обязана быть снята `reconcileCuts`).
   */
  const arbAreaPlan = fc
    .record({
      w: fc.integer({ min: 120, max: 800 }),
      h: fc.integer({ min: 120, max: 800 }),
      width: fc.integer({ min: 5, max: 25 }),
      // Высоты зон держатся ниже потолка комнаты — иначе `low <= height` перестаёт быть инвариантом
      // (производное хранимое не чинит, см. `DerivedCut`).
      first: fc.integer({ min: 10, max: 270 }),
      second: fc.integer({ min: 10, max: 270 }),
      floating: fc.boolean(),
    })
    .map(({ w, h, width, first, second, floating }) => {
      const b = createPlanBuilder();
      const { inner } = b.ring(0, 0, w, h, width);
      b.area([inner[0]!, inner[1]!, inner[2]!], first);
      b.area([inner[0]!, inner[2]!, inner[3]!], second);
      if (floating) {
        const x = Math.round(w / 2);
        const y = Math.round(h / 2);
        b.area([b.point(x - 20, y - 20), b.point(x + 20, y - 20), b.point(x + 20, y + 20)], first);
      }
      const doc = b.document();
      doc.floors[0]!.layout.cuts.push({ id: 'stale', a: inner[1]!, b: inner[3]! });
      return doc;
    });

  it('зоны и вырезы: low <= height, потолок на каждый пол, плинтусов = граней + граней без underArea', () => {
    fc.assert(
      fc.property(arbAreaPlan, doc => {
        const document = normalized(doc);
        const layout = layoutOf(document);
        const floor = rebuild(document, { warn: m => expect(m).toBeUndefined() }).floors[0]!;
        expectDerivedInvariants(floor, layout);
        expect(floor.areas.length).toBe(layout.areas.length);
        expect(floor.cuts.length).toBe(layout.cuts.length);
      }),
      params,
    );
  });

  /**
   * Кольцо стен с (не)обязательной перегородкой, ручным полом произвольного положения (внутри комнаты,
   * внахлёст со стеной или мимо здания) и вырезом в нём — вход стадий (4)–(6): подрезка, авто-полы,
   * слияние и снятие осиротевших дырок. Отдельный арбитрарий с малым `numRuns` вместо расширения
   * `arbPlan`: узкая генерация ловит полы дешевле, чем один широкий план на 300 прогонов.
   */
  const arbCoverPlan = fc
    .record({
      w: fc.integer({ min: 200, max: 900 }),
      h: fc.integer({ min: 200, max: 900 }),
      width: fc.integer({ min: 5, max: 25 }),
      partition: fc.boolean(),
      hidden: fc.boolean(),
      cover: fc.record({
        x: fc.integer({ min: -80, max: 500 }),
        y: fc.integer({ min: -80, max: 500 }),
        w: fc.integer({ min: 40, max: 600 }),
        h: fc.integer({ min: 40, max: 600 }),
      }),
      hole: fc.record({
        x: fc.integer({ min: 0, max: 400 }),
        y: fc.integer({ min: 0, max: 400 }),
        size: fc.integer({ min: 20, max: 200 }),
      }),
    })
    .map(({ w, h, width, partition, hidden, cover, hole }) => {
      const b = createPlanBuilder();
      b.ring(0, 0, w, h, width);
      if (partition) b.rect('outer', Math.round(w / 2) - 5, width, Math.round(w / 2) + 5, h - width);
      const rect = (x0: number, y0: number, x1: number, y1: number): Id[] => [
        b.point(x0, y0),
        b.point(x1, y0),
        b.point(x1, y1),
        b.point(x0, y1),
      ];
      b.cover('outer', rect(cover.x, cover.y, cover.x + cover.w, cover.y + cover.h), { ceilingHidden: hidden });
      b.cover('inner', rect(hole.x, hole.y, hole.x + hole.size, hole.y + hole.size));
      return b.document();
    });

  const coverParams = { ...fcParams, numRuns: 80 };

  it('полы: обвод против часовой, дырки по часовой, конечные числа во всём производном 2b', () => {
    fc.assert(
      fc.property(arbCoverPlan, doc => {
        const warnings: string[] = [];
        const document = normalized(doc, 'n', warnings);
        const layout = layoutOf(document);
        const floor = rebuild(document, { warn: m => warnings.push(m) }).floors[0]!;
        // Хранимое: полы владеют только живыми точками, каждый вырез-дырка ориентирован по часовой.
        for (const cover of layout.covers) {
          const positions = coords(layout, cover.points);
          expect(positions).toHaveLength(cover.points.length);
          if (cover.kind === 'outer') expect(contourArea(positions)).toBeGreaterThan(0);
          else expect(contourArea(positions)).toBeLessThan(0);
        }
        expectDerivedInvariants(floor, layout);
        // Подрезка, авто-полы и слияние — детерминированные фазы: ни soft-fail, ни расхождения.
        expect(warnings).toEqual([]);
      }),
      coverParams,
    );
  });

  it('normalize(normalize(x)) == normalize(x) на планах с зонами, ручными полами, авто-полами и вырезами', () => {
    fc.assert(
      fc.property(fc.oneof(arbAreaPlan, arbCoverPlan), doc => {
        const once = normalized(doc);
        expect(layoutOf(once).covers.length).toBeGreaterThan(0);
        expect(normalized(once, 'm')).toBe(once);
      }),
      coverParams,
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
