import { autoOffsetSide } from '../../document/geometry/band/autoOffsetSide';
import {
  blocksFromContour,
  DEFAULT_WALL_WIDTH,
  type StartNeighbourSegments,
} from '../../document/geometry/band/blocksFromContour';
import { contourClosure } from '../../document/geometry/contours/contourClosure';
import { MIN_CONTOUR_POINTS, MIN_WALL_LENGTH, validateContour } from '../../document/geometry/contours/validateContour';
import { dedupeConsecutivePoints } from '../../document/geometry/predicates/dedupeConsecutivePoints';
import { euclDist } from '../../document/geometry/predicates/distance';
import type { OffsetSide } from '../../document/geometry/predicates/offsetPoint';
import { pointsMatch } from '../../document/geometry/predicates/pointsMatch';
import { findNearSegments } from '../../document/geometry/snap/findNearSegments';
import type { PlanPosition } from '../../document/PlannerDocument';
import { quantize } from '../../document/quantize';
import type { ContourInput } from '../commands/addContours';
import { drawingGuides, sameCursorFrame, samePosition, snapCursor } from './drawingSnap';
import type { PlaceStep, Step, ToolContext, ToolHandler } from './ToolHandler';
import { createEditingState, type MakingWallsState, type PointerInput } from './ToolState';

/** Минимум точек открытой полилинии стен — один сегмент. */
const OPEN_MIN_POINTS = 2;

/** Сторона ленты замораживается после третьей точки (спека 01 «Ограничения и пороги»). */
const SIDE_FIX_POINTS = 3;

/** Сторона ленты по умолчанию — левая нормаль (`signSide = 1` референса; верифицировано, задача 0052). */
const DEFAULT_SIDE: OffsetSide = 'left';

/** Стабильная часть состояния между движениями курсора: то, что меняют только клики и локальные undo/redo. */
interface WallsCore {
  points: readonly PlanPosition[];
  side: OffsetSide;
  startNeighbours: StartNeighbourSegments | null;
  undo: readonly (readonly PlanPosition[])[];
  redo: readonly (readonly PlanPosition[])[];
}

const coreOf = ({ points, side, startNeighbours, undo, redo }: MakingWallsState): WallsCore => ({
  points,
  side,
  startNeighbours,
  undo,
  redo,
});

const isSideFixed = (points: readonly PlanPosition[]): boolean => points.length >= SIDE_FIX_POINTS;

/**
 * Автовыбор стороны (спека 01 «Polyline Walls», как `calcStart` референса): только при старте от чужой стены и до
 * третьей точки; вторая точка — зафиксированная либо живой курсор; ребро короче `SIDE_PICK_MIN_EDGE` сторону не
 * меняет; после третьей точки — заморожена.
 */
const pickSide = (core: WallsCore, cursor: PlanPosition | null): OffsetSide => {
  const first = core.points[0];
  const second = core.points[1] ?? cursor;
  if (isSideFixed(core.points) || !core.startNeighbours || !first || !second) return core.side;
  return autoOffsetSide(first, second, core.startNeighbours) ?? core.side;
};

/**
 * Полное состояние из стабильной части и последнего ввода указателя: снап → живой курсор → сторона → превью ленты
 * по `points + cursor` → гайды. Без ввода указателя (точки могли прийти из `commitPoint`) — превью только по
 * зафиксированным точкам, снапа и гайдов нет.
 */
const frame = (core: WallsCore, pointer: PointerInput | null, ctx: ToolContext): MakingWallsState => {
  const { points } = core;
  const base = { kind: 'making-walls' as const, ...core, sideFixed: isSideFixed(points) };
  const band = (contour: readonly PlanPosition[], side: OffsetSide) =>
    blocksFromContour(contour, DEFAULT_WALL_WIDTH, side, false, core.startNeighbours ?? undefined);
  if (pointer === null) {
    const side = pickSide(core, null);
    return { ...base, side, cursor: null, preview: band(points, side), snap: null, guides: [] };
  }

  const snap = snapCursor(points, pointer, ctx);
  const cursor = snap.snapped;
  const last = points[points.length - 1] ?? null;
  const side = pickSide(core, cursor);
  const preview = points.length > 0 ? band([...points, cursor], side) : [];
  const guides = drawingGuides(snap, ctx, { lastPoint: last, face: last ? { width: DEFAULT_WALL_WIDTH, side } : null });
  return { ...base, side, cursor, preview, snap, guides };
};

const sameNeighbours = (a: StartNeighbourSegments | null, b: StartNeighbourSegments | null): boolean =>
  a === b || (a !== null && b !== null && samePosition(a[0], b[0]) && samePosition(a[1], b[1]));

/**
 * Совпадают ли два кадра по значению — фильтр no-op для `tools:changed`: дубль `pointerMove`, пересчёт после смены
 * окружения без последствий. Превью — функция точек/курсора/стороны/соседей старта, отдельно не сравнивается.
 */
const sameFrame = (a: MakingWallsState, b: MakingWallsState): boolean =>
  a.points === b.points &&
  a.side === b.side &&
  sameNeighbours(a.startNeighbours, b.startNeighbours) &&
  a.undo === b.undo &&
  a.redo === b.redo &&
  sameCursorFrame(a, b);

const reframe = (state: MakingWallsState, core: WallsCore, pointer: PointerInput | null, ctx: ToolContext): Step => {
  const next = frame(core, pointer, ctx);
  return { state: sameFrame(state, next) ? state : next };
};

/** Старт инструмента: пустой контур, курсор — из последнего известного ввода (если был). */
export const startMakingWalls = (ctx: ToolContext): MakingWallsState =>
  frame({ points: [], side: DEFAULT_SIDE, startNeighbours: null, undo: [], redo: [] }, ctx.pointer, ctx);

/**
 * Завершение рисования (ADR 0019 E3; спека 01 «Как завершить», «Крайние случаи»): валидация (порядок
 * `validateContour`) → квады ленты → `document.addContours` N `outer`-квадов одной транзакцией → `editing`. Отказы
 * молчаливые: `logger.debug` с причиной, документ не тронут, автомат — в `editing`. Команда зовётся отложенно
 * (после перехода), чтобы `document:changed` застал автомат уже вне рисования.
 */
const finish = (state: MakingWallsState, closed: boolean, ctx: ToolContext): Step => {
  const editing = createEditingState();
  const reject = (reason: string, details?: unknown): Step => {
    ctx.logger.debug(`@uyutno/planner: walls contour rejected: ${reason}`, details);
    return { state: editing };
  };
  const { floorId } = ctx;
  if (floorId === null) return reject('no-active-floor');
  const points = dedupeConsecutivePoints(state.points, closed);
  const validation = validateContour(points, { closed, minPoints: closed ? MIN_CONTOUR_POINTS : OPEN_MIN_POINTS });
  if (!validation.ok) return reject(validation.reason, { closed, points: points.length });
  const blocks = blocksFromContour(points, DEFAULT_WALL_WIDTH, state.side, closed, state.startNeighbours ?? undefined);
  if (blocks.length === 0) return reject('empty-band', { closed, points: points.length });
  const contours: ContourInput[] = blocks.map(block => ({
    kind: 'outer',
    points: block.map(p => ({ x: p.x, y: p.y })),
  }));
  return {
    state: editing,
    effect: () => {
      // После `validateContour` команда штатно не отказывает; ветка — страховка на расхождение проверок.
      const result = ctx.addContours(floorId, contours);
      if (!result.ok) ctx.logger.debug('@uyutno/planner: walls contour rejected by addContours', result.error);
    },
  };
};

const ignore = (
  state: MakingWallsState,
  rejected: NonNullable<PlaceStep['rejected']>,
  point: PlanPosition,
  ctx: ToolContext,
): PlaceStep => {
  ctx.logger.debug(`@uyutno/planner: walls point ignored: ${rejected}`, point);
  return { state, rejected };
};

/**
 * Постановка точки — общий путь клика (`snap.snapped`) и Enter в инпуте длины (`commitPoint`, без снапа; Q27):
 * замыкание по `contourClosure` (евклид: ≤ толщины к последней → открытая лента, ≤ `CLOSE_EPS` к первой от трёх
 * точек → петля) → иначе новая точка. Гард входа (спека 01 «Ограничения»: минимальная длина стены 15 см): точка,
 * дающая ребро короче `MIN_WALL_LENGTH` (в т.ч. замыкающее ребро петли), или совпавшая с уже поставленной, —
 * молчаливо игнорируется (`rejected` — для инпута длины), иначе весь контур отбросила бы валидация на завершении;
 * зона `width < d < MIN_WALL_LENGTH` у последней точки — тоже игнор (не замыкание). При двух точках клик в первую —
 * дубль, а не петля (петля от трёх точек; референс завершал бы рисование). Самопересечение и вырожденность —
 * только на завершении (спека 01 «Крайние случаи»). Первая точка запоминает соседей на существующей стене
 * (T-стык, `findNearSegments`).
 */
const place = (state: MakingWallsState, raw: PlanPosition, ctx: ToolContext): PlaceStep => {
  const point = { x: quantize(raw.x), y: quantize(raw.y) };
  const { points } = state;
  const closure =
    points.length === 0 ? null : contourClosure(point, points, { lastRadius: DEFAULT_WALL_WIDTH, distance: euclDist });
  if (closure === 'first') {
    const validation = validateContour(dedupeConsecutivePoints(points, true), { closed: true });
    if (!validation.ok && validation.reason === 'shortEdge') return ignore(state, 'too-short', point, ctx);
    if (!validation.ok && validation.reason === 'duplicatePoints') return ignore(state, 'duplicate-point', point, ctx);
  }
  if (closure !== null) return finish(state, closure === 'first', ctx);

  const last = points[points.length - 1];
  if (last && euclDist(last, point) < MIN_WALL_LENGTH) return ignore(state, 'too-short', point, ctx);
  if (points.some(fixed => pointsMatch(fixed, point))) return ignore(state, 'duplicate-point', point, ctx);

  const startNeighbours =
    points.length === 0 ? findNearSegments(point, ctx.snapIndex().segments) : state.startNeighbours;
  const core: WallsCore = {
    points: [...points, point],
    side: state.side,
    startNeighbours,
    undo: [...state.undo, points],
    redo: [],
  };
  return { state: frame(core, ctx.pointer, ctx) };
};

/**
 * Ctrl+Z: снять последнюю поставленную точку (снимок из локального стека); дошли до пустого холста → `editing`
 * (спека 09 «Undo до пустого холста»). Пустой стек (точек ещё нет) — no-op: кнопка панели по нему disabled (ADR 0019 E3).
 */
const undoPoint = (state: MakingWallsState, ctx: ToolContext): Step => {
  const previous = state.undo[state.undo.length - 1];
  if (previous === undefined) return { state };
  if (previous.length === 0) return { state: createEditingState() };
  const core: WallsCore = {
    ...coreOf(state),
    points: previous,
    undo: state.undo.slice(0, -1),
    redo: [...state.redo, state.points],
  };
  return { state: frame(core, ctx.pointer, ctx) };
};

/** Ctrl+Y: вернуть снятую точку; пустой стек — no-op. */
const redoPoint = (state: MakingWallsState, ctx: ToolContext): Step => {
  const next = state.redo[state.redo.length - 1];
  if (next === undefined) return { state };
  const core: WallsCore = {
    ...coreOf(state),
    points: next,
    undo: [...state.undo, state.points],
    redo: state.redo.slice(0, -1),
  };
  return { state: frame(core, ctx.pointer, ctx) };
};

/**
 * Инструмент «Стены» (ADR 0019 E3, спека 01 «Polyline Walls»). Указатель: любое событие обновляет живой курсор
 * снапом (Q31 — первая точка снапнута к моменту клика); точку ставит `pointerUp` основной кнопки (как `mouseUp`
 * референса, верифицировано 0052) в `snap.snapped`; команда `doubleClick` — no-op (спека 01), но второй `pointerUp`
 * двойного клика — клик у последней точки, то есть завершение (как у референса; см. Заметки 0057);
 * `pointercancel`/`blur` рисование не рвут — зажатой кнопки в рисовании нет, точки остаются (спека 09 говорит о blur
 * во время drag; ADR 0019 «Что важно знать»). Esc/`interrupt`/смена вида — отмена всего без коммита. Ctrl+Z/Ctrl+Y —
 * локальные стеки (ADR 0018 D8), `nudge` — не обрабатывается.
 */
export const makingWallsHandler: ToolHandler<MakingWallsState> = {
  pointerDown: (state, input, ctx) => reframe(state, coreOf(state), input, ctx),
  pointerMove: (state, input, ctx) => reframe(state, coreOf(state), input, ctx),
  pointerUp: (state, input, ctx) => {
    const moved = reframe(state, coreOf(state), input, ctx).state as MakingWallsState;
    if (input.button !== 0 || moved.cursor === null) return { state: moved };
    return place(moved, moved.cursor, ctx);
  },
  doubleClick: (state, input, ctx) => reframe(state, coreOf(state), input, ctx),
  pointerCancel: state => ({ state }),
  cancel: () => ({ state: createEditingState() }),
  interrupt: () => createEditingState(),
  leaveConstructor: () => createEditingState(),
  key: (state, action, ctx) => {
    switch (action.kind) {
      case 'undo':
        return { ...undoPoint(state, ctx), handled: true };
      case 'redo':
        return { ...redoPoint(state, ctx), handled: true };
      case 'nudge':
        return { state, handled: false };
    }
  },
  commitPoint: (state, point, ctx) => place(state, point, ctx),
  refresh: (state, ctx) => {
    // Документ мог измениться под первой точкой (команда извне) — соседи старта пересчитываются по свежему индексу.
    const first = state.points[0];
    const startNeighbours = first ? findNearSegments(first, ctx.snapIndex().segments) : null;
    return reframe(state, { ...coreOf(state), startNeighbours }, ctx.pointer, ctx);
  },
};
