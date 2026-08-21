import { nudgeStep } from '../../document/geometry/edit/nudgeStep';
import { splitPositionOn } from '../../document/geometry/hittest/faceHandle';
import { euclDist } from '../../document/geometry/predicates/distance';
import { pixelsToPlan } from '../../document/geometry/viewport';
import { createId, type Id } from '../../document/id';
import type { PlanPosition } from '../../document/PlannerDocument';
import type { PointMove } from '../commands/movePoints';
import { startDraggingPoint, startSplittingFace } from './draggingPoint';
import { startDraggingWall } from './draggingWall';
import { DRAG_THRESHOLD, facePoints, hitAt, inConstructor, keepTarget, onSplitHandle, targetAlive } from './editHit';
import type { KeyStep, Step, ToolContext, ToolHandler } from './ToolHandler';
import { sameHitTarget } from '../../document/geometry/hittest/hitTest';
import { createEditingState, type EditingState, type HitTarget, type PointerInput, type Pressed } from './ToolState';

/** Новое состояние только при фактической смене hover/выделения/нажатия — иначе прежняя ссылка (no-op для `tools:changed`). */
const update = (state: EditingState, patch: Partial<EditingState>): EditingState => {
  const next: EditingState = { kind: 'editing', hover: state.hover, selection: state.selection };
  if (state.splitHandle) next.splitHandle = true;
  if (state.pressed) next.pressed = state.pressed;
  if (state.reclicked !== undefined) next.reclicked = state.reclicked;
  if ('hover' in patch) next.hover = keepTarget(state.hover, patch.hover ?? null);
  if ('splitHandle' in patch) {
    if (patch.splitHandle) next.splitHandle = true;
    else delete next.splitHandle;
  }
  if ('selection' in patch) next.selection = keepTarget(state.selection, patch.selection ?? null);
  if ('pressed' in patch) {
    if (patch.pressed) next.pressed = patch.pressed;
    else delete next.pressed;
  }
  if ('reclicked' in patch) {
    if (patch.reclicked !== undefined) next.reclicked = patch.reclicked;
    else delete next.reclicked;
  }
  // Смена выделения снимает подтверждение удаления.
  if (next.selection !== state.selection) delete next.reclicked;
  const same =
    next.hover === state.hover &&
    next.splitHandle === state.splitHandle &&
    next.selection === state.selection &&
    next.pressed === state.pressed &&
    next.reclicked === state.reclicked;
  return same ? state : next;
};

/** Наведение по вводу указателя: цель хит-теста и ручка деления внутри неё — считаются вместе, живут вместе. */
const hoverAt = (point: PlanPosition, ctx: ToolContext): Pick<EditingState, 'hover' | 'splitHandle'> => {
  const hover = hitAt(point, ctx);
  return { hover, splitHandle: onSplitHandle(hover, point, ctx) };
};

/**
 * Что выделяет клик по цели (спека 01 «Выбор»): вершина — вершина, сторона — стена, Ctrl/Cmd + сторона комнаты
 * (`inner`-контур с записью в производном) — вся комната; сторона без комнаты (`outer`) и с Ctrl — стена;
 * внутренность комнаты — комната; пусто — сброс.
 */
const clickSelection = (target: HitTarget | null, input: PointerInput, ctx: ToolContext): HitTarget | null => {
  if (target?.kind === 'wall' && (input.mods.ctrl || input.mods.meta)) {
    const room = ctx.derived?.rooms.find(candidate => candidate.contourId === target.face.contourId);
    if (room) return { kind: 'room', roomId: room.roomId };
  }
  return target;
};

/** Сдвиг от точки нажатия превысил порог драга (`DRAG_THRESHOLD` px в план по viewport). */
const beyondThreshold = (from: { x: number; y: number }, input: PointerInput, ctx: ToolContext): boolean =>
  euclDist(from, input) > pixelsToPlan(ctx.viewport, DRAG_THRESHOLD);

/** Нажатие в `editing` → сдвиг за порог: вершина → `dragging-point`, сторона → `dragging-wall`; иначе — остаёмся. */
const maybeStartDrag = (state: EditingState, input: PointerInput, ctx: ToolContext): Step => {
  const { pressed } = state;
  const hover = hoverAt(input, ctx);
  if (!pressed?.target || !beyondThreshold(pressed.origin, input, ctx)) return { state: update(state, hover) };
  const { target } = pressed;
  // Ссылка цели: если она уже выделена — та же (серия не рвётся), иначе новая — драг выделяет свою цель.
  const selection = keepTarget(state.selection, target);
  if (selection?.kind === 'point') {
    const drag = startDraggingPoint(selection, input, ctx);
    return { state: drag ?? update(state, { ...hover, pressed: undefined }) };
  }
  if (selection?.kind === 'wall') {
    const drag = startDraggingWall(selection, pressed.origin, input, ctx);
    return { state: drag ?? update(state, { ...hover, pressed: undefined }) };
  }
  return { state: update(state, hover) };
};

/**
 * Нажатие по ручке деления грани (спека 01, задача 0096): вершина рождается **прямо здесь**, синхронно и
 * **без порога сдвига** — это осознанное решение автора (2026-08-21), полный паритет с reference, а не
 * недосмотр; одиночный клик уже делит грань, вернуть — только отменой. Не «чинить» гистерезисом.
 *
 * Порядок: id генерируется инструментом (состояние жеста замораживается раньше, чем выполнится `effect`) →
 * переход в `dragging-point` этой вершины → эффект `insertPoint`. Дальше вершина тянется как обычная угловая,
 * а `pointerUp` коммитит `movePoints` тем же ключом коалесинга — весь жест одна запись истории.
 *
 * `null` — делить нечем (нет этажа, грань пропала или на ней нет законной позиции): обычная ветка нажатия.
 */
const startSplit = (hover: HitTarget | null, input: PointerInput, ctx: ToolContext): Step | null => {
  if (hover?.kind !== 'wall' || ctx.floorId === null) return null;
  const ends = facePoints(hover.face, ctx);
  const origin = ends && splitPositionOn(input, ends.a, ends.b);
  if (!origin) return null;
  const { floorId } = ctx;
  const { face } = hover;
  const pointId = createId();
  return {
    state: startSplittingFace(pointId, face, origin, input, ctx),
    effect: () => {
      const result = ctx.insertPoint(floorId, face, origin, { id: pointId });
      if (!result.ok) ctx.logger.debug('@uyutno/planner: face split rejected by insertPoint', result.error);
    },
  };
};

/**
 * Нудж выделения (ADR 0019 E4): вершина — `movePoints` одной точки, сторона — обоих концов, ключ коалесинга
 * `nudge:<ids>` — серия нажатий одна запись; шаг — по `settings.units` × `factor`; снап не участвует. Комната или
 * без выделения — `{ handled: false }` (вьювер панорамирует); нудж комнаты — парковка ADR.
 */
const nudge = (state: EditingState, action: { dx: number; dy: number; factor: number }, ctx: ToolContext): KeyStep => {
  const { selection } = state;
  const { floorId } = ctx;
  if (!selection || selection.kind === 'room' || floorId === null) return { state, handled: false };
  if (!Number.isFinite(action.dx) || !Number.isFinite(action.dy) || !Number.isFinite(action.factor)) {
    return { state, handled: false };
  }
  const step = nudgeStep(ctx.document.settings.units, action.factor);
  const dx = action.dx * step;
  const dy = action.dy * step;
  const floor = ctx.document.floors.find(candidate => candidate.id === floorId);
  const ids: Id[] = selection.kind === 'point' ? [selection.id] : [selection.face.a, selection.face.b];
  const moves: PointMove[] = [];
  for (const id of ids) {
    const point = floor?.layout.points[id];
    if (!point) return { state, handled: false };
    moves.push({ id, x: point.x + dx, y: point.y + dy });
  }
  const coalesce = `nudge:${ids.join('|')}`;
  return {
    state,
    handled: true,
    effect: () => {
      const result = ctx.movePoints(floorId, moves, { coalesce });
      if (!result.ok) ctx.logger.debug('@uyutno/planner: nudge rejected by movePoints', result.error);
    },
  };
};

/** Delete/Backspace: выделенная вершина → `deletePoint` (каскад ADR 0018 D2); стена/комната/пусто — не обрабатывается. */
const deleteSelected = (state: EditingState, ctx: ToolContext): KeyStep => {
  const { selection } = state;
  const { floorId } = ctx;
  if (selection?.kind !== 'point' || floorId === null) return { state, handled: false };
  const id = selection.id;
  return {
    state: update(state, {
      selection: null,
      hover: state.hover?.kind === 'point' && state.hover.id === id ? null : state.hover,
    }),
    handled: true,
    effect: () => {
      const result = ctx.deletePoint(floorId, id);
      if (!result.ok) ctx.logger.debug('@uyutno/planner: deletePoint rejected', result.error);
    },
  };
};

/**
 * Хаб `editing` (ADR 0019 E1/E4). Указатель: hover — хит-тест на каждом событии; `pointerDown` основной кнопки —
 * `pressed` (цель и точка нажатия), сдвиг > `DRAG_THRESHOLD/scale` от вершины/стороны → `dragging-*`;
 * `pointerUp` без сдвига — клик: выделение цели (Ctrl/Cmd + сторона комнаты — комната), мимо — сброс; dblClick по
 * вершине, кликнутой уже выделенной (`reclicked`), → `deletePoint`. Esc снимает выделение; Ctrl+Z/Ctrl+Y — `history.undo()/redo()` (единственное место, где
 * клавиши доходят до истории документа, ADR 0018 D8); стрелки — нудж выделения (без него — `{ handled: false }`,
 * вьювер панорамирует, E5); Delete/Backspace — удаление выделенной вершины. Смена документа (`refresh`) —
 * пересчёт hover и снятие мёртвого выделения. Вне конструктора (спека 08) указатель и клавиши правки — no-op,
 * выделение сохраняется до возврата.
 */
export const editingHandler: ToolHandler<EditingState> = {
  pointerDown: (state, input, ctx) => {
    if (!inConstructor(ctx)) return { state };
    const hover = hoverAt(input, ctx);
    if (input.button !== 0) return { state: update(state, hover) };
    // Ручка деления грани обходит `pressed` целиком: порога сдвига у неё нет (спека 01).
    if (hover.splitHandle) {
      const split = startSplit(hover.hover, input, ctx);
      if (split) return split;
    }
    const selected = hover.hover !== null && sameHitTarget(hover.hover, state.selection);
    const pressed: Pressed = { target: hover.hover, origin: { x: input.x, y: input.y }, selected };
    return { state: update(state, { ...hover, pressed, reclicked: undefined }) };
  },

  pointerMove: (state, input, ctx) => {
    if (!inConstructor(ctx)) return { state };
    return state.pressed ? maybeStartDrag(state, input, ctx) : { state: update(state, hoverAt(input, ctx)) };
  },

  pointerUp: (state, input, ctx) => {
    if (!inConstructor(ctx)) return { state };
    const hover = hoverAt(input, ctx);
    if (input.button !== 0 || !state.pressed) return { state: update(state, hover) };
    const { pressed } = state;
    const selection = clickSelection(pressed.target, input, ctx);
    // Клик по уже выделенной вершине (второй клик двойного) — подтверждение для `doubleClick`.
    const reclicked = pressed.selected && pressed.target?.kind === 'point' ? pressed.target.id : undefined;
    return { state: update(state, { ...hover, selection, pressed: undefined, reclicked }) };
  },

  // Удаляется вершина под курсором, по которой второй раз кликнули уже выделенной (`reclicked`): пара кликов двойного
  // клика, где первый завершил рисование («Стены»/«Прямоугольник»/«Комната по точкам») или впервые выделил вершину,
  // подтверждения не даёт — конец ленты/угол прямоугольника дабл-кликом не удаляется (развилка 0057/0058).
  doubleClick: (state, input, ctx) => {
    if (!inConstructor(ctx)) return { state };
    const hover = hoverAt(input, ctx);
    const hit = hover.hover;
    const { floorId } = ctx;
    const confirmed = hit?.kind === 'point' && state.reclicked === hit.id && sameHitTarget(hit, state.selection);
    if (!confirmed || floorId === null) return { state: update(state, { ...hover, pressed: undefined }) };
    const { id } = hit;
    return {
      state: update(state, {
        hover: null,
        splitHandle: false,
        selection: null,
        pressed: undefined,
        reclicked: undefined,
      }),
      effect: () => {
        const result = ctx.deletePoint(floorId, id);
        if (!result.ok) ctx.logger.debug('@uyutno/planner: deletePoint rejected', result.error);
      },
    };
  },

  // Кнопка отпущена вне канваса/окна: нажатие до порога снимается, драга не будет.
  pointerCancel: state => ({ state: update(state, { pressed: undefined }) }),

  cancel: state => ({ state: update(state, { selection: null, pressed: undefined }) }),

  interrupt: state =>
    state.hover === null && state.selection === null && !state.pressed && state.reclicked === undefined
      ? state
      : createEditingState(),

  leaveConstructor: state => update(state, { hover: null, splitHandle: false, pressed: undefined }),

  key: (state, action, ctx) => {
    const restore = (run: () => { ok: boolean }, what: string) => (): void => {
      // Пустой стек — не ошибка автомата: клавиша его, откатывать нечего (спека 09).
      if (!run().ok) ctx.logger.debug(`@uyutno/planner: nothing to ${what}`);
    };
    switch (action.kind) {
      case 'undo':
        return { state, handled: true, effect: restore(ctx.historyUndo, 'undo') };
      case 'redo':
        return { state, handled: true, effect: restore(ctx.historyRedo, 'redo') };
      case 'nudge':
        return inConstructor(ctx) ? nudge(state, action, ctx) : { state, handled: false };
      case 'delete':
        return inConstructor(ctx) ? deleteSelected(state, ctx) : { state, handled: false };
    }
  },

  refresh: (state, ctx) => {
    const hover =
      ctx.pointer && inConstructor(ctx)
        ? hoverAt(ctx.pointer, ctx)
        : { hover: state.hover, splitHandle: state.splitHandle };
    const selection = state.selection && !targetAlive(state.selection, ctx) ? null : state.selection;
    // Нажатая цель, исчезнувшая из документа, драг уже не начнёт.
    const pressed =
      state.pressed?.target && !targetAlive(state.pressed.target, ctx)
        ? { ...state.pressed, target: null }
        : state.pressed;
    return { state: update(state, { ...hover, selection, pressed }) };
  },
};
