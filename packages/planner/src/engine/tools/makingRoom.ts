import { CLOSE_EPS, contourClosure } from '../../document/geometry/contours/contourClosure';
import {
  MIN_WALL_LENGTH,
  POLYLINE_ROOM_MIN_POINTS,
  validateContour,
} from '../../document/geometry/contours/validateContour';
import { dedupeConsecutivePoints } from '../../document/geometry/predicates/dedupeConsecutivePoints';
import { euclDist, manhDist } from '../../document/geometry/predicates/distance';
import { pointsMatch } from '../../document/geometry/predicates/pointsMatch';
import type { PlanPosition } from '../../document/PlannerDocument';
import { quantize } from '../../document/quantize';
import { cursorFrame, sameCursorFrame } from './drawingSnap';
import type { PlaceStep, Step, ToolContext, ToolHandler } from './ToolHandler';
import { createEditingState, type MakingRoomState, type PointerInput } from './ToolState';

/** Стабильная часть состояния между движениями курсора: то, что меняют только клики и локальные undo/redo. */
interface RoomCore {
  points: readonly PlanPosition[];
  undo: readonly (readonly PlanPosition[])[];
  redo: readonly (readonly PlanPosition[])[];
}

const coreOf = ({ points, undo, redo }: MakingRoomState): RoomCore => ({ points, undo, redo });

/**
 * Полное состояние из стабильной части и последнего ввода указателя: снап (пул — индекс этажа + поставленные
 * вершины) → живая вершина → гайды (без пунктира второй грани — толщины нет). Без ввода указателя — курсора нет.
 */
const frame = (core: RoomCore, pointer: PointerInput | null, ctx: ToolContext): MakingRoomState => {
  const base = { kind: 'making-room' as const, ...core };
  if (pointer === null) return { ...base, cursor: null, snap: null, guides: [] };
  const lastPoint = core.points[core.points.length - 1] ?? null;
  return { ...base, ...cursorFrame(core.points, pointer, ctx, { lastPoint, face: null }) };
};

const sameFrame = (a: MakingRoomState, b: MakingRoomState): boolean =>
  a.points === b.points && a.undo === b.undo && a.redo === b.redo && sameCursorFrame(a, b);

const reframe = (state: MakingRoomState, pointer: PointerInput | null, ctx: ToolContext): Step => {
  const next = frame(coreOf(state), pointer, ctx);
  return { state: sameFrame(state, next) ? state : next };
};

/** Старт инструмента: пустой контур, курсор — из последнего известного ввода (если был). */
export const startMakingRoom = (ctx: ToolContext): MakingRoomState =>
  frame({ points: [], undo: [], redo: [] }, ctx.pointer, ctx);

/**
 * Завершение (ADR 0019 E3; спека 01 «Polyline Room», «Крайние случаи»): дедуп → `validateContour` (замкнутый,
 * ≥ `POLYLINE_ROOM_MIN_POINTS`) → `document.addContours` одного `inner` одной транзакцией → `editing`. Отказы
 * молчаливые (самопересечение, вырожденность): `logger.debug`, документ не тронут, автомат — в `editing`. Команда
 * зовётся отложенно (после перехода), чтобы `document:changed` застал автомат уже вне рисования.
 */
const finish = (state: MakingRoomState, ctx: ToolContext): Step => {
  const editing = createEditingState();
  const reject = (reason: string, details?: unknown): Step => {
    ctx.logger.debug(`@uyutno/planner: room contour rejected: ${reason}`, details);
    return { state: editing };
  };
  const { floorId } = ctx;
  if (floorId === null) return reject('no-active-floor');
  const points = dedupeConsecutivePoints(state.points, true);
  const validation = validateContour(points, { closed: true, minPoints: POLYLINE_ROOM_MIN_POINTS });
  if (!validation.ok) return reject(validation.reason, { points: points.length });
  return {
    state: editing,
    effect: () => {
      // После `validateContour` команда штатно не отказывает; ветка — страховка на расхождение проверок.
      const result = ctx.addContours(floorId, [{ kind: 'inner', points: points.map(p => ({ x: p.x, y: p.y })) }]);
      if (!result.ok) ctx.logger.debug('@uyutno/planner: room contour rejected by addContours', result.error);
    },
  };
};

const ignore = (
  state: MakingRoomState,
  rejected: NonNullable<PlaceStep['rejected']>,
  point: PlanPosition,
  ctx: ToolContext,
): PlaceStep => {
  ctx.logger.debug(`@uyutno/planner: room point ignored: ${rejected}`, point);
  return { state, rejected };
};

/**
 * Постановка вершины — общий путь клика (`snap.snapped`) и Enter в инпуте длины (`commitPoint`, без снапа; Q27):
 * точка, слившаяся по манхэттену (≤ `CLOSE_EPS`) с первой или последней вершиной, замыкает контур (спека 01 «Как
 * завершить»; метрика и пара первая/последняя — как `StateMakingRoom` референса, верифицировано 0052); курсор к
 * этому моменту уже притянут к вершине снапом, допуск лишь подтверждает совпадение. Замыкание — только от
 * `POLYLINE_ROOM_MIN_POINTS` вершин (порог инструмента, ADR 0019 E3): пока их меньше, клик в первую/последнюю —
 * дубль (игнор), а не замыкание — контур из трёх вершин комнатой по спеке не становится (референс отсеивал на
 * `stop`, выходя из рисования и теряя точки). Гард входа (спека 01 «Ограничения», как у «Стен»): совпадение с
 * поставленной вершиной — `duplicate-point` (проверяется первым: точный ввод длины получает точную причину), ребро
 * короче `MIN_WALL_LENGTH` (в т.ч. замыкающее) — `too-short`. Самопересечение и вырожденность — только на завершении.
 */
const place = (state: MakingRoomState, raw: PlanPosition, ctx: ToolContext): PlaceStep => {
  const point = { x: quantize(raw.x), y: quantize(raw.y) };
  const { points } = state;
  const closure =
    points.length >= POLYLINE_ROOM_MIN_POINTS
      ? contourClosure(point, points, { lastRadius: CLOSE_EPS, distance: manhDist })
      : null;
  if (closure !== null) {
    const validation = validateContour(dedupeConsecutivePoints(points, true), {
      closed: true,
      minPoints: POLYLINE_ROOM_MIN_POINTS,
    });
    if (!validation.ok && validation.reason === 'shortEdge') return ignore(state, 'too-short', point, ctx);
    if (!validation.ok && validation.reason === 'duplicatePoints') return ignore(state, 'duplicate-point', point, ctx);
    return finish(state, ctx);
  }

  if (points.some(fixed => pointsMatch(fixed, point))) return ignore(state, 'duplicate-point', point, ctx);
  const last = points[points.length - 1];
  if (last && euclDist(last, point) < MIN_WALL_LENGTH) return ignore(state, 'too-short', point, ctx);

  const core: RoomCore = { points: [...points, point], undo: [...state.undo, points], redo: [] };
  return { state: frame(core, ctx.pointer, ctx) };
};

/**
 * Ctrl+Z: снять последнюю поставленную вершину (снимок из локального стека); дошли до пустого холста → `editing`
 * (спека 09). Пустой стек — no-op (кнопка панели по нему disabled, ADR 0019 E3).
 */
const undoPoint = (state: MakingRoomState, ctx: ToolContext): Step => {
  const previous = state.undo[state.undo.length - 1];
  if (previous === undefined) return { state };
  if (previous.length === 0) return { state: createEditingState() };
  const core: RoomCore = { points: previous, undo: state.undo.slice(0, -1), redo: [...state.redo, state.points] };
  return { state: frame(core, ctx.pointer, ctx) };
};

/** Ctrl+Y: вернуть снятую вершину; пустой стек — no-op. */
const redoPoint = (state: MakingRoomState, ctx: ToolContext): Step => {
  const next = state.redo[state.redo.length - 1];
  if (next === undefined) return { state };
  const core: RoomCore = { points: next, undo: [...state.undo, state.points], redo: state.redo.slice(0, -1) };
  return { state: frame(core, ctx.pointer, ctx) };
};

/**
 * Инструмент «Комната по точкам» (ADR 0019 E3, спека 01 «Polyline Room»): контур без толщины. Указатель — как у
 * «Стен»: любое событие обновляет живую вершину снапом (Q31), вершину ставит `pointerUp` основной кнопки в
 * `snap.snapped`; `doubleClick` — no-op (второй `pointerUp` двойного клика у последней вершины — замыкание от
 * четырёх вершин, иначе дубль); `pointerCancel`/`blur` рисование не рвут. Esc/`interrupt`/смена вида — отмена без
 * коммита; Ctrl+Z/Ctrl+Y — локальные стеки (ADR 0018 D8), `nudge` — не обрабатывается.
 */
export const makingRoomHandler: ToolHandler<MakingRoomState> = {
  pointerDown: (state, input, ctx) => reframe(state, input, ctx),
  pointerMove: (state, input, ctx) => reframe(state, input, ctx),
  pointerUp: (state, input, ctx) => {
    const moved = reframe(state, input, ctx).state as MakingRoomState;
    if (input.button !== 0 || moved.cursor === null) return { state: moved };
    return place(moved, moved.cursor, ctx);
  },
  doubleClick: (state, input, ctx) => reframe(state, input, ctx),
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
      case 'delete':
        return { state, handled: false };
    }
  },
  commitPoint: (state, point, ctx) => place(state, point, ctx),
  refresh: (state, ctx) => reframe(state, ctx.pointer, ctx),
};
