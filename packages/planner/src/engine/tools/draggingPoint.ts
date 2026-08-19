import { getSnapPoint, missSnap, SNAP_DIST, type SnapResult } from '../../document/geometry/snap/getSnapPoint';
import { guidesFor, type SnapGuide } from '../../document/geometry/snap/guidesFor';
import { projectPointOnLine } from '../../document/geometry/predicates/projectPointOnLine';
import { pixelsToPlan } from '../../document/geometry/viewport';
import type { Id } from '../../document/id';
import type { PlanPosition } from '../../document/PlannerDocument';
import type { PointMove } from '../commands/movePoints';
import { sameGuides, samePosition, sameSnap } from './drawingSnap';
import { editingWith, facePoints, hitAt, keepTarget } from './editHit';
import type { Step, ToolContext, ToolHandler } from './ToolHandler';
import { createEditingState, type DraggingPointState, type HitTarget, type PointerInput } from './ToolState';

/** Снап выключен целиком при Ctrl/Cmd (ADR 0019 E2): позиция — квантованный сырой курсор, целей дропа нет. */
const snapOff = (input: PointerInput): boolean => input.mods.ctrl || input.mods.meta;

/** Снап курсора при драге вершины: пул этажа без самой вершины (`exceptIds` — один id покрывает совладельцев), без орто-якорей. */
const snapDragged = (pointId: Id, input: PointerInput, ctx: ToolContext): SnapResult => {
  if (snapOff(input)) return missSnap(input);
  return getSnapPoint(input, ctx.snapIndex().candidates, {
    snapDist: pixelsToPlan(ctx.viewport, SNAP_DIST),
    viewport: ctx.viewport,
    flags: ctx.snapFlags,
    exceptIds: [pointId],
  });
};

/**
 * Позиция дропа по цели (ADR 0019 E4): цель-сторона — проекция снапнутой позиции на её отрезок (T-стык делает
 * `normalize`; проекция мимо отрезка/вырожденная грань — позиция как есть, разреза не будет); цель-вершина — её
 * координата (слияние — тождество квантованной координаты в `normalize`); без цели — снапнутая позиция.
 * Считается на каждом кадре, чтобы превью (`pointOverrides`) совпадало с коммитом — «прыжка» на дропе нет (спека 01).
 */
const dropPosition = (snapped: PlanPosition, dropTarget: HitTarget | null, ctx: ToolContext): PlanPosition => {
  if (dropTarget?.kind === 'point') {
    const floor = ctx.document.floors.find(candidate => candidate.id === ctx.floorId);
    const target = floor?.layout.points[dropTarget.id];
    return target ? { x: target.x, y: target.y } : snapped;
  }
  if (dropTarget?.kind === 'wall') {
    const ends = facePoints(dropTarget.face, ctx);
    return (ends && projectPointOnLine(snapped, ends.a, ends.b)) ?? snapped;
  }
  return snapped;
};

/** Кадр драга по вводу указателя: снап → цель дропа под снапнутой позицией → override = позиция дропа → гайды. */
const frame = (state: DraggingPointState, input: PointerInput, ctx: ToolContext): DraggingPointState => {
  const snap = snapDragged(state.pointId, input, ctx);
  const dropTarget = snapOff(input)
    ? null
    : keepTarget(state.dropTarget, hitAt(snap.snapped, ctx, { exceptPointIds: [state.pointId], skipRooms: true }));
  const position = dropPosition(snap.snapped, dropTarget, ctx);
  const guides: readonly SnapGuide[] = snapOff(input)
    ? []
    : guidesFor(snap, { lastPoint: null, segments: ctx.snapIndex().segments, face: null });
  return { ...state, pointOverrides: { [state.pointId]: position }, snap, guides, dropTarget };
};

const sameFrame = (a: DraggingPointState, b: DraggingPointState): boolean =>
  samePosition(a.pointOverrides[a.pointId] ?? null, b.pointOverrides[b.pointId] ?? null) &&
  sameSnap(a.snap, b.snap) &&
  sameGuides(a.guides, b.guides) &&
  a.dropTarget === b.dropTarget;

const reframe = (state: DraggingPointState, input: PointerInput, ctx: ToolContext): Step => {
  const next = frame(state, input, ctx);
  return { state: sameFrame(state, next) ? state : next };
};

/**
 * Вход в драг вершины из `editing` (сдвиг > порога): `selection` — ссылка цели (та же уходит обратно в `editing`),
 * `origin` — позиция вершины в документе. Вершины в документе нет (гонка с командой извне) — `null`, драга нет.
 */
export const startDraggingPoint = (
  selection: HitTarget & { kind: 'point' },
  input: PointerInput,
  ctx: ToolContext,
): DraggingPointState | null => {
  const floor = ctx.document.floors.find(candidate => candidate.id === ctx.floorId);
  const point = floor?.layout.points[selection.id];
  if (!point) return null;
  const base: DraggingPointState = {
    kind: 'dragging-point',
    pointId: selection.id,
    selection,
    origin: { x: point.x, y: point.y },
    pointOverrides: {},
    snap: missSnap(point),
    guides: [],
    dropTarget: null,
  };
  return frame(base, input, ctx);
};

/** Отмена жеста: `editing` с тем же выделением, документ и история не тронуты, override сброшен. */
const abort = (state: DraggingPointState, ctx: ToolContext): Step => ({ state: editingWith(state.selection, ctx) });

/**
 * `dragging-point` (ADR 0019 E4). Каждый `pointerMove` — снап с `exceptIds = [pointId]` → `pointOverrides`; документ
 * не трогается. `pointerUp` основной кнопки → `movePoints` одной записью (эффект после перехода в `editing` с той же
 * ссылкой выделения; при слиянии с целью выделяется выжившая вершина — меньший id).
 * Esc/`blur`/`pointercancel`/Ctrl+Z/`interrupt`/смена вида — отмена без коммита (спека 09 «Прерывание жеста»).
 */
export const draggingPointHandler: ToolHandler<DraggingPointState> = {
  pointerDown: (state, input, ctx) => reframe(state, input, ctx),
  pointerMove: (state, input, ctx) => reframe(state, input, ctx),
  pointerUp: (state, input, ctx) => {
    if (input.button !== 0) return reframe(state, input, ctx);
    const moved = reframe(state, input, ctx).state as DraggingPointState;
    const { floorId } = ctx;
    const position = moved.pointOverrides[moved.pointId] ?? moved.origin;
    const move: PointMove = { id: moved.pointId, x: position.x, y: position.y };
    // Слияние с целью: `normalize` оставляет меньший id (ADR 0017 C1) — выделение переносится на выжившую вершину;
    // если политика id иная, мёртвое выделение снимет `refresh` (безопасная деградация).
    const selection: HitTarget =
      moved.dropTarget?.kind === 'point' && moved.dropTarget.id < moved.pointId ? moved.dropTarget : moved.selection;
    return {
      state: editingWith(selection, ctx),
      effect: () => {
        if (floorId === null) return;
        const result = ctx.movePoints(floorId, [move]);
        if (!result.ok) ctx.logger.debug('@uyutno/planner: point drag rejected by movePoints', result.error);
      },
    };
  },
  doubleClick: (state, input, ctx) => reframe(state, input, ctx),
  pointerCancel: abort,
  cancel: abort,
  interrupt: () => createEditingState(),
  // Смена вида: жест отменяется, выделение сохраняется, hover пуст до первого движения (спека 08).
  leaveConstructor: state => ({ kind: 'editing', hover: null, selection: state.selection }),
  key: (state, action, ctx) => {
    switch (action.kind) {
      case 'undo':
      case 'redo':
        // Ctrl+Z/Ctrl+Y во время драга — отмена жеста, история не трогается (ADR 0019 E1).
        return { ...abort(state, ctx), handled: true };
      case 'nudge':
      case 'delete':
        return { state, handled: false };
    }
  },
  refresh: (state, ctx) => {
    // Документ сменился под драгом (команда извне): вершины больше нет — жест отменяется; иначе пересчёт по свежему индексу.
    const floor = ctx.document.floors.find(candidate => candidate.id === ctx.floorId);
    if (!floor?.layout.points[state.pointId]) return { state: editingWith(null, ctx) };
    return ctx.pointer ? reframe(state, ctx.pointer, ctx) : { state };
  },
  selectionOf: state => state.selection,
};
