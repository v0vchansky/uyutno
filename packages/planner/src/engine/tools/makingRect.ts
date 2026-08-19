import { DEFAULT_WALL_WIDTH, type WallBlock } from '../../document/geometry/band/blocksFromContour';
import { rectContours } from '../../document/geometry/contours/rectContours';
import { MIN_WALL_LENGTH } from '../../document/geometry/contours/validateContour';
import { pointsMatch } from '../../document/geometry/predicates/pointsMatch';
import type { PlanPosition } from '../../document/PlannerDocument';
import { quantize } from '../../document/quantize';
import type { ContourInput } from '../commands/addContours';
import { cursorFrame, sameCursorFrame } from './drawingSnap';
import type { PlaceStep, Step, ToolContext, ToolHandler } from './ToolHandler';
import { createEditingState, type MakingRectState, type PointerInput } from './ToolState';

/**
 * Квады превью между `outer` и `inner` в форме ленты «Стен» (`[A, C, D, B]`: `A → C` — грань офсета = полость,
 * `B → D` — нарисованная линия = внешний прямоугольник); сплошной контур — один квад-прямоугольник; нулевой
 * размер — пусто (рисовать нечего). Совпадает с `blocksFromContour(outer, width, 'left', true)` для полой
 * (проверено тестом `rectContours`), но строится напрямую: превью — ровно то, что уйдёт в коммит.
 */
const previewBlocks = (origin: PlanPosition, corner: PlanPosition): readonly WallBlock[] => {
  if (origin.x === corner.x || origin.y === corner.y) return [];
  const { outer, inner } = rectContours(origin, corner, DEFAULT_WALL_WIDTH);
  if (inner === null) return [outer];
  return outer.map((_, k): WallBlock => {
    const next = (k + 1) % 4;
    return [inner[k]!, inner[next]!, outer[next]!, outer[k]!];
  });
};

/**
 * Полное состояние из угла и последнего ввода указателя: снап (пул — индекс этажа + `origin`, к нему же тянутся
 * оси) → живой угол → превью. Гайды — только основные (`lastPoint: null`): «последнего сегмента» у прямоугольника
 * нет, угловой фильтр от диагонали `origin → cursor` смысла не имеет (референс рисовал `drawAligner` без расширенных).
 * Без ввода указателя (угол мог прийти из `commitPoint`) — превью нет.
 */
const frame = (origin: PlanPosition | null, pointer: PointerInput | null, ctx: ToolContext): MakingRectState => {
  const base = { kind: 'making-rect' as const, origin };
  if (pointer === null) return { ...base, cursor: null, preview: [], snap: null, guides: [] };
  const points = origin ? [origin] : [];
  const { cursor, snap, guides } = cursorFrame(points, pointer, ctx, { lastPoint: null, face: null });
  return { ...base, cursor, preview: origin ? previewBlocks(origin, cursor) : [], snap, guides };
};

const reframe = (state: MakingRectState, pointer: PointerInput | null, ctx: ToolContext): Step => {
  const next = frame(state.origin, pointer, ctx);
  return { state: sameCursorFrame(state, next) ? state : next };
};

/** Старт инструмента: угла нет, курсор — из последнего известного ввода (если был). */
export const startMakingRect = (ctx: ToolContext): MakingRectState => frame(null, ctx.pointer, ctx);

const ignore = (
  state: MakingRectState,
  rejected: NonNullable<PlaceStep['rejected']>,
  point: PlanPosition,
  ctx: ToolContext,
): PlaceStep => {
  ctx.logger.debug(`@uyutno/planner: rect corner ignored: ${rejected}`, point);
  return { state, rejected };
};

/**
 * Постановка угла — общий путь клика (`snap.snapped`) и Enter в инпуте размера (`commitPoint`, без снапа; Q27).
 * Первый — `origin`; второй завершает: `rectContours` → `outer` (+ `inner`, если обе стороны > 2 × ширины и
 * полость валидна) → `document.addContours` одной транзакцией → `editing`. Гард входа (спека 01 «Ограничения»:
 * минимальная длина стены 15 см): угол, совпавший с `origin`, — `duplicate-point`; сторона короче
 * `MIN_WALL_LENGTH` — `too-short`; в обоих случаях угол молча игнорируется, состояние не меняется. Отказать иначе
 * прямоугольник не может (осевой, без самопересечений), поэтому отказ команды — только страховка (`logger.debug`).
 */
const place = (state: MakingRectState, raw: PlanPosition, ctx: ToolContext): PlaceStep => {
  const point = { x: quantize(raw.x), y: quantize(raw.y) };
  const { origin } = state;
  if (origin === null) return { state: frame(point, ctx.pointer, ctx) };
  if (pointsMatch(origin, point)) return ignore(state, 'duplicate-point', point, ctx);
  if (Math.abs(point.x - origin.x) < MIN_WALL_LENGTH || Math.abs(point.y - origin.y) < MIN_WALL_LENGTH) {
    return ignore(state, 'too-short', point, ctx);
  }
  const editing = createEditingState();
  const { floorId } = ctx;
  if (floorId === null) {
    ctx.logger.debug('@uyutno/planner: rect contour rejected: no-active-floor');
    return { state: editing };
  }
  const { outer, inner } = rectContours(origin, point, DEFAULT_WALL_WIDTH);
  const contours: ContourInput[] = [{ kind: 'outer', points: outer.map(p => ({ x: p.x, y: p.y })) }];
  if (inner) contours.push({ kind: 'inner', points: inner.map(p => ({ x: p.x, y: p.y })) });
  return {
    state: editing,
    effect: () => {
      const result = ctx.addContours(floorId, contours);
      if (!result.ok) ctx.logger.debug('@uyutno/planner: rect contour rejected by addContours', result.error);
    },
  };
};

/**
 * Инструмент «Прямоугольная комната» (ADR 0019 E3, спека 01 «Rectangle Room»): любое событие указателя обновляет
 * живой угол снапом (Q31); угол ставит `pointerUp` основной кнопки (как `mouseUp` референса) в `snap.snapped`;
 * первый клик — `origin`, второй — противоположный угол и автозавершение (коммит одной транзакцией → `editing`).
 * `doubleClick`, `pointerCancel`/`blur` — no-op (зажатой кнопки в рисовании нет; второй `pointerUp` двойного клика
 * у `origin` — дубль, игнорируется). Esc/`interrupt`/смена вида — отмена без коммита. Ctrl+Z при поставленном угле —
 * «undo до пустого холста» → `editing`, без угла — no-op; Ctrl+Y — no-op (локального стека нет); `nudge` — не обрабатывается.
 */
export const makingRectHandler: ToolHandler<MakingRectState> = {
  pointerDown: (state, input, ctx) => reframe(state, input, ctx),
  pointerMove: (state, input, ctx) => reframe(state, input, ctx),
  pointerUp: (state, input, ctx) => {
    const moved = reframe(state, input, ctx).state as MakingRectState;
    if (input.button !== 0 || moved.cursor === null) return { state: moved };
    return place(moved, moved.cursor, ctx);
  },
  doubleClick: (state, input, ctx) => reframe(state, input, ctx),
  pointerCancel: state => ({ state }),
  cancel: () => ({ state: createEditingState() }),
  interrupt: () => createEditingState(),
  leaveConstructor: () => createEditingState(),
  key: (state, action) => {
    switch (action.kind) {
      case 'undo':
        return { state: state.origin === null ? state : createEditingState(), handled: true };
      case 'redo':
        return { state, handled: true };
      case 'nudge':
      case 'delete':
        return { state, handled: false };
    }
  },
  commitPoint: (state, point, ctx) => place(state, point, ctx),
  refresh: (state, ctx) => reframe(state, ctx.pointer, ctx),
};
