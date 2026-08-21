import { blocksFromContour, DEFAULT_WALL_WIDTH, type WallBlock } from '../../document/geometry/band/blocksFromContour';
import { CLOSE_EPS } from '../../document/geometry/contours/contourClosure';
import { POLYLINE_ROOM_MIN_POINTS } from '../../document/geometry/contours/validateContour';
import { NO_ALIGNERS } from '../../document/geometry/snap/candidates';
import { DEFAULT_SNAP_FLAGS, type SnapResult } from '../../document/geometry/snap/getSnapPoint';
import type { SnapGuide } from '../../document/geometry/snap/guidesFor';
import { planToView, type Viewport } from '../../document/geometry/viewport';
import type { Id } from '../../document/id';
import type { FloorLayout, PlanPosition } from '../../document/PlannerDocument';
import { createPlanBuilder } from '../../document/testing/planBuilder';
import { createPlannerBus } from '../../engine/PlannerBus';
import { PlannerStore } from '../../engine/PlannerStore';
import type { DerivedFloor } from '../../engine/rebuild';
import type {
  EditingState,
  MakingRectState,
  MakingRoomState,
  MakingWallsState,
  ToolState,
} from '../../engine/tools/ToolState';
import { DRAFT_METRICS, DRAFT_PALETTE_FALLBACK } from './draftStyle';
import { drawFrame, type DraftFrame } from './drawFrame';

/**
 * Вьювер конструктора проверяется по **вызовам и параметрам, а не по пикселям** (ADR 0020 P7): фейковый
 * `CanvasRenderingContext2D` пишет ленту `{ op, args, style }`, где `style` — снимок стилевых полей на момент
 * `fill`/`stroke`/`fillRect`/`clip`. Нормативный источник ожиданий — эталон холста
 * `docs/ui/handoffs/planner/planner-canvas-reference.md` (таблица «состояние → атрибуты»).
 */

// ── Фейковый контекст ───────────────────────────────────────────────────────────────────────────────────────

interface StyleSnapshot {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  lineJoin: string;
  lineCap: string;
  lineDash: readonly number[];
}

interface RecordedOp {
  op: string;
  args: readonly unknown[];
  style: StyleSnapshot;
}

/**
 * Записывающий двойник холста. `save`/`restore` действительно сохраняют и восстанавливают стилевые поля —
 * иначе проверка «штриховка внутри `save`/`clip`/`restore`» ничего не значила бы.
 */
const createFakeContext = () => {
  const ops: RecordedOp[] = [];
  const stack: StyleSnapshot[] = [];

  const style = (): StyleSnapshot => ({
    fillStyle: fake.fillStyle,
    strokeStyle: fake.strokeStyle,
    lineWidth: fake.lineWidth,
    globalAlpha: fake.globalAlpha,
    lineJoin: fake.lineJoin,
    lineCap: fake.lineCap,
    lineDash: [...fake.lineDash],
  });
  const record = (op: string, ...args: unknown[]): void => {
    ops.push({ op, args, style: style() });
  };

  const fake = {
    ops,
    // Поля-аксессоры: вьювер пишет в них напрямую, снимок берётся в момент рисующего вызова.
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    lineDash: [] as readonly number[],

    setTransform: (...args: number[]): void => record('setTransform', ...args),
    clearRect: (...args: number[]): void => record('clearRect', ...args),
    fillRect: (...args: number[]): void => record('fillRect', ...args),
    beginPath: (): void => record('beginPath'),
    moveTo: (x: number, y: number): void => record('moveTo', x, y),
    lineTo: (x: number, y: number): void => record('lineTo', x, y),
    closePath: (): void => record('closePath'),
    arc: (...args: number[]): void => record('arc', ...args),
    roundRect: (...args: number[]): void => record('roundRect', ...args),
    fill: (rule?: string): void => record('fill', rule),
    stroke: (): void => record('stroke'),
    clip: (rule?: string): void => record('clip', rule),
    setLineDash: (dash: readonly number[]): void => {
      fake.lineDash = [...dash];
      record('setLineDash', [...dash]);
    },
    save: (): void => {
      stack.push(style());
      record('save');
    },
    restore: (): void => {
      const previous = stack.pop();
      if (previous) Object.assign(fake, previous);
      record('restore');
    },
  };
  return fake;
};

type FakeContext = ReturnType<typeof createFakeContext>;

const render = (frame: DraftFrame): FakeContext => {
  const fake = createFakeContext();
  drawFrame(fake as unknown as CanvasRenderingContext2D, frame);
  return fake;
};

// ── Чтение ленты вызовов ────────────────────────────────────────────────────────────────────────────────────

/** Рисующий вызов вместе с путём, накопленным с последнего `beginPath`. */
interface DrawCall {
  op: 'fill' | 'stroke' | 'clip' | 'fillRect';
  /** Индекс в `fake.ops` — им сравнивается порядок слоёв. */
  index: number;
  rule: string | undefined;
  args: readonly unknown[];
  style: StyleSnapshot;
  path: RecordedOp[];
}

const PATH_OPS = ['moveTo', 'lineTo', 'closePath', 'arc', 'roundRect'];
const PAINT_OPS = ['fill', 'stroke', 'clip', 'fillRect'];

const opsOf = (fake: FakeContext, op: string): RecordedOp[] => fake.ops.filter(recorded => recorded.op === op);
const stylesOf = (fake: FakeContext, op: string): StyleSnapshot[] => opsOf(fake, op).map(recorded => recorded.style);

const drawCalls = (fake: FakeContext): DrawCall[] => {
  const calls: DrawCall[] = [];
  let path: RecordedOp[] = [];
  fake.ops.forEach((op, index) => {
    if (op.op === 'beginPath') path = [];
    else if (PATH_OPS.includes(op.op)) path.push(op);
    else if (PAINT_OPS.includes(op.op)) {
      calls.push({
        op: op.op as DrawCall['op'],
        index,
        rule: op.args[0] as string | undefined,
        args: op.args,
        style: op.style,
        path: [...path],
      });
    }
  });
  return calls;
};

const paints = (fake: FakeContext, op: DrawCall['op']): DrawCall[] => drawCalls(fake).filter(call => call.op === op);

const vertices = (call: DrawCall): PlanPosition[] =>
  call.path
    .filter(op => op.op === 'moveTo' || op.op === 'lineTo')
    .map(op => ({ x: op.args[0] as number, y: op.args[1] as number }));

const segmentOf = (call: DrawCall): [PlanPosition, PlanPosition] => {
  const points = vertices(call);
  expect(points).toHaveLength(2);
  return [points[0]!, points[1]!];
};

const isClosed = (call: DrawCall): boolean => call.path.some(op => op.op === 'closePath');

const arcOf = (call: DrawCall): { x: number; y: number; r: number } | null => {
  const arc = call.path.find(op => op.op === 'arc');
  return arc ? { x: arc.args[0] as number, y: arc.args[1] as number, r: arc.args[2] as number } : null;
};

/** Все круговые вызовы кадра — хендлы точек и их ореолы/кольца. */
const circles = (fake: FakeContext): DrawCall[] => drawCalls(fake).filter(call => arcOf(call) !== null);

const near = (a: PlanPosition, b: PlanPosition): boolean => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
const centeredAt = (call: DrawCall, center: PlanPosition): boolean => {
  const arc = arcOf(call);
  return arc !== null && near(arc, center);
};

const sameDash = (dash: readonly number[], expected: readonly number[]): boolean =>
  dash.length === expected.length && dash.every((value, index) => value === expected[index]);
const dashedWith = (calls: DrawCall[], expected: readonly number[]): DrawCall[] =>
  calls.filter(call => sameDash(call.style.lineDash, expected));

const length = (a: PlanPosition, b: PlanPosition): number => Math.hypot(b.x - a.x, b.y - a.y);

// ── Данные кадра ────────────────────────────────────────────────────────────────────────────────────────────

const PALETTE = DRAFT_PALETTE_FALLBACK;
const H = DRAFT_METRICS.handle;

const VIEWPORT: Readonly<Viewport> = { scale: 1, center: { x: 200, y: 150 }, width: 800, height: 600 };

const screen = (position: PlanPosition, viewport: Viewport = VIEWPORT): PlanPosition => planToView(viewport, position);

/** Кольцо стен 400×300 толщиной 10 через настоящий `normalize` + `rebuild`: одна полая комната, 8 точек. */
const buildRingPlan = () => {
  const builder = createPlanBuilder();
  const { outer, inner } = builder.ring(0, 0, 400, 300, 10);
  const store = new PlannerStore(createPlannerBus(), builder.document());
  return {
    layout: store.getDocument().floors[0]!.layout,
    derived: store.getDerived().floors[0]! as DerivedFloor,
    outer,
    inner,
  };
};

const PLAN = buildRingPlan();
const ROOM = PLAN.derived.rooms[0]!;

const EMPTY_LAYOUT: FloorLayout = { points: {}, contours: [], covers: [], areas: [], cuts: [], rooms: [] };

const screenOfPoint = (id: Id): PlanPosition => screen(PLAN.layout.points[id]!);

/** Грань хранимого контура по индексам — цель `hover`/`selection` вида `wall`. */
const faceOf = (contourIndex: number, edge: number) => {
  const contour = PLAN.layout.contours[contourIndex]!;
  return {
    contourId: contour.id,
    a: contour.points[edge]!,
    b: contour.points[(edge + 1) % contour.points.length]!,
  };
};

const COMMON = { snapFlags: DEFAULT_SNAP_FLAGS, viewport: VIEWPORT };

const snapAt = (snapped: PlanPosition): SnapResult => ({
  snapped,
  alignerX: null,
  alignerY: null,
  bisAnchor: null,
  rawAlignersX: NO_ALIGNERS,
  rawAlignersY: NO_ALIGNERS,
  hit: { kind: 'none' },
});

const editing = (over: Partial<EditingState> = {}): ToolState => ({
  ...COMMON,
  kind: 'editing',
  hover: null,
  selection: null,
  ...over,
});

const makingWalls = (over: Partial<MakingWallsState> = {}): ToolState => ({
  ...COMMON,
  kind: 'making-walls',
  points: [],
  cursor: null,
  side: 'left',
  sideFixed: false,
  startNeighbours: null,
  preview: [],
  snap: null,
  guides: [],
  undo: [],
  redo: [],
  ...over,
});

const makingRect = (over: Partial<MakingRectState> = {}): ToolState => ({
  ...COMMON,
  kind: 'making-rect',
  origin: null,
  cursor: null,
  preview: [],
  snap: null,
  guides: [],
  ...over,
});

const makingRoom = (over: Partial<MakingRoomState> = {}): ToolState => ({
  ...COMMON,
  kind: 'making-room',
  points: [],
  cursor: null,
  snap: null,
  guides: [],
  undo: [],
  redo: [],
  ...over,
});

const draggingPoint = (pointId: Id, to: PlanPosition, selectionId: Id = pointId): ToolState => ({
  ...COMMON,
  kind: 'dragging-point',
  pointId,
  selection: { kind: 'point', id: selectionId },
  origin: PLAN.layout.points[pointId]!,
  pointOverrides: { [pointId]: to },
  snap: snapAt(to),
  guides: [],
  dropTarget: null,
});

const draggingWall = (): ToolState => ({
  ...COMMON,
  kind: 'dragging-wall',
  face: faceOf(0, 0),
  selection: { kind: 'wall', face: faceOf(0, 0) },
  grab: { x: 0, y: 0 },
  shift: 0,
  pointOverrides: {},
  snap: snapAt({ x: 0, y: 0 }),
});

const frameOf = (over: Partial<DraftFrame> = {}): DraftFrame => ({
  layout: PLAN.layout,
  derived: PLAN.derived,
  tools: editing(),
  viewport: VIEWPORT,
  palette: PALETTE,
  devicePixelRatio: 2,
  ...over,
});

/** Кадр без документа — для превью, гайдов и крестика: посторонней геометрии в ленте нет. */
const emptyFrame = (over: Partial<DraftFrame> = {}): DraftFrame =>
  frameOf({ layout: EMPTY_LAYOUT, derived: null, ...over });

// Часто используемые выборки.
const hatchOf = (fake: FakeContext): DrawCall[] =>
  paints(fake, 'stroke').filter(call => call.style.strokeStyle === PALETTE.roomHatch);

/**
 * Штриховка — один путь и один `stroke` на комнату (иначе тысячи вызовов на кадр), поэтому линии достаются
 * парами вершин `moveTo`/`lineTo` этого пути.
 */
const hatchSegments = (fake: FakeContext): [PlanPosition, PlanPosition][] =>
  hatchOf(fake).flatMap(call => {
    const points = vertices(call);
    const lines: [PlanPosition, PlanPosition][] = [];
    for (let i = 0; i + 1 < points.length; i += 2) lines.push([points[i]!, points[i + 1]!]);
    return lines;
  });

/**
 * Линии штриховки идут в направлении (1, 1), поэтому семейство параметризуется одним числом `u = x − y`,
 * постоянным вдоль линии.
 */
const hatchOffsets = (fake: FakeContext): number[] => hatchSegments(fake).map(([a]) => familyOf(a));
const familyOf = (point: PlanPosition): number => point.x - point.y;
/** Остаток в симметричном диапазоне `[−period/2, period/2)` — сравнение фаз без разрыва на границе периода. */
const wrap = (value: number, period: number): number => {
  const rest = ((value % period) + period) % period;
  return rest >= period / 2 ? rest - period : rest;
};

const contourStrokes = (fake: FakeContext): DrawCall[] =>
  paints(fake, 'stroke').filter(call => call.style.strokeStyle === PALETTE.contourLine);
const crossOf = (fake: FakeContext): DrawCall[] =>
  paints(fake, 'stroke').filter(call => call.style.lineWidth === DRAFT_METRICS.snap.crossWidth);
/**
 * Хендл в покое: заливка `--draft-canvas` радиусом 4.2 при выставленной обводке `--draft-point`. Обводка
 * в снимке отличает покой от ядра цели «завершить» — там тот же кружок, но обводка уже `--accent`.
 */
const restHandles = (fake: FakeContext): DrawCall[] =>
  circles(fake).filter(
    call =>
      call.op === 'fill' &&
      arcOf(call)!.r === H.radius &&
      call.style.fillStyle === PALETTE.canvas &&
      call.style.strokeStyle === PALETTE.point,
  );

describe('drawFrame', () => {
  describe('кадр и трансформация', () => {
    it('setTransform(dpr, 0, 0, dpr, 0, 0) ровно один раз и в самом начале кадра', () => {
      const fake = render(frameOf({ devicePixelRatio: 2 }));
      const transforms = opsOf(fake, 'setTransform');
      expect(transforms).toHaveLength(1);
      expect(transforms[0]!.args).toEqual([2, 0, 0, 2, 0, 0]);
      expect(fake.ops[0]!.op).toBe('setTransform');
    });

    it('фон: clearRect и fillRect на весь кадр цветом palette.canvas (эталон, «фон холста»)', () => {
      const fake = render(frameOf());
      expect(opsOf(fake, 'clearRect')[0]!.args).toEqual([0, 0, VIEWPORT.width, VIEWPORT.height]);
      const background = paints(fake, 'fillRect');
      expect(background).toHaveLength(1);
      expect(background[0]!.args).toEqual([0, 0, VIEWPORT.width, VIEWPORT.height]);
      expect(background[0]!.style.fillStyle).toBe(PALETTE.canvas);
    });

    it('сетки нет (решение 1): на пустом документе после фона ни одного stroke или fill', () => {
      const fake = render(emptyFrame());
      expect(paints(fake, 'fillRect')).toHaveLength(1);
      expect(opsOf(fake, 'stroke')).toHaveLength(0);
      expect(opsOf(fake, 'fill')).toHaveLength(0);
    });

    it('нулевой размер кадра — рисуется только фон', () => {
      const fake = render(frameOf({ viewport: { ...VIEWPORT, width: 0 } }));
      const trace = fake.ops.map(op => op.op).filter(op => op !== 'setLineDash');
      expect(trace).toEqual(['setTransform', 'clearRect', 'fillRect']);
    });
  });

  describe('порядок слоёв (ADR 0020 P2, снизу вверх)', () => {
    const preview: readonly WallBlock[] = blocksFromContour(
      [
        { x: 0, y: 400 },
        { x: 200, y: 400 },
      ],
      DEFAULT_WALL_WIDTH,
      'left',
      false,
    );
    const guide: SnapGuide = { kind: 'axis-x', from: { x: 100, y: 100 }, to: { x: 100, y: 250 }, face: null };

    it('фон → комнаты → тела стен → грани контуров → хендлы → превью → гайды/крест', () => {
      const fake = render(
        frameOf({
          tools: makingWalls({
            points: [
              { x: 0, y: 400 },
              { x: 200, y: 400 },
            ],
            cursor: { x: 200, y: 300 },
            preview,
            guides: [guide],
          }),
        }),
      );
      const calls = drawCalls(fake);
      const indexOf = (match: (call: DrawCall) => boolean): number => {
        const call = calls.find(match);
        expect(call).toBeDefined();
        return call!.index;
      };

      const layers = {
        фон: indexOf(call => call.op === 'fillRect'),
        комната: indexOf(call => call.op === 'fill' && call.style.fillStyle === PALETTE.roomFill),
        телоСтены: indexOf(call => call.op === 'fill' && call.style.fillStyle === PALETTE.wallBody),
        граньКонтура: indexOf(
          call => call.op === 'stroke' && call.style.strokeStyle === PALETTE.contourLine && isClosed(call),
        ),
        хендл: indexOf(call => arcOf(call) !== null),
        превью: indexOf(call => call.op === 'fill' && call.style.globalAlpha === DRAFT_METRICS.preview.bandAlpha),
        гайд: indexOf(call => sameDash(call.style.lineDash, DRAFT_METRICS.snap.guideDash)),
        крестик: indexOf(call => call.op === 'stroke' && call.style.lineWidth === DRAFT_METRICS.snap.crossWidth),
      };

      const order = Object.values(layers);
      expect(Object.keys(layers)).toEqual(
        Object.entries(layers)
          .sort(([, a], [, b]) => a - b)
          .map(([name]) => name),
      );
      expect(new Set(order).size).toBe(order.length);
    });
  });

  describe('комнаты (эталон: заливка, штриховка, наведение, выделение)', () => {
    const roomTarget = { kind: 'room', roomId: ROOM.roomId } as const;
    const roomFills = (fake: FakeContext): DrawCall[] =>
      paints(fake, 'fill').filter(call => call.style.fillStyle === PALETTE.roomFill);
    const roomTints = (fake: FakeContext): DrawCall[] =>
      paints(fake, 'fill').filter(call => call.style.fillStyle === PALETTE.guide && call.rule === 'evenodd');
    const roomRings = (fake: FakeContext): DrawCall[] =>
      paints(fake, 'stroke').filter(
        call =>
          call.style.strokeStyle === PALETTE.guide &&
          call.style.lineWidth === DRAFT_METRICS.room.selectedRingWidth &&
          arcOf(call) === null,
      );

    it('заливка palette.roomFill правилом evenodd по обводу и дыркам комнаты', () => {
      const fake = render(frameOf());
      const fills = roomFills(fake);
      expect(fills).toHaveLength(PLAN.derived.rooms.length);
      expect(fills[0]!.rule).toBe('evenodd');
      const expected = [ROOM.outline, ...ROOM.holes].flatMap(ring => ring.map(screenOfPoint));
      expect(vertices(fills[0]!)).toEqual(expected);
    });

    it('штриховка рисуется внутри save / clip(evenodd) / restore цветом roomHatch толщиной hatchWidth', () => {
      const fake = render(frameOf());
      const save = fake.ops.findIndex(op => op.op === 'save');
      const restore = fake.ops.findIndex(op => op.op === 'restore');
      const clip = paints(fake, 'clip')[0]!;
      expect(clip.rule).toBe('evenodd');
      expect(save).toBeLessThan(clip.index);
      expect(clip.index).toBeLessThan(restore);

      expect(hatchSegments(fake).length).toBeGreaterThan(1);
      // Одна заливка семейства линий: один путь и один `stroke` — иначе на комнату уходят сотни вызовов.
      const hatch = hatchOf(fake);
      expect(hatch).toHaveLength(1);
      for (const line of hatch) {
        expect(line.style.lineWidth).toBe(DRAFT_METRICS.room.hatchWidth);
        expect(line.index).toBeGreaterThan(clip.index);
        expect(line.index).toBeLessThan(restore);
      }
    });

    it('шаг штриховки по нормали — plan.hatchStep × scale, наклон 45°', () => {
      for (const scale of [1, 2]) {
        const fake = render(frameOf({ viewport: { ...VIEWPORT, scale } }));
        const segments = hatchSegments(fake);
        expect(segments.length).toBeGreaterThan(1);
        for (const [a, b] of segments) expect(b.y - a.y).toBeCloseTo(b.x - a.x, 9); // направление (1, 1) — 45°
        const expectedStep = DRAFT_METRICS.plan.hatchStep * scale;
        for (let i = 1; i < segments.length; i++) {
          // Соседние линии направления (1, 1): расстояние по нормали = сдвиг по x / √2.
          const shift = segments[i]![0].x - segments[i - 1]![0].x;
          expect(shift / Math.SQRT2).toBeCloseTo(expectedStep, 9);
        }
      }
    });

    it('штриховка привязана к плану: при пане линии едут вместе с комнатой (эталон, «Поведение при зуме»)', () => {
      const panned: Viewport = { ...VIEWPORT, center: { x: VIEWPORT.center.x + 37, y: VIEWPORT.center.y - 11 } };
      const base = render(frameOf());
      const moved = render(frameOf({ viewport: panned }));
      const period = DRAFT_METRICS.plan.hatchStep * VIEWPORT.scale * Math.SQRT2;

      // Фаза семейства относительно вершины комнаты не меняется — штриховка не стоит на месте, пока план едет.
      const anchor = PLAN.layout.points[PLAN.inner[0]!]!;
      const phaseAt = (fake: FakeContext, viewport: Viewport): number =>
        wrap(familyOf(screen(anchor, viewport)) - hatchOffsets(fake)[0]!, period);
      expect(phaseAt(moved, panned)).toBeCloseTo(phaseAt(base, VIEWPORT), 9);

      // То же самое иначе: набор смещений сдвинулся ровно на сдвиг экранного начала координат плана.
      const originShift = familyOf(screen({ x: 0, y: 0 }, panned)) - familyOf(screen({ x: 0, y: 0 }));
      expect(wrap(originShift, period)).not.toBeCloseTo(0, 6); // пан выбран так, что сдвиг не кратен периоду
      expect(wrap(hatchOffsets(moved)[0]! - hatchOffsets(base)[0]! - originShift, period)).toBeCloseTo(0, 9);
    });

    it('мелкий масштаб (шаг меньше 2 px) — штриховки нет вовсе', () => {
      const fake = render(frameOf({ viewport: { ...VIEWPORT, scale: 0.2 } }));
      expect(DRAFT_METRICS.plan.hatchStep * 0.2).toBeLessThan(2);
      expect(hatchOf(fake)).toHaveLength(0);
    });

    it('комната под наведением — заливка palette.guide с globalAlpha 0.06 поверх, без кольца', () => {
      const fake = render(frameOf({ tools: editing({ hover: roomTarget }) }));
      const tints = roomTints(fake);
      expect(tints).toHaveLength(1);
      expect(tints[0]!.style.globalAlpha).toBe(DRAFT_METRICS.room.hoverAlpha);
      expect(tints[0]!.index).toBeGreaterThan(roomFills(fake)[0]!.index);
      expect(roomRings(fake)).toHaveLength(0);
    });

    it('выделенная комната — заливка 0.1 плюс кольцо lineWidth 1 цветом palette.guide', () => {
      const fake = render(frameOf({ tools: editing({ selection: roomTarget }) }));
      const tints = roomTints(fake);
      expect(tints).toHaveLength(1);
      expect(tints[0]!.style.globalAlpha).toBe(DRAFT_METRICS.room.selectedAlpha);
      const rings = roomRings(fake);
      expect(rings).toHaveLength(1);
      expect(rings[0]!.style.lineDash).toEqual([]);
      expect(vertices(rings[0]!)).toEqual(vertices(tints[0]!));
    });

    it('наведение и выделение на одной комнате — берётся выделение', () => {
      const fake = render(frameOf({ tools: editing({ hover: roomTarget, selection: roomTarget }) }));
      const tints = roomTints(fake);
      expect(tints).toHaveLength(1);
      expect(tints[0]!.style.globalAlpha).toBe(DRAFT_METRICS.room.selectedAlpha);
    });
  });

  describe('тела стен', () => {
    it('все треугольники всех стен — одним путём и одной заливкой palette.wallBody (иначе швы)', () => {
      const fake = render(frameOf());
      const fills = paints(fake, 'fill').filter(call => call.style.fillStyle === PALETTE.wallBody);
      expect(fills).toHaveLength(1);

      const triangles = PLAN.derived.walls.flatMap(wall => wall.triangles);
      expect(triangles.length).toBeGreaterThan(0);
      expect(fills[0]!.path.filter(op => op.op === 'moveTo')).toHaveLength(triangles.length);
      expect(vertices(fills[0]!)).toHaveLength(triangles.length * 3);
      expect(fills[0]!.path.filter(op => op.op === 'closePath')).toHaveLength(triangles.length);
    });
  });

  describe('грани контуров', () => {
    it('каждый контур обведён palette.contourLine толщиной 1.4, стыки miter, без пунктира', () => {
      const fake = render(frameOf());
      const faces = contourStrokes(fake);
      expect(faces).toHaveLength(PLAN.layout.contours.length);
      faces.forEach((face, index) => {
        expect(face.style.lineWidth).toBe(DRAFT_METRICS.face.width);
        expect(face.style.lineJoin).toBe('miter');
        expect(face.style.lineDash).toEqual([]);
        expect(isClosed(face)).toBe(true);
        expect(vertices(face)).toEqual(PLAN.layout.contours[index]!.points.map(screenOfPoint));
      });
    });

    it('сторона под наведением — guide 2px, выделенная — 2.6px, и выделение рисуется после наведения', () => {
      const hovered = faceOf(0, 0);
      const selected = faceOf(0, 1);
      const fake = render(
        frameOf({
          tools: editing({ hover: { kind: 'wall', face: hovered }, selection: { kind: 'wall', face: selected } }),
        }),
      );
      const accents = paints(fake, 'stroke').filter(
        call => call.style.strokeStyle === PALETTE.guide && arcOf(call) === null,
      );
      expect(accents.map(call => call.style.lineWidth)).toEqual([
        DRAFT_METRICS.face.hoverWidth,
        DRAFT_METRICS.face.selectedWidth,
      ]);
      expect(segmentOf(accents[0]!)).toEqual([screenOfPoint(hovered.a), screenOfPoint(hovered.b)]);
      expect(segmentOf(accents[1]!)).toEqual([screenOfPoint(selected.a), screenOfPoint(selected.b)]);
      expect(accents[0]!.index).toBeLessThan(accents[1]!.index);
    });
  });

  describe('хендлы точек (эталон, шесть состояний)', () => {
    const pointIds = Object.keys(PLAN.layout.points);
    const first = pointIds[0]!;

    it('по хендлу на каждую точку layout.points; покой — r 4.2, заливка canvas, обводка 1.4 palette.point', () => {
      const fake = render(frameOf());
      const bodies = restHandles(fake);
      expect(bodies).toHaveLength(pointIds.length);
      expect(bodies.map(call => ({ x: arcOf(call)!.x, y: arcOf(call)!.y }))).toEqual(pointIds.map(screenOfPoint));
      for (const body of bodies) expect(arcOf(body)!.r).toBe(H.radius);

      const outlines = circles(fake).filter(call => call.op === 'stroke' && arcOf(call)!.r === H.radius);
      expect(outlines).toHaveLength(pointIds.length);
      for (const outline of outlines) {
        expect(outline.style.strokeStyle).toBe(PALETTE.point);
        expect(outline.style.lineWidth).toBe(H.strokeWidth);
      }
      // Полная окружность: дуга от 0 до 2π.
      expect(circles(fake)[0]!.path[0]!.args.slice(3)).toEqual([0, Math.PI * 2]);
    });

    it('наведение — ореол r 6.6 с alpha 0.14 и обводка 1.6 цветом palette.guide', () => {
      const fake = render(frameOf({ tools: editing({ hover: { kind: 'point', id: first } }) }));
      const halo = circles(fake).find(call => arcOf(call)!.r === H.hoverHaloRadius)!;
      expect(halo.op).toBe('fill');
      expect(halo.style.fillStyle).toBe(PALETTE.guide);
      expect(halo.style.globalAlpha).toBe(H.hoverHaloAlpha);
      expect(centeredAt(halo, screenOfPoint(first))).toBe(true);

      const outlines = circles(fake).filter(
        call => call.op === 'stroke' && arcOf(call)!.r === H.radius && call.style.strokeStyle === PALETTE.guide,
      );
      expect(outlines).toHaveLength(1);
      expect(outlines[0]!.style.lineWidth).toBe(H.hoverStrokeWidth);
    });

    it('выделение — заливка accent r 5.8 и белое ядро r 3 поверх', () => {
      const fake = render(frameOf({ tools: editing({ selection: { kind: 'point', id: first } }) }));
      const body = circles(fake).find(call => arcOf(call)!.r === H.selectedRadius)!;
      const core = circles(fake).find(call => arcOf(call)!.r === H.selectedCoreRadius)!;
      expect(body.op).toBe('fill');
      expect(body.style.fillStyle).toBe(PALETTE.guide);
      expect(core.op).toBe('fill');
      expect(core.style.fillStyle).toBe(PALETTE.canvas);
      expect(core.index).toBeGreaterThan(body.index);
      expect(centeredAt(core, screenOfPoint(first))).toBe(true);
    });

    it('драг — ореол r 7.2 с alpha 0.1 и заливка accent r 4.2', () => {
      const dragged = { x: -50, y: -40 };
      const fake = render(frameOf({ tools: draggingPoint(PLAN.outer[0]!, dragged) }));
      const center = screen(dragged);

      const halo = circles(fake).find(call => arcOf(call)!.r === H.draggingHaloRadius)!;
      expect(halo.op).toBe('fill');
      expect(halo.style.fillStyle).toBe(PALETTE.guide);
      expect(halo.style.globalAlpha).toBe(H.draggingHaloAlpha);
      expect(centeredAt(halo, center)).toBe(true);

      const body = circles(fake).find(
        call => call.op === 'fill' && arcOf(call)!.r === H.radius && centeredAt(call, center),
      )!;
      expect(body.style.fillStyle).toBe(PALETTE.guide);
      expect(body.style.globalAlpha).toBe(1);
      // Обводки покоя в перетаскиваемой точке нет.
      expect(circles(fake).some(call => call.op === 'stroke' && centeredAt(call, center))).toBe(false);
    });

    it('приоритет состояний: драг > выделение > наведение > покой', () => {
      const dragging = render(frameOf({ tools: draggingPoint(first, PLAN.layout.points[first]!) }));
      expect(circles(dragging).some(call => arcOf(call)!.r === H.draggingHaloRadius)).toBe(true);
      expect(circles(dragging).some(call => arcOf(call)!.r === H.selectedRadius)).toBe(false);

      const both = render(
        frameOf({
          tools: editing({ hover: { kind: 'point', id: first }, selection: { kind: 'point', id: first } }),
        }),
      );
      expect(circles(both).some(call => arcOf(call)!.r === H.selectedRadius)).toBe(true);
      expect(circles(both).some(call => arcOf(call)!.r === H.hoverHaloRadius)).toBe(false);
    });
  });

  // Спека 01 «Ручка деления грани», задача 0096: собственных метрик у ручки нет — она рисуется теми же
  // состояниями хендла точки, что и вершины, и сидит ровно на середине наведённой грани (сдвиг 0).
  describe('ручка деления грани (0096)', () => {
    const splitFace = faceOf(0, 0);
    const midOf = (face: { a: Id; b: Id }, layout: FloorLayout = PLAN.layout): PlanPosition =>
      screen({
        x: (layout.points[face.a]!.x + layout.points[face.b]!.x) / 2,
        y: (layout.points[face.a]!.y + layout.points[face.b]!.y) / 2,
      });

    it('наведение на грань — хендл в покое ровно на её середине, сверх хендлов вершин', () => {
      const fake = render(frameOf({ tools: editing({ hover: { kind: 'wall', face: splitFace } }) }));
      const bodies = restHandles(fake);
      expect(bodies).toHaveLength(Object.keys(PLAN.layout.points).length + 1);
      expect(bodies.filter(call => centeredAt(call, midOf(splitFace)))).toHaveLength(1);
    });

    it('курсор в диске захвата — то же состояние наведения, что у вершины: ореол r 6.6', () => {
      const fake = render(frameOf({ tools: editing({ hover: { kind: 'wall', face: splitFace }, splitHandle: true }) }));
      const halos = circles(fake).filter(call => arcOf(call)!.r === H.hoverHaloRadius);
      expect(halos).toHaveLength(1);
      expect(centeredAt(halos[0]!, midOf(splitFace))).toBe(true);
    });

    it('без наведения на грань ручки нет вовсе', () => {
      const fake = render(frameOf());
      expect(restHandles(fake)).toHaveLength(Object.keys(PLAN.layout.points).length);
    });

    it('на грани короче двух порогов чистки контура ручки нет', () => {
      const builder = createPlanBuilder();
      builder.rect('outer', 0, 0, 200, 8);
      const store = new PlannerStore(createPlannerBus(), builder.document());
      const layout = store.getDocument().floors[0]!.layout;
      const contour = layout.contours[0]!;
      const n = contour.points.length;
      const shortEdge = [...Array(n).keys()].find(
        i => length(layout.points[contour.points[i]!]!, layout.points[contour.points[(i + 1) % n]!]!) === 8,
      )!;
      const face = { contourId: contour.id, a: contour.points[shortEdge]!, b: contour.points[(shortEdge + 1) % n]! };
      const fake = render(frameOf({ layout, derived: null, tools: editing({ hover: { kind: 'wall', face } }) }));
      expect(restHandles(fake)).toHaveLength(Object.keys(layout.points).length);
      expect(restHandles(fake).some(call => centeredAt(call, midOf(face, layout)))).toBe(false);
    });
  });

  describe('цели «замкнуть контур» и «завершить открытую стену» (решение 2)', () => {
    const WALL_POINTS: readonly PlanPosition[] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
    ];
    const closeRings = (fake: FakeContext): DrawCall[] =>
      circles(fake).filter(call => call.op === 'stroke' && arcOf(call)!.r === H.closeRingRadius);
    const finishFrames = (fake: FakeContext): DrawCall[] =>
      paints(fake, 'stroke').filter(call => call.path.some(op => op.op === 'roundRect'));

    it('стены: курсор в CLOSE_EPS от первой точки — на первой цель «замкнуть контур»', () => {
      const fake = render(
        emptyFrame({ tools: makingWalls({ points: WALL_POINTS, cursor: { x: CLOSE_EPS / 2, y: 0 } }) }),
      );
      const first = screen(WALL_POINTS[0]!);

      const body = circles(fake).find(
        call => call.op === 'fill' && arcOf(call)!.r === H.radius && centeredAt(call, first),
      )!;
      expect(body.style.fillStyle).toBe(PALETTE.guide);

      const rings = closeRings(fake);
      expect(rings).toHaveLength(1);
      expect(rings[0]!.style.lineWidth).toBe(H.closeRingWidth);
      expect(rings[0]!.style.strokeStyle).toBe(PALETTE.guide);
      expect(centeredAt(rings[0]!, first)).toBe(true);

      expect(finishFrames(fake)).toHaveLength(0);
      expect(restHandles(fake)).toHaveLength(WALL_POINTS.length - 1);
    });

    it('стены: курсор в DEFAULT_WALL_WIDTH от последней точки — на последней цель «завершить открытую стену»', () => {
      const fake = render(
        emptyFrame({
          tools: makingWalls({ points: WALL_POINTS, cursor: { x: 200, y: 200 + DEFAULT_WALL_WIDTH / 2 } }),
        }),
      );
      const last = screen(WALL_POINTS[2]!);

      const frames = finishFrames(fake);
      expect(frames).toHaveLength(1);
      expect(frames[0]!.style.lineWidth).toBe(H.finishFrameWidth);
      expect(frames[0]!.style.strokeStyle).toBe(PALETTE.guide);
      expect(frames[0]!.path.find(op => op.op === 'roundRect')!.args).toEqual([
        last.x - H.finishFrameSize / 2,
        last.y - H.finishFrameSize / 2,
        H.finishFrameSize,
        H.finishFrameSize,
        H.finishFrameRadius,
      ]);

      const hollow = circles(fake).find(
        call => call.op === 'stroke' && arcOf(call)!.r === H.radius && centeredAt(call, last),
      )!;
      expect(hollow.style.lineWidth).toBe(H.finishStrokeWidth);
      const core = circles(fake).find(
        call => call.op === 'fill' && arcOf(call)!.r === H.radius && centeredAt(call, last),
      )!;
      expect(core.style.fillStyle).toBe(PALETTE.canvas);

      expect(closeRings(fake)).toHaveLength(0);
      expect(restHandles(fake)).toHaveLength(WALL_POINTS.length - 1);
    });

    it('стены: курсор вдали от обеих — все поставленные точки как хендлы в покое', () => {
      const fake = render(emptyFrame({ tools: makingWalls({ points: WALL_POINTS, cursor: { x: 100, y: 100 } }) }));
      expect(closeRings(fake)).toHaveLength(0);
      expect(finishFrames(fake)).toHaveLength(0);
      expect(restHandles(fake)).toHaveLength(WALL_POINTS.length);
    });

    const ROOM_POINTS: readonly PlanPosition[] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ];

    it('комната по точкам: цель «замкнуть» по манхэттену в радиусе CLOSE_EPS от первой вершины', () => {
      const fake = render(
        emptyFrame({ tools: makingRoom({ points: ROOM_POINTS, cursor: { x: CLOSE_EPS / 4, y: CLOSE_EPS / 4 } }) }),
      );
      const rings = closeRings(fake);
      expect(rings).toHaveLength(1);
      expect(centeredAt(rings[0]!, screen(ROOM_POINTS[0]!))).toBe(true);
      expect(restHandles(fake)).toHaveLength(ROOM_POINTS.length - 1);
    });

    it('комната по точкам: у последней вершины — тоже «замкнуть», квадратной рамки нет вовсе', () => {
      // Открытого исхода у «Комнаты по точкам» нет: клик и в первую, и в последнюю вершину коммитит замкнутый
      // контур — обещать рамкой «завершить открытую стену» было бы враньём.
      const fake = render(
        emptyFrame({ tools: makingRoom({ points: ROOM_POINTS, cursor: { x: 0, y: 200 + CLOSE_EPS / 2 } }) }),
      );
      const rings = closeRings(fake);
      expect(rings).toHaveLength(1);
      expect(centeredAt(rings[0]!, screen(ROOM_POINTS[3]!))).toBe(true);
      expect(rings[0]!.style.lineWidth).toBe(H.closeRingWidth);
      expect(finishFrames(fake)).toHaveLength(0);
      expect(restHandles(fake)).toHaveLength(ROOM_POINTS.length - 1);
    });

    it('цель адресуется индексом вершины: две точки в одной координате не подсвечиваются обе', () => {
      const points: readonly PlanPosition[] = [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 0, y: 0 },
      ];
      const fake = render(emptyFrame({ tools: makingWalls({ points, cursor: { x: CLOSE_EPS / 2, y: 0 } }) }));
      const anchor = screen(points[0]!);

      expect(closeRings(fake)).toHaveLength(1);
      expect(centeredAt(closeRings(fake)[0]!, anchor)).toBe(true);
      // Дубль первой вершины (индекс 2) остался в покое, хотя экранная координата у него та же.
      const rests = restHandles(fake);
      expect(rests).toHaveLength(2);
      expect(rests.filter(call => centeredAt(call, anchor))).toHaveLength(1);
    });

    it('комната по точкам: с тремя вершинами цели нет — порог POLYLINE_ROOM_MIN_POINTS', () => {
      expect(POLYLINE_ROOM_MIN_POINTS).toBe(4);
      const points = ROOM_POINTS.slice(0, 3);
      const fake = render(emptyFrame({ tools: makingRoom({ points, cursor: { ...points[0]! } }) }));
      expect(closeRings(fake)).toHaveLength(0);
      expect(finishFrames(fake)).toHaveLength(0);
      expect(restHandles(fake)).toHaveLength(3);
    });
  });

  describe('превью рисования', () => {
    const SEGMENT: readonly PlanPosition[] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
    const BLOCKS = blocksFromContour([...SEGMENT], DEFAULT_WALL_WIDTH, 'left', false);
    const QUAD = BLOCKS[0]!;
    const CURSOR: PlanPosition = { x: 200, y: 100 };

    const wallsPreview = (): FakeContext =>
      render(emptyFrame({ tools: makingWalls({ points: SEGMENT, cursor: CURSOR, preview: BLOCKS }) }));

    it('making-walls: квады превью заливаются palette.guide с alpha 0.12', () => {
      const fake = wallsPreview();
      const band = paints(fake, 'fill').filter(call => call.style.fillStyle === PALETTE.guide && arcOf(call) === null);
      expect(band).toHaveLength(1);
      expect(band[0]!.style.globalAlpha).toBe(DRAFT_METRICS.preview.bandAlpha);
      expect(band[0]!.rule).toBeUndefined();
      expect(vertices(band[0]!)).toEqual(QUAD.map(point => screen(point)));
    });

    it('making-walls: грань офсета — пунктир 3/3 contourLine, линия сегмента — сплошная 1.4 contourLine', () => {
      const fake = wallsPreview();
      const dashed = dashedWith(contourStrokes(fake), DRAFT_METRICS.preview.bandFaceDash);
      expect(dashed).toHaveLength(1);
      expect(dashed[0]!.style.lineWidth).toBe(DRAFT_METRICS.preview.bandFaceWidth);
      expect(segmentOf(dashed[0]!)).toEqual([screen(QUAD[0]), screen(QUAD[1])]);

      const solid = contourStrokes(fake).filter(call => call.style.lineDash.length === 0);
      expect(solid).toHaveLength(1);
      expect(solid[0]!.style.lineWidth).toBe(DRAFT_METRICS.face.width);
      expect(segmentOf(solid[0]!)).toEqual([screen(QUAD[3]), screen(QUAD[2])]);
      expect(solid[0]!.index).toBeLessThan(dashed[0]!.index);
    });

    it('making-walls: живой сегмент от последней точки к курсору — 1.4 palette.guide сплошной', () => {
      const fake = wallsPreview();
      const live = paints(fake, 'stroke').filter(
        call => call.style.strokeStyle === PALETTE.guide && call.style.lineWidth === DRAFT_METRICS.preview.liveWidth,
      );
      expect(live).toHaveLength(1);
      expect(live[0]!.style.lineDash).toEqual([]);
      expect(segmentOf(live[0]!)).toEqual([screen(SEGMENT[1]!), screen(CURSOR)]);
    });

    it('making-walls: после превью пунктир сброшен', () => {
      const fake = wallsPreview();
      const dashed = dashedWith(paints(fake, 'stroke'), DRAFT_METRICS.preview.bandFaceDash);
      const after = drawCalls(fake).filter(call => call.index > dashed[0]!.index);
      for (const call of after) expect(call.style.lineDash).toEqual([]);
    });

    it('making-room: ленты нет — полигон поставленных точек contourLine 1.4 и живой сегмент accent', () => {
      const points: readonly PlanPosition[] = [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
      ];
      const cursor: PlanPosition = { x: 0, y: 200 };
      const fake = render(emptyFrame({ tools: makingRoom({ points, cursor }) }));

      expect(
        paints(fake, 'fill').filter(call => call.style.globalAlpha === DRAFT_METRICS.preview.bandAlpha),
      ).toHaveLength(0);

      const polyline = contourStrokes(fake);
      expect(polyline).toHaveLength(1);
      expect(polyline[0]!.style.lineWidth).toBe(DRAFT_METRICS.face.width);
      expect(isClosed(polyline[0]!)).toBe(false);
      expect(vertices(polyline[0]!)).toEqual(points.map(point => screen(point)));

      const live = paints(fake, 'stroke').filter(
        call => call.style.strokeStyle === PALETTE.guide && call.style.lineWidth === DRAFT_METRICS.preview.liveWidth,
      );
      expect(live).toHaveLength(1);
      expect(segmentOf(live[0]!)).toEqual([screen(points[2]!), screen(cursor)]);
    });

    it('making-rect: лента как у стен, живого сегмента нет, угол — хендл в покое', () => {
      const fake = render(emptyFrame({ tools: makingRect({ origin: SEGMENT[0]!, cursor: CURSOR, preview: BLOCKS }) }));
      const band = paints(fake, 'fill').filter(
        call => call.style.globalAlpha === DRAFT_METRICS.preview.bandAlpha && arcOf(call) === null,
      );
      expect(band).toHaveLength(1);
      expect(vertices(band[0]!)).toEqual(QUAD.map(point => screen(point)));
      expect(dashedWith(contourStrokes(fake), DRAFT_METRICS.preview.bandFaceDash)).toHaveLength(1);

      expect(
        paints(fake, 'stroke').filter(
          call => call.style.strokeStyle === PALETTE.guide && call.style.lineWidth === DRAFT_METRICS.preview.liveWidth,
        ),
      ).toHaveLength(0);
      expect(restHandles(fake)).toHaveLength(1);
      expect(centeredAt(restHandles(fake)[0]!, screen(SEGMENT[0]!))).toBe(true);
    });
  });

  describe('гайды снапа и крестик', () => {
    const CURSOR: PlanPosition = { x: 100, y: 100 };
    const AXIS: SnapGuide = { kind: 'axis-x', from: CURSOR, to: { x: 100, y: 250 }, face: null };
    const BISECTOR: SnapGuide = { kind: 'bisector', from: CURSOR, to: { x: 250, y: 250 }, face: null };
    const WITH_FACE: SnapGuide = { ...AXIS, face: { a: { x: 110, y: 100 }, b: { x: 110, y: 250 } } };

    const inFrame = (point: PlanPosition): boolean =>
      point.x >= 0 && point.x <= VIEWPORT.width && point.y >= 0 && point.y <= VIEWPORT.height;
    const guideStrokes = (fake: FakeContext): DrawCall[] =>
      dashedWith(paints(fake, 'stroke'), DRAFT_METRICS.snap.guideDash);

    it('гайд — 1px palette.guide пунктиром 4/3 и тянется через весь кадр, за пределы геометрии', () => {
      const fake = render(emptyFrame({ tools: makingWalls({ cursor: CURSOR, guides: [AXIS] }) }));
      const guides = guideStrokes(fake);
      expect(guides).toHaveLength(1);
      expect(guides[0]!.style.lineWidth).toBe(DRAFT_METRICS.snap.guideWidth);
      expect(guides[0]!.style.strokeStyle).toBe(PALETTE.guide);

      const [a, b] = segmentOf(guides[0]!);
      const source = length(screen(AXIS.from), screen(AXIS.to));
      expect(length(a, b)).toBeGreaterThan(source);
      expect(inFrame(a)).toBe(false);
      expect(inFrame(b)).toBe(false);
    });

    it('все ветки снапа одним стилем (решение 4): два гайда разных kind отличаются только количеством', () => {
      const one = guideStrokes(render(emptyFrame({ tools: makingWalls({ cursor: CURSOR, guides: [AXIS] }) })));
      const two = guideStrokes(
        render(emptyFrame({ tools: makingWalls({ cursor: CURSOR, guides: [AXIS, BISECTOR] }) })),
      );
      expect(one).toHaveLength(1);
      expect(two).toHaveLength(2);
      for (const call of two) {
        expect(call.style.strokeStyle).toBe(one[0]!.style.strokeStyle);
        expect(call.style.lineWidth).toBe(one[0]!.style.lineWidth);
        expect(call.style.lineDash).toEqual(one[0]!.style.lineDash);
      }
    });

    it('guide.face — дополнительный пунктир 3/3 цветом contourLine ровно по своему отрезку', () => {
      const fake = render(emptyFrame({ tools: makingWalls({ cursor: CURSOR, guides: [WITH_FACE] }) }));
      expect(guideStrokes(fake)).toHaveLength(1);
      const faces = dashedWith(paints(fake, 'stroke'), DRAFT_METRICS.snap.faceDash);
      expect(faces).toHaveLength(1);
      expect(faces[0]!.style.strokeStyle).toBe(PALETTE.contourLine);
      expect(faces[0]!.style.lineWidth).toBe(DRAFT_METRICS.snap.faceWidth);
      // Через весь кадр тянется только сам гайд: вторая грань рисуется как есть, `a → b`.
      expect(segmentOf(faces[0]!)).toEqual([screen(WITH_FACE.face!.a), screen(WITH_FACE.face!.b)]);
      const [guideFrom, guideTo] = segmentOf(guideStrokes(fake)[0]!);
      expect(length(...segmentOf(faces[0]!))).toBeLessThan(length(guideFrom, guideTo));
    });

    it('после гайдов пунктир сброшен', () => {
      const fake = render(emptyFrame({ tools: makingWalls({ cursor: null, guides: [WITH_FACE] }) }));
      expect(fake.lineDash).toEqual([]);
      expect(fake.ops[fake.ops.length - 1]!.op).toBe('setLineDash');
      expect(fake.ops[fake.ops.length - 1]!.args).toEqual([[]]);
    });

    it('крестик — две линии 1.2px palette.guide с плечом 6px в экранных координатах курсора', () => {
      const fake = render(emptyFrame({ tools: makingWalls({ cursor: CURSOR }) }));
      const cross = crossOf(fake);
      expect(cross).toHaveLength(2);
      const center = screen(CURSOR);
      const arm = DRAFT_METRICS.snap.crossArm;
      expect(segmentOf(cross[0]!)).toEqual([
        { x: center.x - arm, y: center.y },
        { x: center.x + arm, y: center.y },
      ]);
      expect(segmentOf(cross[1]!)).toEqual([
        { x: center.x, y: center.y - arm },
        { x: center.x, y: center.y + arm },
      ]);
      for (const line of cross) {
        expect(line.style.strokeStyle).toBe(PALETTE.guide);
        expect(line.style.lineDash).toEqual([]);
      }
    });

    it('в dragging-point крестик рисуется по pointOverrides[pointId]', () => {
      const dragged = { x: -50, y: -40 };
      const fake = render(frameOf({ tools: draggingPoint(PLAN.outer[0]!, dragged) }));
      const cross = crossOf(fake);
      expect(cross).toHaveLength(2);
      const center = screen(dragged);
      expect(segmentOf(cross[0]!)[0]).toEqual({ x: center.x - DRAFT_METRICS.snap.crossArm, y: center.y });
    });

    it('в editing и dragging-wall крестика нет', () => {
      expect(crossOf(render(frameOf({ tools: editing() })))).toHaveLength(0);
      expect(crossOf(render(frameOf({ tools: draggingWall() })))).toHaveLength(0);
    });

    it('«снап сработал, гайда нет» — ни одной пунктирной линии, только крестик', () => {
      const fake = render(emptyFrame({ tools: makingWalls({ cursor: CURSOR, guides: [] }) }));
      expect(paints(fake, 'stroke').filter(call => call.style.lineDash.length > 0)).toHaveLength(0);
      expect(crossOf(fake)).toHaveLength(2);
      expect(paints(fake, 'stroke')).toHaveLength(2);
    });
  });

  describe('pointOverrides (ADR 0020 P2)', () => {
    it('в dragging-point тело стены, грани и хендл рисуются в переопределённой координате', () => {
      const id = PLAN.outer[0]!;
      const dragged = { x: -50, y: -40 };
      const fake = render(frameOf({ tools: draggingPoint(id, dragged) }));
      const moved = screen(dragged);
      const documentPosition = screenOfPoint(id);

      const body = paints(fake, 'fill').find(call => call.style.fillStyle === PALETTE.wallBody)!;
      expect(vertices(body).some(point => near(point, moved))).toBe(true);

      const outer = contourStrokes(fake)[0]!;
      expect(vertices(outer).some(point => near(point, moved))).toBe(true);

      expect(circles(fake).some(call => arcOf(call)!.r === H.draggingHaloRadius && centeredAt(call, moved))).toBe(true);

      // Документной координаты в кадре нет вовсе.
      const drawn = drawCalls(fake).flatMap(call => {
        const arc = arcOf(call);
        return arc ? [{ x: arc.x, y: arc.y }, ...vertices(call)] : vertices(call);
      });
      expect(drawn.some(point => near(point, documentPosition))).toBe(false);
    });
  });

  describe('поведение при зуме (эталон, «Поведение при зуме»)', () => {
    const at = (scale: number): FakeContext =>
      render(
        frameOf({
          viewport: { ...VIEWPORT, scale },
          tools: draggingPoint(PLAN.outer[0]!, PLAN.layout.points[PLAN.outer[0]!]!, PLAN.outer[2]!),
        }),
      );

    const radii = (fake: FakeContext): number[] => [...new Set(circles(fake).map(call => arcOf(call)!.r))].sort();
    const widths = (fake: FakeContext): number[] =>
      [...new Set(paints(fake, 'stroke').map(call => call.style.lineWidth))].sort();
    const hatchStep = (fake: FakeContext): number => {
      const offsets = hatchOffsets(fake);
      return (offsets[1]! - offsets[0]!) / Math.SQRT2;
    };
    const spanX = (fake: FakeContext): number => {
      const points = vertices(contourStrokes(fake)[0]!).map(point => point.x);
      return Math.max(...points) - Math.min(...points);
    };

    it('радиусы хендлов, толщины линий и плечо крестика фиксированы в экранных px', () => {
      const base = at(1);
      const zoomed = at(4);
      expect(radii(zoomed)).toEqual(radii(base));
      expect(radii(base).length).toBeGreaterThan(1);
      expect(widths(zoomed)).toEqual(widths(base));
      const arm = (fake: FakeContext): number => {
        const [a, b] = segmentOf(crossOf(fake)[0]!);
        return b.x - a.x;
      };
      expect(arm(zoomed)).toBe(arm(base));
      expect(arm(base)).toBe(DRAFT_METRICS.snap.crossArm * 2);
    });

    it('шаг штриховки и экранный размер геометрии едут с планом пропорционально', () => {
      const base = at(1);
      const zoomed = at(4);
      expect(hatchStep(zoomed)).toBeCloseTo(hatchStep(base) * 4, 9);
      expect(spanX(zoomed)).toBeCloseTo(spanX(base) * 4, 9);
    });
  });

  describe('стилевой стек фейкового контекста', () => {
    it('restore возвращает стили, выставленные внутри save (иначе проверка клипа штриховки соврала бы)', () => {
      const fake = render(frameOf());
      const save = fake.ops.findIndex(op => op.op === 'save');
      const restore = fake.ops.findIndex(op => op.op === 'restore');
      const before = fake.ops[save]!.style;
      const after = fake.ops[restore]!.style;
      expect(hatchOf(fake)[0]!.style.strokeStyle).toBe(PALETTE.roomHatch);
      expect(after.strokeStyle).toBe(before.strokeStyle);
      expect(after.lineWidth).toBe(before.lineWidth);
    });

    it('кадр начинается со сброса globalAlpha и пунктира — грязное состояние контекста не протекает', () => {
      // Контекст живёт между кадрами: заранее пачкаем его значениями, которых после сброса быть не должно.
      const fake = createFakeContext();
      fake.globalAlpha = 0.37;
      fake.lineDash = [9, 9];
      drawFrame(fake as unknown as CanvasRenderingContext2D, frameOf());

      const first = stylesOf(fake, 'setTransform')[0]!;
      expect(first.globalAlpha).toBe(0.37);
      // Первый рисующий вызов кадра — заливка фона: к нему состояние уже сброшено.
      const background = paints(fake, 'fillRect')[0]!;
      expect(background.style.globalAlpha).toBe(1);
      expect(background.style.lineDash).toEqual([]);
    });
  });
});
