import * as fc from 'fast-check';

import { arbQuantizedCoordinate } from '../geometry/testing/arbitraries';
import type { Id } from '../id';
import { CONTOUR_KINDS, SCENE_ITEM_KINDS, UNITS, VIEW_KINDS, type PlannerDocument } from '../PlannerDocument';
import { createPlanBuilder } from './planBuilder';

/**
 * Арбитрарий **целого** документа для round-trip формата (задача 0079): к плану, который умеет собирать
 * `planBuilder` (кольца стен, свободные квады, полы, зоны, записи комнат), добавлены поля, которых
 * property-тестам шага 2b не требовалось, — `settings`, `view` с тремя камерами и `scene`.
 *
 * Все координаты плана лежат на сетке квантования 0.001 см: `parse` квантует путь загрузки, и
 * неквантованный вход давал бы ложное падение `load(save(x)) == x` на самом квантовании, а не на формате.
 * Углы, зумы и высоты координатами не являются и не квантуются — ни здесь, ни в парсере.
 */

/** Заведомо неквантованная координата — вход, на котором проверяется само квантование пути загрузки. */
export const arbRawCoordinate = fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true });

const arbAngle = fc.integer({ min: -360, max: 360 });
const arbZoom = fc.integer({ min: 0, max: 1000 }).map(v => v / 1000);

const arbCameras = fc.record({
  plan: fc.record({ x: arbQuantizedCoordinate, y: arbQuantizedCoordinate, zoom: arbZoom }),
  orbit: fc.record({
    x: arbQuantizedCoordinate,
    y: arbQuantizedCoordinate,
    elevation: fc.integer({ min: 0, max: 500 }),
    pan: arbAngle,
    tilt: arbAngle,
    zoom: arbZoom,
  }),
  walk: fc.record({ x: arbQuantizedCoordinate, y: arbQuantizedCoordinate, pan: arbAngle, tilt: arbAngle }),
});

const arbView = fc.record({ activeView: fc.constantFrom(...VIEW_KINDS), cameras: arbCameras });

const arbSettings = fc.record({
  units: fc.constantFrom(...UNITS),
  wallHeight: fc.integer({ min: 200, max: 400 }),
});

/** План: 0–2 кольца стен, 0–2 свободных квада, 0–2 пола и 0–1 зона — то же, чем оперируют тесты 2b. */
const arbPlan = fc.record({
  rings: fc.array(
    fc.record({
      x: fc.integer({ min: -2000, max: 2000 }),
      y: fc.integer({ min: -2000, max: 2000 }),
      w: fc.integer({ min: 60, max: 800 }),
      h: fc.integer({ min: 60, max: 800 }),
      width: fc.integer({ min: 5, max: 25 }),
    }),
    { maxLength: 2 },
  ),
  quads: fc.array(
    fc.record({
      kind: fc.constantFrom(...CONTOUR_KINDS),
      x: fc.integer({ min: -2000, max: 2000 }),
      y: fc.integer({ min: -2000, max: 2000 }),
      w: fc.integer({ min: 20, max: 600 }),
      h: fc.integer({ min: 20, max: 600 }),
    }),
    { maxLength: 2 },
  ),
  covers: fc.array(
    fc.record({
      kind: fc.constantFrom(...CONTOUR_KINDS),
      x: fc.integer({ min: -1000, max: 1000 }),
      y: fc.integer({ min: -1000, max: 1000 }),
      size: fc.integer({ min: 40, max: 400 }),
      ceilingHidden: fc.boolean(),
    }),
    { maxLength: 2 },
  ),
  areas: fc.array(
    fc.record({
      x: fc.integer({ min: -1000, max: 1000 }),
      y: fc.integer({ min: -1000, max: 1000 }),
      size: fc.integer({ min: 40, max: 400 }),
      height: fc.integer({ min: 10, max: 270 }),
    }),
    { maxLength: 1 },
  ),
  rooms: fc.array(
    fc.record({ name: fc.string({ maxLength: 24 }), ceilingHeight: fc.integer({ min: 200, max: 400 }) }),
    { maxLength: 2 },
  ),
});

const arbSceneItem = fc.record({
  kind: fc.constantFrom(...SCENE_ITEM_KINDS),
  catalogId: fc.string({ minLength: 1, maxLength: 16 }),
  x: arbQuantizedCoordinate,
  y: arbQuantizedCoordinate,
  elevation: arbQuantizedCoordinate,
  rotation: arbAngle,
});

const arbRuler = fc.record({
  a: fc.record({ x: arbQuantizedCoordinate, y: arbQuantizedCoordinate }),
  b: fc.record({ x: arbQuantizedCoordinate, y: arbQuantizedCoordinate }),
});

/**
 * Документ целиком. Ссылки по id согласованы по построению: `parse` молча выбрасывает записи, ссылающиеся
 * на отсутствующие точки (ADR 0021), и битый вход ронял бы round-trip не по вине сериализации, а по вине
 * генератора. Документ собирается целиком внутри `.map`, чтобы у двух кандидатов усадки не оказалось
 * одного и того же изменяемого объекта.
 */
export const arbDocument: fc.Arbitrary<PlannerDocument> = fc
  .record({
    plan: arbPlan,
    settings: arbSettings,
    view: arbView,
    hidden: fc.array(fc.nat(), { maxLength: 3 }),
    items: fc.array(arbSceneItem, { maxLength: 3 }),
    rulers: fc.array(arbRuler, { maxLength: 2 }),
  })
  .map(({ plan, settings, view, hidden, items, rulers }) => {
    const b = createPlanBuilder();
    for (const r of plan.rings) b.ring(r.x, r.y, r.x + r.w, r.y + r.h, r.width);
    for (const q of plan.quads) b.rect(q.kind, q.x, q.y, q.x + q.w, q.y + q.h);
    const square = (x: number, y: number, size: number): Id[] => [
      b.point(x, y),
      b.point(x + size, y),
      b.point(x + size, y + size),
      b.point(x, y + size),
    ];
    for (const c of plan.covers) b.cover(c.kind, square(c.x, c.y, c.size), { ceilingHidden: c.ceilingHidden });
    for (const a of plan.areas) b.area(square(a.x, a.y, a.size), a.height);

    const document = b.document();
    const layout = document.floors[0]!.layout;
    const pointIds = Object.keys(layout.points);
    // Записи комнат и вырезов вешаются на уже существующие точки — иначе `parse` их законно выбросит.
    for (const [i, room] of plan.rooms.entries()) {
      const anchor = pointIds.slice(i, i + 3);
      if (anchor.length > 0) b.room(anchor, room.name, room.ceilingHeight);
    }
    if (pointIds.length >= 2) layout.cuts.push({ id: 'cut1', a: pointIds[0]!, b: pointIds[1]! });

    document.settings = settings;
    document.view = view;
    const scene = document.floors[0]!.scene;
    scene.items = items.map((item, i) => ({ id: `it${i + 1}`, ...item }));
    scene.rulers = rulers.map((ruler, i) => ({ id: `rl${i + 1}`, ...ruler }));
    scene.hidden = pointIds.length === 0 ? [] : hidden.map(n => pointIds[n % pointIds.length]!);
    return document;
  });
