import { DEFAULT_WALL_WIDTH } from '../../document/geometry/band/blocksFromContour';
import type { FaceRef } from '../../document/geometry/axes/findAxes';
import type { OffsetSide } from '../../document/geometry/predicates/offsetPoint';
import { DEFAULT_SNAP_FLAGS, type SnapResult } from '../../document/geometry/snap/getSnapPoint';
import { LABEL_OFFSET } from '../../document/geometry/measure/labelPlacement';
import type { Viewport } from '../../document/geometry/viewport';
import type { FloorLayout, PlanPosition } from '../../document/PlannerDocument';
import type { DerivedFloor } from '../../engine/rebuild';
import { createTestManager, ringDocument } from '../../engine/testing/testManager';
import { DEFAULT_VIEWPORT, type HitTarget, type ToolState, type ToolVariant } from '../../engine/tools/ToolState';
import { buildLengthFields, previewFieldValue, type LengthFieldDescriptor } from './lengthFields';

/**
 * Состояния автомата собираются литералами, а не гоняются через фасад: тесту нужны ровно заданные точки и
 * курсор, а `tools.pointerMove` пропустил бы их через снап. Общие поля — дефолтные (`ToolCommon`).
 */
const state = (variant: ToolVariant, viewport: Viewport = DEFAULT_VIEWPORT): ToolState => ({
  snapFlags: DEFAULT_SNAP_FLAGS,
  viewport,
  ...variant,
});

const zoom = (scale: number): Viewport => ({ ...DEFAULT_VIEWPORT, scale });

const NO_SNAP: SnapResult = {
  snapped: { x: 0, y: 0 },
  alignerX: null,
  alignerY: null,
  bisAnchor: null,
  rawAlignersX: [null, null],
  rawAlignersY: [null, null],
  hit: { kind: 'none' },
};

/** Один прямоугольный контур `width × height` с известными id точек — для проверки порогов и `anchor`. */
const rectLayout = (width: number, height: number): FloorLayout => ({
  points: {
    a: { id: 'a', x: 0, y: 0 },
    b: { id: 'b', x: width, y: 0 },
    c: { id: 'c', x: width, y: height },
    d: { id: 'd', x: 0, y: height },
  },
  contours: [{ id: 'k1', kind: 'outer', points: ['a', 'b', 'c', 'd'] }],
  covers: [],
  areas: [],
  cuts: [],
  rooms: [],
});

/** Полая комната 400×300 с толщиной 10 после нормализации: `outer` + `inner`, четыре оси стен. */
const ring = (): { layout: FloorLayout; derived: DerivedFloor } => {
  const { manager } = createTestManager(ringDocument());
  return { layout: manager.document.get().floors[0]!.layout, derived: manager.document.getDerived().floors[0]! };
};

const editingVariant = (selection: HitTarget | null = null): ToolVariant => ({
  kind: 'editing',
  hover: null,
  selection,
});

const editing = (selection: HitTarget | null = null): ToolState => state(editingVariant(selection));

const walls = (
  points: readonly PlanPosition[],
  cursor: PlanPosition | null,
  side: OffsetSide = 'left',
): ToolVariant => ({
  kind: 'making-walls',
  points,
  cursor,
  side,
  sideFixed: false,
  startNeighbours: null,
  preview: [],
  snap: null,
  guides: [],
  undo: [],
  redo: [],
});

const rect = (origin: PlanPosition | null, cursor: PlanPosition | null): ToolVariant => ({
  kind: 'making-rect',
  origin,
  cursor,
  preview: [],
  snap: null,
  guides: [],
});

const build = (
  layout: FloorLayout,
  derived: DerivedFloor | null,
  tools: ToolState,
  wallWidth = DEFAULT_WALL_WIDTH,
): LengthFieldDescriptor[] => buildLengthFields({ layout, derived, tools, wallWidth });

const keys = (fields: readonly LengthFieldDescriptor[]): string[] => fields.map(field => field.key);

const byKey = (fields: readonly LengthFieldDescriptor[], key: string): LengthFieldDescriptor =>
  fields.find(field => field.key === key)!;

describe('buildLengthFields — рёбра готовой геометрии', () => {
  it('у каждого сегмента полой комнаты два поля, связанных pairKey в обе стороны', () => {
    const { layout, derived } = ring();
    const fields = build(layout, derived, editing());

    expect(fields).toHaveLength(8);
    for (const field of fields) {
      expect(field.pairKey).toBeDefined();
      const pair = byKey(fields, field.pairKey!);
      expect(pair.pairKey).toBe(field.key);
      expect(pair.key).not.toBe(field.key);
      // При базовом зуме (scale = 1) все восемь рёбер длиннее порога инпута.
      expect(field.editable).toBe(true);
      expect(field.commitOn).toBe('enter-blur-tab');
    }
    // Пара идёт подряд: Tab с внешнего ребра ведёт на внутреннее того же сегмента, а не на соседнее ребро.
    for (let i = 0; i < fields.length; i += 2) expect(fields[i]!.pairKey).toBe(fields[i + 1]!.key);
  });

  it('подписи пары расходятся от тела стены, а не толпятся в ленте', () => {
    const { layout, derived } = ring();
    const fields = build(layout, derived, editing());
    const outerId = layout.contours.find(contour => contour.kind === 'outer')!.id;

    for (const outer of fields.filter(field => field.key.startsWith(`edge:${outerId}:`))) {
      const inner = byKey(fields, outer.pairKey!);
      // Пара лежит по разные стороны ленты: расстояние между подписями — толщина стены плюс два офсета.
      const gap = Math.hypot(inner.placement.x - outer.placement.x, inner.placement.y - outer.placement.y);
      expect(gap).toBeCloseTo(DEFAULT_WALL_WIDTH + 2 * LABEL_OFFSET, 6);
      // И ни одна из них не оказывается ближе к чужой грани, чем к своей: подписи не меняются местами.
      expect(gap).toBeGreaterThan(DEFAULT_WALL_WIDTH);
    }
  });

  it('aria-label различает кольца: внешнее ребро и внутреннее', () => {
    const { layout, derived } = ring();
    const fields = build(layout, derived, editing());
    const outerId = layout.contours.find(contour => contour.kind === 'outer')!.id;
    const innerId = layout.contours.find(contour => contour.kind === 'inner')!.id;

    const labels = fields.map(field => [field.key.startsWith(`edge:${outerId}:`), field.ariaLabel] as const);
    for (const [isOuter, label] of labels) {
      expect(label).toBe(isOuter ? 'длина внешнего ребра' : 'длина внутреннего ребра');
    }
    expect(fields.filter(field => field.key.startsWith(`edge:${innerId}:`))).toHaveLength(4);
  });

  it('без пары (одинокий контур без осей) aria-label нейтральный и pairKey нет', () => {
    const fields = build(rectLayout(400, 300), null, editing());
    expect(fields).toHaveLength(4);
    for (const field of fields) {
      expect(field.ariaLabel).toBe('длина ребра');
      expect(field.pairKey).toBeUndefined();
    }
  });

  it('значение поля — евклидова длина ребра', () => {
    const fields = build(rectLayout(400, 300), null, editing());
    expect(fields.map(field => field.value)).toEqual([400, 300, 400, 300]);
  });

  it('порог подписи 30 px: ровно на пороге поле есть, ниже — поля нет вовсе', () => {
    // scale 0.25 точен в двоичной арифметике: 120 см → ровно 30 px, 116 см → 29 px.
    expect(build(rectLayout(180, 120), null, editing(), DEFAULT_WALL_WIDTH)).toHaveLength(4);
    const onEdge = build(rectLayout(180, 120), null, state(editingVariant(), zoom(0.25)));
    expect(onEdge).toHaveLength(4);
    const below = build(rectLayout(180, 116), null, state(editingVariant(), zoom(0.25)));
    expect(below).toHaveLength(2);
    expect(below.map(field => field.value)).toEqual([180, 180]);
  });

  it('порог инпута 45 px: ровно на пороге поле редактируемое, ниже — статическая подпись', () => {
    // При scale 0.25: 180 см → ровно 45 px, 176 см → 44 px, 120 см → 30 px.
    const fields = build(rectLayout(180, 120), null, state(editingVariant(), zoom(0.25)));
    expect(fields.map(field => field.editable)).toEqual([true, false, true, false]);

    const below = build(rectLayout(176, 120), null, state(editingVariant(), zoom(0.25)));
    expect(below.every(field => field.editable)).toBe(false);
  });

  it('anchor появляется только при выделенной вершине ребра и равен другому концу', () => {
    const layout = rectLayout(400, 300);
    const fields = build(layout, null, state(editingVariant({ kind: 'point', id: 'b' })));
    const anchors = fields.map(field => (field.target.kind === 'edge' ? (field.target.anchor ?? null) : null));
    // Рёбра в порядке контура: a→b, b→c, c→d, d→a. Выделена `b` — фиксируется противоположный конец.
    expect(anchors).toEqual(['a', 'c', null, null]);
  });

  it('без выделения вершины anchor не проставляется ни одному ребру', () => {
    const fields = build(rectLayout(400, 300), null, editing());
    for (const field of fields) {
      if (field.target.kind === 'edge') expect(field.target.anchor).toBeUndefined();
    }
  });

  it('выделенная стена: anchor нет, зато есть поле ширины — faces[0] выделенная грань, value = depth оси', () => {
    const { layout, derived } = ring();
    const axis = derived.axes[0]!;
    const fields = build(layout, derived, state(editingVariant({ kind: 'wall', face: axis.faces[0] })));

    expect(fields).toHaveLength(9);
    for (const field of fields) {
      if (field.target.kind === 'edge') expect(field.target.anchor).toBeUndefined();
    }
    const width = fields[fields.length - 1]!;
    expect(width.target).toEqual({ kind: 'wall-width', faces: [axis.faces[0], axis.faces[1]] });
    expect(width.value).toBe(axis.depth);
    expect(width.value).toBeCloseTo(10, 9);
    expect(width.ariaLabel).toBe('ширина стены');
    expect(width.editable).toBe(true);
    expect(width.key).toBe(`wall-width:${axis.faces[0].contourId}:${axis.faces[0].a}|${axis.faces[0].b}`);
  });

  it('поле ширины сдвигает именно выделенную грань: выбрана вторая грань оси — она же faces[0]', () => {
    const { layout, derived } = ring();
    const axis = derived.axes[0]!;
    const fields = build(layout, derived, state(editingVariant({ kind: 'wall', face: axis.faces[1] })));
    const width = fields[fields.length - 1]!;
    expect(width.target).toEqual({ kind: 'wall-width', faces: [axis.faces[1], axis.faces[0]] });
  });

  it('грань без оси в производном поля ширины не даёт', () => {
    const { layout, derived } = ring();
    const orphan: FaceRef = { contourId: 'нет-такого-контура', a: 'x', b: 'y' };
    const fields = build(layout, derived, state(editingVariant({ kind: 'wall', face: orphan })));
    expect(fields).toHaveLength(8);
  });

  it('выделена комната — только подписи рёбер, поля ширины нет', () => {
    const { layout, derived } = ring();
    const fields = build(layout, derived, state(editingVariant({ kind: 'room', roomId: layout.rooms[0]!.id })));
    expect(fields).toHaveLength(8);
  });

  it('позиции при драге берутся из pointOverrides — подпись пересчитывается на лету', () => {
    const layout = rectLayout(400, 300);
    const dragging = state({
      kind: 'dragging-point',
      pointId: 'b',
      selection: { kind: 'point', id: 'b' },
      origin: { x: 400, y: 0 },
      pointOverrides: { b: { x: 500, y: 0 } },
      snap: NO_SNAP,
      guides: [],
      dropTarget: null,
    });

    const fields = build(layout, null, dragging);
    // Ребро a→b выросло до 500, ребро b→c поехало вместе со сдвинутым концом.
    expect(fields[0]!.value).toBe(500);
    expect(fields[1]!.value).toBeCloseTo(Math.hypot(100, 300), 9);
    // Драг не даёт `anchor`: `selection` состояния драга — не «выделенная вершина» из спеки 07.
    const dragged = fields[0]!.target;
    expect(dragged.kind === 'edge' && dragged.anchor).toBeUndefined();
  });

  it('контур с пропавшей точкой пропускается целиком, остальные остаются', () => {
    const layout = rectLayout(400, 300);
    layout.contours.push({ id: 'k2', kind: 'inner', points: ['a', 'b', 'нет-такой'] });
    const fields = build(layout, null, editing());
    expect(fields).toHaveLength(4);
    expect(keys(fields).every(key => key.startsWith('edge:k1:'))).toBe(true);
  });
});

describe('buildLengthFields — рисование ломаной и комнаты', () => {
  it('draw:current есть при одной поставленной точке и курсоре', () => {
    const fields = build(rectLayout(1, 1), null, state(walls([{ x: 0, y: 0 }], { x: 200, y: 0 })));
    expect(keys(fields)).toEqual(['draw:current']);
    expect(fields[0]!.target).toEqual({ kind: 'draw-current', from: { x: 0, y: 0 }, towards: { x: 200, y: 0 } });
    expect(fields[0]!.value).toBe(200);
    expect(fields[0]!.commitOn).toBe('enter');
    expect(fields[0]!.ariaLabel).toBe('длина текущего ребра');
  });

  it('без курсора и без точек полей рисуемого контура нет', () => {
    expect(build(rectLayout(1, 1), null, state(walls([{ x: 0, y: 0 }], null)))).toHaveLength(0);
    expect(build(rectLayout(1, 1), null, state(walls([], { x: 200, y: 0 })))).toHaveLength(0);
  });

  it('длина показывается над каждым ребром контура, но править можно только текущее и первое', () => {
    const fields = build(
      rectLayout(1, 1),
      null,
      state(
        walls(
          [
            { x: 0, y: 0 },
            { x: 400, y: 0 },
            { x: 400, y: 300 },
          ],
          { x: 100, y: 300 },
        ),
      ),
    );

    // Три ребра контура: первое (`draw:first`), среднее (подпись) и живое к курсору.
    expect(keys(fields)).toEqual(['draw:current', 'draw:first', 'draw:edge:1']);
    expect(keys(fields.filter(field => field.editable))).toEqual(['draw:current', 'draw:first']);
    expect(byKey(fields, 'draw:edge:1').value).toBe(300);
    expect(byKey(fields, 'draw:edge:1').ariaLabel).toBe('длина ребра');
  });

  it('на первом ребре не бывает двух подписей: его занял draw:first', () => {
    const fields = build(
      rectLayout(1, 1),
      null,
      state(
        walls(
          [
            { x: 0, y: 0 },
            { x: 400, y: 0 },
            { x: 400, y: 300 },
          ],
          { x: 100, y: 300 },
        ),
      ),
    );
    expect(keys(fields).filter(key => key === 'draw:edge:0')).toHaveLength(0);

    // Пока точек две, `draw:first` не появляется — ребро подписывает обычная подпись.
    const two = build(
      rectLayout(1, 1),
      null,
      state(
        walls(
          [
            { x: 0, y: 0 },
            { x: 400, y: 0 },
          ],
          { x: 400, y: 300 },
        ),
      ),
    );
    expect(keys(two)).toEqual(['draw:current', 'draw:edge:0']);
    expect(byKey(two, 'draw:edge:0').editable).toBe(false);
  });

  it('подписи уже построенной геометрии при рисовании остаются, но редактируемыми не становятся', () => {
    const { layout, derived } = ring();
    const drawing = build(layout, derived, state(walls([{ x: 900, y: 900 }], { x: 900, y: 700 })));

    // Восемь подписей полой комнаты никуда не делись — плюс живое ребро рисуемого контура.
    expect(drawing.filter(field => field.key.startsWith('edge:'))).toHaveLength(8);
    expect(drawing.filter(field => field.key.startsWith('edge:')).every(field => !field.editable)).toBe(true);
    // Tab при рисовании ходит только по полям рисуемого контура.
    expect(keys(drawing.filter(field => field.editable))).toEqual(['draw:current']);
    // Поля рисуемого контура идут первыми: фокус по Tab начинается с них.
    expect(drawing[0]!.key).toBe('draw:current');
  });

  it('то же для прямоугольника: подписи плана остаются подписями, править можно только его стороны', () => {
    const { layout, derived } = ring();
    const drawing = build(layout, derived, state(rect({ x: 900, y: 900 }, { x: 1300, y: 1200 })));

    expect(drawing.filter(field => field.key.startsWith('edge:'))).toHaveLength(8);
    expect(keys(drawing.filter(field => field.editable))).toEqual([
      'rect:x:outer',
      'rect:x:inner',
      'rect:y:outer',
      'rect:y:inner',
    ]);
  });

  it('draw:first появляется с третьей точки, а не со второй', () => {
    const two = build(
      rectLayout(1, 1),
      null,
      state(
        walls(
          [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
          ],
          { x: 200, y: 200 },
        ),
      ),
    );
    // Ребро между двумя точками подписано, но правится только живое: `draw:first` ещё не появился.
    expect(keys(two)).toEqual(['draw:current', 'draw:edge:0']);

    const three = build(
      rectLayout(1, 1),
      null,
      state(
        walls(
          [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
          ],
          { x: 0, y: 200 },
        ),
      ),
    );
    expect(keys(three)).toEqual(['draw:current', 'draw:first', 'draw:edge:1']);
    const first = byKey(three, 'draw:first');
    // Двигается первая точка — она и есть `towards`; вторая точка фиксирована (`from`).
    expect(first.target).toEqual({ kind: 'draw-first', from: { x: 200, y: 0 }, towards: { x: 0, y: 0 } });
    expect(first.value).toBe(200);
    expect(first.commitOn).toBe('enter-blur-tab');
    expect(first.ariaLabel).toBe('длина первого ребра');
  });

  it('ключи стабильны между кадрами: постановка точки фокус не рвёт', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
    ];
    const frameA = build(rectLayout(1, 1), null, state(walls(points, { x: 0, y: 200 })));
    const frameB = build(rectLayout(1, 1), null, state(walls([...points, { x: 0, y: 200 }], { x: 0, y: 100 })));
    // Ключи редактируемых полей не зависят от числа точек — фокус переживает Enter и остаётся в поле.
    const editable = (fields: readonly LengthFieldDescriptor[]): string[] =>
      keys(fields.filter(field => field.editable));
    expect(editable(frameA)).toEqual(['draw:current', 'draw:first']);
    expect(editable(frameB)).toEqual(editable(frameA));
    // Подписей при этом становится больше: поставленное ребро подписывается наравне с остальными.
    expect(keys(frameB)).toContain('draw:edge:2');
  });

  it('подпись «Стен» уходит на сторону, противоположную ленте, у «Комнаты по точкам» — по обходу', () => {
    const points = [{ x: 0, y: 0 }];
    const cursor = { x: 200, y: 0 };
    const left = build(rectLayout(1, 1), null, state(walls(points, cursor, 'left')));
    const right = build(rectLayout(1, 1), null, state(walls(points, cursor, 'right')));
    const room = build(
      rectLayout(1, 1),
      null,
      state({ kind: 'making-room', points, cursor, snap: null, guides: [], undo: [], redo: [] }),
    );

    // Ребро горизонтальное, направление +x: лента «слева» ложится выше по экрану, подпись — ниже неё.
    expect(left[0]!.placement.y).toBeGreaterThan(right[0]!.placement.y);
    expect(room[0]!.placement.y).toBe(left[0]!.placement.y);
  });

  it('пороги при рисовании те же: короче 30 px — поля нет, от 45 px — редактируемое', () => {
    const draft = (length: number, scale: number) =>
      build(rectLayout(1, 1), null, state(walls([{ x: 0, y: 0 }], { x: length, y: 0 }), zoom(scale)));

    expect(draft(116, 0.25)).toHaveLength(0);
    expect(draft(120, 0.25)[0]!.editable).toBe(false);
    expect(draft(176, 0.25)[0]!.editable).toBe(false);
    expect(draft(180, 0.25)[0]!.editable).toBe(true);
  });
});

describe('buildLengthFields — живой прямоугольник', () => {
  it('на сплошном прямоугольнике два поля, на полом — четыре, в порядке x-внешнее → x-внутреннее → y', () => {
    const hollow = build(rectLayout(1, 1), null, state(rect({ x: 0, y: 0 }, { x: 400, y: 300 })));
    expect(keys(hollow)).toEqual(['rect:x:outer', 'rect:x:inner', 'rect:y:outer', 'rect:y:inner']);
    expect(hollow.map(field => field.value)).toEqual([400, 380, 300, 280]);
    expect(hollow.map(field => field.ariaLabel)).toEqual([
      'внешняя ширина прямоугольника',
      'внутренняя ширина прямоугольника',
      'внешняя высота прямоугольника',
      'внутренняя высота прямоугольника',
    ]);

    // Сторона 18 см не больше 2 × 10 — полости нет; зум 4× держит обе стороны выше порогов.
    const solid = build(rectLayout(1, 1), null, state(rect({ x: 0, y: 0 }, { x: 18, y: 30 }), zoom(4)));
    expect(keys(solid)).toEqual(['rect:x:outer', 'rect:y:outer']);
    expect(solid.map(field => field.ariaLabel)).toEqual(['ширина прямоугольника', 'высота прямоугольника']);
    expect(solid.every(field => field.pairKey === undefined)).toBe(true);
  });

  it('pairKey связывает кольца одной оси и только их', () => {
    const fields = build(rectLayout(1, 1), null, state(rect({ x: 0, y: 0 }, { x: 400, y: 300 })));
    expect(byKey(fields, 'rect:x:outer').pairKey).toBe('rect:x:inner');
    expect(byKey(fields, 'rect:x:inner').pairKey).toBe('rect:x:outer');
    expect(byKey(fields, 'rect:y:outer').pairKey).toBe('rect:y:inner');
    expect(fields.every(field => field.commitOn === 'enter')).toBe(true);
  });

  it('editable — только когда обе ведущие стороны ≥ 70 px: ровно 70 — да, 69,9 — нет', () => {
    const at = (width: number) => build(rectLayout(1, 1), null, state(rect({ x: 0, y: 0 }, { x: width, y: 300 })));
    expect(at(70).every(field => field.editable)).toBe(true);
    expect(at(69.9).some(field => field.editable)).toBe(false);
    // Поля при этом никуда не делись — это подписи, а не пустота.
    expect(at(69.9).length).toBeGreaterThan(0);
  });

  it('своя сторона короче 30 px — поля этого кольца нет вовсе', () => {
    // Внутренняя ширина 400 − 2 × 10 = 380 см; при scale 0.075 это 28,5 px, внешняя (30 px) остаётся.
    const fields = build(rectLayout(1, 1), null, state(rect({ x: 0, y: 0 }, { x: 400, y: 4000 }), zoom(0.075)));
    expect(keys(fields)).toEqual(['rect:x:outer', 'rect:y:outer', 'rect:y:inner']);
    expect(byKey(fields, 'rect:x:outer').pairKey).toBeUndefined();
  });

  it('без угла или без курсора полей нет', () => {
    expect(build(rectLayout(1, 1), null, state(rect(null, { x: 400, y: 300 })))).toHaveLength(0);
    expect(build(rectLayout(1, 1), null, state(rect({ x: 0, y: 0 }, null)))).toHaveLength(0);
  });

  it('поле оси x садится выше поля оси y по экрану, внутреннее кольцо — внутри внешнего', () => {
    const fields = build(rectLayout(1, 1), null, state(rect({ x: 0, y: 0 }, { x: 400, y: 300 })));
    const xOuter = byKey(fields, 'rect:x:outer');
    const xInner = byKey(fields, 'rect:x:inner');
    const yOuter = byKey(fields, 'rect:y:outer');

    // Верхнее по экрану ребро — меньший y; левое вертикальное — меньший x.
    expect(xOuter.placement.y).toBeLessThan(yOuter.placement.y);
    expect(yOuter.placement.x).toBeLessThan(xOuter.placement.x);
    // Подписи пары расходятся от тела стены: внешняя над внешней гранью, внутренняя под внутренней. Зазор —
    // толщина стены плюс два офсета, иначе на 100% зума поля высотой 26 px налезли бы друг на друга.
    expect(xInner.placement.y - xOuter.placement.y).toBeCloseTo(DEFAULT_WALL_WIDTH + 2 * LABEL_OFFSET, 6);
    // Подписи горизонтального ребра не повёрнуты.
    expect(xOuter.placement.angle).toBe(0);
  });
});

describe('previewFieldValue', () => {
  it('активное поле показывает введённое значение', () => {
    const fields = build(rectLayout(1, 1), null, state(rect({ x: 0, y: 0 }, { x: 400, y: 300 })));
    expect(previewFieldValue(fields, 'rect:x:outer', 500, 'rect:x:outer')).toBe(500);
  });

  it('пара прямоугольника пересчитывается на лету в обе стороны', () => {
    const fields = build(rectLayout(1, 1), null, state(rect({ x: 0, y: 0 }, { x: 400, y: 300 })));
    expect(previewFieldValue(fields, 'rect:x:outer', 500, 'rect:x:inner')).toBe(480);
    expect(previewFieldValue(fields, 'rect:x:inner', 480, 'rect:x:outer')).toBe(500);
  });

  it('поле другой оси прямоугольника не пересчитывается', () => {
    const fields = build(rectLayout(1, 1), null, state(rect({ x: 0, y: 0 }, { x: 400, y: 300 })));
    expect(previewFieldValue(fields, 'rect:x:outer', 500, 'rect:y:inner')).toBe(280);
  });

  it('пассивное поле готового контура не меняется: кольца независимы (ADR 0018 D1)', () => {
    const { layout, derived } = ring();
    const fields = build(layout, derived, editing());
    const active = fields[0]!;
    const passive = byKey(fields, active.pairKey!);
    expect(previewFieldValue(fields, active.key, 999, passive.key)).toBe(passive.value);
  });

  it('незнакомый ключ даёт NaN, а не чужое значение', () => {
    const fields = build(rectLayout(1, 1), null, state(rect({ x: 0, y: 0 }, { x: 400, y: 300 })));
    expect(previewFieldValue(fields, 'rect:x:outer', 500, 'нет-такого-поля')).toBeNaN();
  });
});
