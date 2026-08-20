import type { WallBlock } from '../../document/geometry/band/blocksFromContour';
import { DEFAULT_WALL_WIDTH } from '../../document/geometry/band/blocksFromContour';
import { CLOSE_EPS, contourClosure } from '../../document/geometry/contours/contourClosure';
import { POLYLINE_ROOM_MIN_POINTS } from '../../document/geometry/contours/validateContour';
import { euclDist, manhDist } from '../../document/geometry/predicates/distance';
import type { SnapGuide } from '../../document/geometry/snap/guidesFor';
import { planToView, type Viewport } from '../../document/geometry/viewport';
import type { Id } from '../../document/id';
import type { FloorLayout, PlanPosition } from '../../document/PlannerDocument';
import type { DerivedFloor, DerivedRoom } from '../../engine/rebuild';
import type { HitTarget } from '../../document/geometry/hittest/hitTest';
import type { ToolState } from '../../engine/tools/ToolState';
import { DRAFT_METRICS, type DraftPalette } from './draftStyle';

/**
 * Один кадр конструктора: **полная перерисовка по запросу** (ADR 0020 P2), слои снизу вверх —
 * комнаты (заливка/штриховка) → тела стен → грани контуров → хендлы точек → превью рисования → гайды/крест.
 * Все числа и цвета — `draftStyle.ts` (эталон холста `docs/ui/handoffs/planner/planner-canvas-reference.md`).
 *
 * Рисуется всё в **экранных CSS-пикселях**: план переводится через `planToView`, поэтому толщины линий, радиусы
 * хендлов и плечо крестика фиксированы на экране, а всё, что задано в плане (тела стен, заливки, шаг штриховки),
 * едет с зумом само (эталон, «Поведение при зуме»).
 *
 * Позиция любой точки — `pointOverrides[id] ?? layout.points[id]` (ADR 0020 P2): live-драг рисуется без
 * ретриангуляции, треугольники и обводы держат id точек.
 *
 * **Не рисует** (ADR 0020 P2): подписи длин, поля ввода и подписи комнат — DOM-оверлей (0060); сетки нет вовсе
 * (решение 1); мебель и растровая подложка — шаги 5+/P2.
 */

/** Всё, что нужно кадру. Функция чистая относительно контекста — тестируется на фейковом `ctx` (ADR 0020 P7). */
export interface DraftFrame {
  layout: FloorLayout;
  derived: DerivedFloor | null;
  tools: ToolState;
  viewport: Viewport;
  palette: DraftPalette;
  /** Плотность пикселей: буфер = CSS × DPR, трансформация ставится один раз на кадр. */
  devicePixelRatio: number;
}

/**
 * Ниже этого экранного шага штриховка сливается в сплошную заливку и стоит тысячи `stroke` на комнату —
 * на мелких шагах шкалы (0.05×) её просто не рисуем. Инженерный порог, эталон его не задаёт (см. Заметки 0056).
 */
const HATCH_MIN_STEP_PX = 2;

type Ctx = CanvasRenderingContext2D;

const point = (viewport: Viewport, position: PlanPosition): PlanPosition => planToView(viewport, position);

/** Позиция точки документа с учётом live-драга. */
const positionOf = (
  layout: FloorLayout,
  overrides: Readonly<Record<Id, PlanPosition>> | null,
  id: Id,
): PlanPosition | null => overrides?.[id] ?? layout.points[id] ?? null;

const overridesOf = (tools: ToolState): Readonly<Record<Id, PlanPosition>> | null =>
  tools.kind === 'dragging-point' || tools.kind === 'dragging-wall' ? tools.pointOverrides : null;

/** Кольцо точек по id — `null`, если хотя бы одна точка пропала (документ и производное разъехались). */
const ring = (
  frame: DraftFrame,
  overrides: Readonly<Record<Id, PlanPosition>> | null,
  ids: readonly Id[],
): PlanPosition[] | null => {
  const result: PlanPosition[] = [];
  for (const id of ids) {
    const position = positionOf(frame.layout, overrides, id);
    if (!position) return null;
    result.push(point(frame.viewport, position));
  }
  return result;
};

const tracePolygon = (ctx: Ctx, points: readonly PlanPosition[]): void => {
  const [first, ...rest] = points;
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (const next of rest) ctx.lineTo(next.x, next.y);
  ctx.closePath();
};

const strokePolyline = (ctx: Ctx, points: readonly PlanPosition[], closed: boolean): void => {
  const [first, ...rest] = points;
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const next of rest) ctx.lineTo(next.x, next.y);
  if (closed) ctx.closePath();
  ctx.stroke();
};

const strokeSegment = (ctx: Ctx, a: PlanPosition, b: PlanPosition): void => {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
};

const fillCircle = (ctx: Ctx, center: PlanPosition, radius: number): void => {
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();
};

const strokeCircle = (ctx: Ctx, center: PlanPosition, radius: number, width: number): void => {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.stroke();
};

const withAlpha = (ctx: Ctx, alpha: number, draw: () => void): void => {
  const previous = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  draw();
  ctx.globalAlpha = previous;
};

// ── Слой 0. Фон ─────────────────────────────────────────────────────────────────────────────────────────────

/** Сплошной `--draft-canvas`. **Сетки нет** (решение 1) — слоя сетки в проекции не существует. */
const drawBackground = ({ palette, viewport }: DraftFrame, ctx: Ctx): void => {
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
};

// ── Слой 1. Комнаты: заливка, штриховка, hover/выделение ────────────────────────────────────────────────────

/** Экранные кольца комнаты: обвод и дырки; `null` — точка пропала (документ и производное разъехались). */
const roomRings = (
  frame: DraftFrame,
  overrides: Readonly<Record<Id, PlanPosition>> | null,
  room: DerivedRoom,
): PlanPosition[][] | null => {
  const outline = ring(frame, overrides, room.outline);
  if (!outline) return null;
  const rings = [outline];
  for (const hole of room.holes) {
    const holeRing = ring(frame, overrides, hole);
    if (holeRing) rings.push(holeRing);
  }
  return rings;
};

const traceRings = (ctx: Ctx, rings: readonly PlanPosition[][]): void => {
  ctx.beginPath();
  for (const contour of rings) tracePolygon(ctx, contour);
};

const boundsOf = (points: readonly PlanPosition[]): { minX: number; minY: number; maxX: number; maxY: number } => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
};

/**
 * Штриховка: линии 1px `--draft-room-hatch`, шаг 8px при `1,0×` (едет с планом), наклон 45°.
 * `step` — расстояние **по нормали** к линиям, как у паттерна 8×8 с `rotate(45)`; по горизонтали соседние
 * линии отстоят на `step · √2`. Рисуется одним путём в пределах экранного bbox комнаты, обрезанного кадром:
 * штриховка идёт на каждый кадр, а кадр — на каждое движение мыши.
 */
const drawHatch = (frame: DraftFrame, ctx: Ctx, outline: readonly PlanPosition[]): void => {
  const { viewport, palette } = frame;
  const step = DRAFT_METRICS.plan.hatchStep * viewport.scale;
  if (!(step >= HATCH_MIN_STEP_PX)) return;

  const box = boundsOf(outline);
  const left = Math.max(0, box.minX);
  const right = Math.min(viewport.width, box.maxX);
  const top = Math.max(0, box.minY);
  const bottom = Math.min(viewport.height, box.maxY);
  if (!(right > left && bottom > top)) return;

  // Линии направления (1, 1) — экранный «вниз-вправо», то есть наклон 45°; семейство параметризуем точкой
  // пересечения с осью `y = 0`, поэтому диапазон смещений — от `left − bottom` до `right − top`.
  const shift = step * Math.SQRT2;
  // Фаза привязана к началу координат плана, иначе при пане штриховка стояла бы на месте, а комната уезжала:
  // эталон относит штриховку к тому, что «масштабируется вместе с планом».
  const origin = point(viewport, { x: 0, y: 0 });
  const phase = (((origin.x - origin.y) % shift) + shift) % shift;
  const first = phase + Math.floor((left - bottom - phase) / shift) * shift;

  ctx.strokeStyle = palette.roomHatch;
  ctx.lineWidth = DRAFT_METRICS.room.hatchWidth;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let offset = first; offset <= right - top; offset += shift) {
    ctx.moveTo(offset + top, top);
    ctx.lineTo(offset + bottom, bottom);
  }
  ctx.stroke();
};

const drawRooms = (frame: DraftFrame, ctx: Ctx, hover: HitTarget | null, selection: HitTarget | null): void => {
  const { derived, palette } = frame;
  if (!derived) return;
  const overrides = overridesOf(frame.tools);

  for (const room of derived.rooms) {
    const rings = roomRings(frame, overrides, room);
    if (!rings) continue;
    traceRings(ctx, rings);
    ctx.fillStyle = palette.roomFill;
    ctx.fill('evenodd');

    ctx.save();
    ctx.clip('evenodd');
    drawHatch(frame, ctx, rings[0] as PlanPosition[]);
    ctx.restore();

    const hovered = hover?.kind === 'room' && hover.roomId === room.roomId;
    const selected = selection?.kind === 'room' && selection.roomId === room.roomId;
    if (!hovered && !selected) continue;

    traceRings(ctx, rings);
    ctx.fillStyle = palette.guide;
    // Выделение сильнее наведения: одновременно они не складываются, побеждает выделение.
    withAlpha(ctx, selected ? DRAFT_METRICS.room.selectedAlpha : DRAFT_METRICS.room.hoverAlpha, () =>
      ctx.fill('evenodd'),
    );
    if (!selected) continue;
    ctx.strokeStyle = palette.guide;
    ctx.lineWidth = DRAFT_METRICS.room.selectedRingWidth;
    ctx.setLineDash([]);
    ctx.stroke();
  }
};

// ── Слой 2. Тела стен ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Тело стены — треугольники fill-групп (`DerivedFloor.walls[].triangles`, ADR 0017 C1), а не лента: полость
 * комнаты вычтена самой триангуляцией, отдельного even-odd не нужно. Все треугольники — один путь и одна
 * заливка: иначе на общих рёбрах остаются волосяные швы от сглаживания.
 */
const drawWalls = (frame: DraftFrame, ctx: Ctx): void => {
  const { derived, palette } = frame;
  if (!derived) return;
  const overrides = overridesOf(frame.tools);

  ctx.beginPath();
  for (const wall of derived.walls) {
    for (const triangle of wall.triangles) {
      const corners = ring(frame, overrides, triangle);
      if (corners) tracePolygon(ctx, corners);
    }
  }
  ctx.fillStyle = palette.wallBody;
  ctx.fill();
};

// ── Слой 3. Грани контуров, hover и выделение стороны ───────────────────────────────────────────────────────

/** Сторона контура: линия 1.4px `--draft-contour-line`, стыки без скругления. */
const drawContours = (frame: DraftFrame, ctx: Ctx, hover: HitTarget | null, selection: HitTarget | null): void => {
  const { layout, palette } = frame;
  const overrides = overridesOf(frame.tools);

  ctx.strokeStyle = palette.contourLine;
  ctx.lineWidth = DRAFT_METRICS.face.width;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  for (const contour of layout.contours) {
    const points = ring(frame, overrides, contour.points);
    if (points) strokePolyline(ctx, points, true);
  }

  ctx.strokeStyle = palette.guide;
  for (const [target, width] of [
    [hover, DRAFT_METRICS.face.hoverWidth],
    [selection, DRAFT_METRICS.face.selectedWidth],
  ] as const) {
    if (target?.kind !== 'wall') continue;
    const a = positionOf(layout, overrides, target.face.a);
    const b = positionOf(layout, overrides, target.face.b);
    if (!a || !b) continue;
    ctx.lineWidth = width;
    strokeSegment(ctx, point(frame.viewport, a), point(frame.viewport, b));
  }
};

// ── Слой 4. Хендлы точек ────────────────────────────────────────────────────────────────────────────────────

/** Шесть состояний хендла из эталона холста; порядок приоритета — драг > выделение > наведение > покой. */
type HandleState = 'rest' | 'hover' | 'selected' | 'dragging' | 'close' | 'finish';

const drawHandle = (frame: DraftFrame, ctx: Ctx, center: PlanPosition, state: HandleState): void => {
  const { palette } = frame;
  const h = DRAFT_METRICS.handle;
  ctx.setLineDash([]);

  switch (state) {
    case 'rest':
      ctx.fillStyle = palette.canvas;
      ctx.strokeStyle = palette.point;
      fillCircle(ctx, center, h.radius);
      strokeCircle(ctx, center, h.radius, h.strokeWidth);
      return;

    case 'hover':
      ctx.fillStyle = palette.guide;
      withAlpha(ctx, h.hoverHaloAlpha, () => fillCircle(ctx, center, h.hoverHaloRadius));
      ctx.fillStyle = palette.canvas;
      ctx.strokeStyle = palette.guide;
      fillCircle(ctx, center, h.radius);
      strokeCircle(ctx, center, h.radius, h.hoverStrokeWidth);
      return;

    case 'selected':
      ctx.fillStyle = palette.guide;
      fillCircle(ctx, center, h.selectedRadius);
      ctx.fillStyle = palette.canvas;
      fillCircle(ctx, center, h.selectedCoreRadius);
      return;

    case 'dragging':
      ctx.fillStyle = palette.guide;
      withAlpha(ctx, h.draggingHaloAlpha, () => fillCircle(ctx, center, h.draggingHaloRadius));
      fillCircle(ctx, center, h.radius);
      return;

    case 'close':
      ctx.fillStyle = palette.guide;
      ctx.strokeStyle = palette.guide;
      fillCircle(ctx, center, h.radius);
      strokeCircle(ctx, center, h.closeRingRadius, h.closeRingWidth);
      return;

    case 'finish': {
      const half = h.finishFrameSize / 2;
      ctx.strokeStyle = palette.guide;
      ctx.lineWidth = h.finishFrameWidth;
      ctx.beginPath();
      ctx.roundRect(center.x - half, center.y - half, h.finishFrameSize, h.finishFrameSize, h.finishFrameRadius);
      ctx.stroke();
      ctx.fillStyle = palette.canvas;
      ctx.strokeStyle = palette.guide;
      fillCircle(ctx, center, h.radius);
      strokeCircle(ctx, center, h.radius, h.finishStrokeWidth);
      return;
    }
  }
};

const handleStateOf = (tools: ToolState, id: Id, hover: HitTarget | null, selection: HitTarget | null): HandleState => {
  if (tools.kind === 'dragging-point' && tools.pointId === id) return 'dragging';
  if (selection?.kind === 'point' && selection.id === id) return 'selected';
  if (hover?.kind === 'point' && hover.id === id) return 'hover';
  return 'rest';
};

const drawPointHandles = (frame: DraftFrame, ctx: Ctx, hover: HitTarget | null, selection: HitTarget | null): void => {
  const overrides = overridesOf(frame.tools);
  for (const id of Object.keys(frame.layout.points)) {
    const position = positionOf(frame.layout, overrides, id);
    if (!position) continue;
    drawHandle(frame, ctx, point(frame.viewport, position), handleStateOf(frame.tools, id, hover, selection));
  }
};

// ── Слой 5. Превью рисования ────────────────────────────────────────────────────────────────────────────────

/**
 * Превью ленты: заливка `--accent` 12%, вторая грань — пунктир 3/3 `--draft-contour-line`.
 * Квад `[A, C, D, B]`: `A→C` — грань офсета (пунктир), `B→D` — сама нарисованная линия (сплошная сторона).
 */
const drawBandPreview = (frame: DraftFrame, ctx: Ctx, blocks: readonly WallBlock[]): void => {
  if (blocks.length === 0) return;
  const { viewport, palette } = frame;
  const quads = blocks.map(block => block.map(p => point(viewport, p)));

  ctx.beginPath();
  for (const quad of quads) tracePolygon(ctx, quad);
  ctx.fillStyle = palette.guide;
  withAlpha(ctx, DRAFT_METRICS.preview.bandAlpha, () => ctx.fill());

  ctx.strokeStyle = palette.contourLine;
  ctx.lineWidth = DRAFT_METRICS.face.width;
  ctx.setLineDash([]);
  for (const quad of quads) strokeSegment(ctx, quad[3] as PlanPosition, quad[2] as PlanPosition);

  ctx.lineWidth = DRAFT_METRICS.preview.bandFaceWidth;
  ctx.setLineDash([...DRAFT_METRICS.preview.bandFaceDash]);
  for (const quad of quads) strokeSegment(ctx, quad[0] as PlanPosition, quad[1] as PlanPosition);
  ctx.setLineDash([]);
};

/** Живой сегмент к курсору: линия 1.4px `--accent`, сплошная. */
const drawLiveSegment = (frame: DraftFrame, ctx: Ctx, from: PlanPosition, to: PlanPosition): void => {
  ctx.strokeStyle = frame.palette.guide;
  ctx.lineWidth = DRAFT_METRICS.preview.liveWidth;
  ctx.setLineDash([]);
  strokeSegment(ctx, point(frame.viewport, from), point(frame.viewport, to));
};

/**
 * Цель будущего завершения (решение 2): «замкнуть контур» — курсор у первой точки, «завершить открытую стену» —
 * у последней. В `ToolState` этого различия нет и добавлять его не потребовалось: оно выводится тем же чистым
 * предикатом `contourClosure`, которым его считает сам автомат в момент постановки точки (те же радиусы и та же
 * метрика — иначе подсветка обещала бы не то, что произойдёт по клику).
 */
const closureTarget = (tools: ToolState): { index: number; state: HandleState } | null => {
  if (tools.kind === 'making-walls') {
    if (!tools.cursor || tools.points.length === 0) return null;
    const closure = contourClosure(tools.cursor, tools.points, {
      lastRadius: DEFAULT_WALL_WIDTH,
      distance: euclDist,
    });
    if (!closure) return null;
    // «Стены» замыкают петлю у первой точки и коммитят открытую полилинию у последней (ADR 0019 E3) —
    // отсюда две разные цели.
    return closure === 'first' ? { index: 0, state: 'close' } : { index: tools.points.length - 1, state: 'finish' };
  }
  if (tools.kind === 'making-room') {
    if (!tools.cursor || tools.points.length < POLYLINE_ROOM_MIN_POINTS) return null;
    const closure = contourClosure(tools.cursor, tools.points, { lastRadius: CLOSE_EPS, distance: manhDist });
    if (!closure) return null;
    // У «Комнаты по точкам» открытого исхода нет: клик и в первую, и в последнюю вершину замыкает контур
    // (`makingRoom.finish` всегда коммитит `closed`), поэтому обе цели — «замкнуть контур».
    return { index: closure === 'first' ? 0 : tools.points.length - 1, state: 'close' };
  }
  return null;
};

/** Поставленные, не закоммиченные точки — как хендл в покое; цель замыкания/завершения — своим состоянием. */
const drawDraftPoints = (frame: DraftFrame, ctx: Ctx, points: readonly PlanPosition[]): void => {
  const target = closureTarget(frame.tools);
  points.forEach((position, index) => {
    const state = target !== null && target.index === index ? target.state : 'rest';
    drawHandle(frame, ctx, point(frame.viewport, position), state);
  });
};

const drawPreview = (frame: DraftFrame, ctx: Ctx): void => {
  const { tools } = frame;
  switch (tools.kind) {
    case 'making-walls': {
      drawBandPreview(frame, ctx, tools.preview);
      const last = tools.points[tools.points.length - 1];
      if (last && tools.cursor) drawLiveSegment(frame, ctx, last, tools.cursor);
      drawDraftPoints(frame, ctx, tools.points);
      return;
    }
    case 'making-rect':
      drawBandPreview(frame, ctx, tools.preview);
      if (tools.origin) drawDraftPoints(frame, ctx, [tools.origin]);
      return;
    case 'making-room': {
      // Комната по точкам — контур без толщины: ленты нет, рисуется сам полигон (спека 01 «Polyline Room»).
      const placed = tools.points.map(p => point(frame.viewport, p));
      if (placed.length > 1) {
        ctx.strokeStyle = frame.palette.contourLine;
        ctx.lineWidth = DRAFT_METRICS.face.width;
        ctx.setLineDash([]);
        strokePolyline(ctx, placed, false);
      }
      const last = tools.points[tools.points.length - 1];
      if (last && tools.cursor) drawLiveSegment(frame, ctx, last, tools.cursor);
      drawDraftPoints(frame, ctx, tools.points);
      return;
    }
    default:
      return;
  }
};

// ── Слой 6. Гайды снапа и крестик ───────────────────────────────────────────────────────────────────────────

/**
 * Гайд идёт **через весь кадр**, за пределы геометрии (эталон, «Почему гайд не путается с выделением»;
 * сцены 2 и 7). `guidesFor` отдаёт отрезок «снап-точка → источник» — он задаёт прямую, а рисуется её
 * пересечение с кадром.
 */
const extendToFrame = (viewport: Viewport, a: PlanPosition, b: PlanPosition): [PlanPosition, PlanPosition] => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return [a, b];
  const reach = viewport.width + viewport.height;
  const ux = (dx / length) * reach;
  const uy = (dy / length) * reach;
  return [
    { x: a.x - ux, y: a.y - uy },
    { x: a.x + ux, y: a.y + uy },
  ];
};

/** Все семь веток снапа — одним стилем (решение 4): отличается только количество гайдов на экране. */
const drawGuides = (frame: DraftFrame, ctx: Ctx, guides: readonly SnapGuide[]): void => {
  const { viewport, palette } = frame;
  for (const guide of guides) {
    const [from, to] = extendToFrame(viewport, point(viewport, guide.from), point(viewport, guide.to));
    ctx.strokeStyle = palette.guide;
    ctx.lineWidth = DRAFT_METRICS.snap.guideWidth;
    ctx.setLineDash([...DRAFT_METRICS.snap.guideDash]);
    strokeSegment(ctx, from, to);

    if (!guide.face) continue;
    // Параллельный пунктир второй грани рисуется **как есть**: «через весь кадр» эталон обещает только
    // самому гайду снапа, у второй грани длина не оговорена (см. Заметки 0056).
    ctx.strokeStyle = palette.contourLine;
    ctx.lineWidth = DRAFT_METRICS.snap.faceWidth;
    ctx.setLineDash([...DRAFT_METRICS.snap.faceDash]);
    strokeSegment(ctx, point(viewport, guide.face.a), point(viewport, guide.face.b));
  }
  ctx.setLineDash([]);
};

/** Крестик курсора: две линии 1.2px `--draft-guide`, плечо 6px. Рисуется поверх курсора и его не заменяет. */
const drawCrosshair = (frame: DraftFrame, ctx: Ctx, position: PlanPosition): void => {
  const center = point(frame.viewport, position);
  const arm = DRAFT_METRICS.snap.crossArm;
  ctx.strokeStyle = frame.palette.guide;
  ctx.lineWidth = DRAFT_METRICS.snap.crossWidth;
  ctx.setLineDash([]);
  strokeSegment(ctx, { x: center.x - arm, y: center.y }, { x: center.x + arm, y: center.y });
  strokeSegment(ctx, { x: center.x, y: center.y - arm }, { x: center.x, y: center.y + arm });
};

/**
 * Живой снапнутый курсор: он же якорь крестика. У `dragging-wall` гайдов нет по построению (ADR 0019 E4),
 * крестик там тоже не рисуется — конец стены едет по нормали, а не за курсором.
 */
const cursorOf = (tools: ToolState): PlanPosition | null => {
  switch (tools.kind) {
    case 'making-walls':
    case 'making-rect':
    case 'making-room':
      return tools.cursor;
    case 'dragging-point':
      return tools.pointOverrides[tools.pointId] ?? null;
    default:
      return null;
  }
};

const guidesOf = (tools: ToolState): readonly SnapGuide[] => {
  switch (tools.kind) {
    case 'making-walls':
    case 'making-rect':
    case 'making-room':
    case 'dragging-point':
      return tools.guides;
    default:
      return [];
  }
};

// ── Кадр ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Наведение и выделение конструктора живут в `ToolState`; в жестах выделение переносится тем же `HitTarget`. */
const hoverOf = (tools: ToolState): HitTarget | null => (tools.kind === 'editing' ? tools.hover : null);

const selectionOf = (tools: ToolState): HitTarget | null => {
  switch (tools.kind) {
    case 'editing':
      return tools.selection;
    case 'dragging-point':
    case 'dragging-wall':
      return tools.selection;
    default:
      return null;
  }
};

/** Полная перерисовка кадра. Вызывается только из `RenderLoop` активной проекции (ADR 0020 P5). */
export const drawFrame = (ctx: Ctx, frame: DraftFrame): void => {
  const { devicePixelRatio } = frame;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  drawBackground(frame, ctx);
  if (frame.viewport.width <= 0 || frame.viewport.height <= 0) return;

  const hover = hoverOf(frame.tools);
  const selection = selectionOf(frame.tools);

  drawRooms(frame, ctx, hover, selection);
  drawWalls(frame, ctx);
  drawContours(frame, ctx, hover, selection);
  drawPointHandles(frame, ctx, hover, selection);
  drawPreview(frame, ctx);
  drawGuides(frame, ctx, guidesOf(frame.tools));

  const cursor = cursorOf(frame.tools);
  if (cursor) drawCrosshair(frame, ctx, cursor);
};
