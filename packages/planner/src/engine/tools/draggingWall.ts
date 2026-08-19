import { faceNormal, shiftAlongNormal, shiftPoint } from '../../document/geometry/edit/faceNormalShift';
import { getSnapPoint, missSnap, SNAP_DIST, type SnapResult } from '../../document/geometry/snap/getSnapPoint';
import { pixelsToPlan } from '../../document/geometry/viewport';
import type { PlanPosition } from '../../document/PlannerDocument';
import type { PointMove } from '../commands/movePoints';
import { samePosition, sameSnap } from './drawingSnap';
import { editingWith, facePoints, targetAlive } from './editHit';
import type { Step, ToolContext, ToolHandler } from './ToolHandler';
import { createEditingState, type DraggingWallState, type HitTarget, type PointerInput } from './ToolState';

/**
 * Кадр драга стороны (спека 01 «Перетаскивание стены»; ADR 0019 E4): дельта курсора от точки захвата проецируется
 * на нормаль грани → кандидат позиции конца `a` → снап позиции (`exceptIds` — оба конца; Ctrl/Cmd — без снапа) →
 * итоговый сдвиг = проекция снапнутого смещения обратно на нормаль (движение остаётся строго перпендикулярным) →
 * оба конца сдвинуты одинаково. Грань пропала (концы больше не соседи в контуре) или выродилась — `null` (жест отменяется).
 */
const frame = (state: DraggingWallState, input: PointerInput, ctx: ToolContext): DraggingWallState | null => {
  const ends = targetAlive(state.selection, ctx) ? facePoints(state.face, ctx) : null;
  if (!ends) return null;
  const normal = faceNormal(ends.a, ends.b);
  if (!normal) return null;
  const rawShift = shiftAlongNormal(normal, { x: input.x - state.grab.x, y: input.y - state.grab.y });
  const candidate = shiftPoint(ends.a, normal, rawShift);
  const snap: SnapResult =
    input.mods.ctrl || input.mods.meta
      ? missSnap(candidate)
      : getSnapPoint(candidate, ctx.snapIndex().candidates, {
          snapDist: pixelsToPlan(ctx.viewport, SNAP_DIST),
          viewport: ctx.viewport,
          flags: ctx.snapFlags,
          exceptIds: [state.face.a, state.face.b],
        });
  const shift = shiftAlongNormal(normal, { x: snap.snapped.x - ends.a.x, y: snap.snapped.y - ends.a.y });
  const pointOverrides: Record<string, PlanPosition> = {
    [state.face.a]: shiftPoint(ends.a, normal, shift),
    [state.face.b]: shiftPoint(ends.b, normal, shift),
  };
  return { ...state, shift, pointOverrides, snap };
};

const reframe = (state: DraggingWallState, input: PointerInput, ctx: ToolContext): Step => {
  const next = frame(state, input, ctx);
  if (next === null) return { state: editingWith(targetAlive(state.selection, ctx) ? state.selection : null, ctx) };
  const same =
    next.shift === state.shift &&
    sameSnap(next.snap, state.snap) &&
    samePosition(next.pointOverrides[state.face.a] ?? null, state.pointOverrides[state.face.a] ?? null) &&
    samePosition(next.pointOverrides[state.face.b] ?? null, state.pointOverrides[state.face.b] ?? null);
  return { state: same ? state : next };
};

/** Вход в драг стороны из `editing`: `grab` — точка нажатия; грань пропала/вырождена — `null`, драга нет. */
export const startDraggingWall = (
  selection: HitTarget & { kind: 'wall' },
  grab: PlanPosition,
  input: PointerInput,
  ctx: ToolContext,
): DraggingWallState | null => {
  const base: DraggingWallState = {
    kind: 'dragging-wall',
    face: selection.face,
    selection,
    grab: { x: grab.x, y: grab.y },
    shift: 0,
    pointOverrides: {},
    snap: missSnap(grab),
  };
  return frame(base, input, ctx);
};

const abort = (state: DraggingWallState, ctx: ToolContext): Step => ({ state: editingWith(state.selection, ctx) });

/**
 * `dragging-wall` (ADR 0019 E4): live-позиции обоих концов — `pointOverrides`, документ не трогается; `pointerUp`
 * основной кнопки → `movePoints` двух концов одной записью → `editing` с тем же выделением; отмена — как у драга вершины.
 */
export const draggingWallHandler: ToolHandler<DraggingWallState> = {
  pointerDown: (state, input, ctx) => reframe(state, input, ctx),
  pointerMove: (state, input, ctx) => reframe(state, input, ctx),
  pointerUp: (state, input, ctx) => {
    if (input.button !== 0) return reframe(state, input, ctx);
    const step = reframe(state, input, ctx);
    if (step.state.kind !== 'dragging-wall') return step;
    const moved = step.state;
    const { floorId } = ctx;
    const moves: PointMove[] = [moved.face.a, moved.face.b].map(id => {
      const position = moved.pointOverrides[id]!;
      return { id, x: position.x, y: position.y };
    });
    return {
      state: editingWith(moved.selection, ctx),
      effect: () => {
        if (floorId === null) return;
        const result = ctx.movePoints(floorId, moves);
        if (!result.ok) ctx.logger.debug('@uyutno/planner: wall drag rejected by movePoints', result.error);
      },
    };
  },
  doubleClick: (state, input, ctx) => reframe(state, input, ctx),
  pointerCancel: abort,
  cancel: abort,
  interrupt: () => createEditingState(),
  leaveConstructor: state => ({ kind: 'editing', hover: null, selection: state.selection }),
  key: (state, action, ctx) => {
    switch (action.kind) {
      case 'undo':
      case 'redo':
        return { ...abort(state, ctx), handled: true };
      case 'nudge':
      case 'delete':
        return { state, handled: false };
    }
  },
  refresh: (state, ctx) => (ctx.pointer ? reframe(state, ctx.pointer, ctx) : { state }),
  selectionOf: state => state.selection,
};
