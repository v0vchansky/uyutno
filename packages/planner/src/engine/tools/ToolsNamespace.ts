import { freeze } from 'immer';

import { DEFAULT_SNAP_FLAGS, type SnapFlags } from '../../document/geometry/snap/getSnapPoint';
import type { Viewport } from '../../document/geometry/viewport';
import type { Id } from '../../document/id';
import type { PlanPosition } from '../../document/PlannerDocument';
import { addContours } from '../commands/addContours';
import { deletePoint } from '../commands/deletePoint';
import { movePoints } from '../commands/movePoints';
import type { PlannerBus } from '../PlannerBus';
import type { PlannerLogger } from '../PlannerManager';
import type { PlannerStore } from '../PlannerStore';
import { err, ok, type Result } from '../../document/Result';
import { SnapCandidateIndex, type SnapIndex } from '../SnapCandidateIndex';
import { draggingPointHandler } from './draggingPoint';
import { draggingWallHandler } from './draggingWall';
import { editingHandler } from './editing';
import { makingRectHandler, startMakingRect } from './makingRect';
import { makingRoomHandler, startMakingRoom } from './makingRoom';
import { makingWallsHandler, startMakingWalls } from './makingWalls';
import type { KeyStep, Step, ToolContext, ToolHandler, ToolHandlers } from './ToolHandler';
import {
  createEditingState,
  DEFAULT_VIEWPORT,
  type DrawingTool,
  type HitTarget,
  type KeyAction,
  type PointerInput,
  type ToolState,
  type ToolVariant,
} from './ToolState';

export type StartToolError =
  /** Инструмент не из списка шага 2 (`'walls' | 'rect' | 'room'`). */
  | { kind: 'unknown-tool'; tool: unknown }
  /** Рисование — только в конструкторе (`view.activeView === 'constructor'`, спека 08). */
  | { kind: 'view-not-constructor'; view: string }
  /** В документе нет этажей — ставить контур некуда. */
  | { kind: 'no-active-floor' };

export type CommitPointError =
  /** Не конечная координата. */
  | { kind: 'invalid-point'; point: unknown }
  /** Автомат не в состоянии рисования — точку ставить некуда. */
  | { kind: 'not-drawing'; state: ToolVariant['kind'] }
  /** Ребро (сторона прямоугольника) короче `MIN_WALL_LENGTH` (спека 01 «Ограничения»); точка не поставлена, состояние не изменилось. */
  | { kind: 'too-short' }
  /** Точка совпала с уже поставленной (углом `origin`); не поставлена. */
  | { kind: 'duplicate-point' };

export type SetDraftPointError =
  /** Не конечная координата. */
  | { kind: 'invalid-point'; point: unknown }
  /** Автомат не в состоянии рисования с зафиксированными точками — двигать нечего. */
  | { kind: 'not-drawing'; state: ToolVariant['kind'] }
  /** Такой зафиксированной точки в рисуемом контуре нет (индекс вне `[0, points.length − 1]`). */
  | { kind: 'unknown-draft-point'; index: number }
  /** Ребро до соседа по контуру стало бы короче `MIN_WALL_LENGTH` (спека 01 «Ограничения»); точка не сдвинута. */
  | { kind: 'too-short' }
  /** Новая координата совпала с другой зафиксированной точкой контура; точка не сдвинута. */
  | { kind: 'duplicate-point' };

export type SetViewportError = { kind: 'invalid-viewport'; field: string; value: unknown };

/** Таблица обработчиков по `kind` — единственное место, где новое состояние регистрируется в автомате. */
const HANDLERS: ToolHandlers = {
  editing: editingHandler,
  'making-walls': makingWallsHandler,
  'making-rect': makingRectHandler,
  'making-room': makingRoomHandler,
  'dragging-point': draggingPointHandler,
  'dragging-wall': draggingWallHandler,
};

/** Стартовые состояния инструментов рисования по имени (`tools.start`). */
const STARTERS: Record<DrawingTool, (ctx: ToolContext) => ToolVariant> = {
  walls: startMakingWalls,
  rect: startMakingRect,
  room: startMakingRoom,
};

const handlerOf = <S extends ToolVariant>(state: S): ToolHandler<S> => HANDLERS[state.kind] as ToolHandler<S>;

const selectionOf = (state: ToolVariant): HitTarget | null => {
  const handler = handlerOf(state);
  if (handler.selectionOf) return handler.selectionOf(state);
  return state.kind === 'editing' ? state.selection : null;
};

const isFiniteInput = (input: PointerInput): boolean => Number.isFinite(input.x) && Number.isFinite(input.y);

const sameViewport = (a: Viewport, b: Viewport): boolean =>
  a.scale === b.scale &&
  a.center.x === b.center.x &&
  a.center.y === b.center.y &&
  a.width === b.width &&
  a.height === b.height;

/**
 * Неймспейс `tools` фасада (ADR 0015 A2, ADR 0019 E1): один типизированный автомат инструментов конструктора на
 * discriminated union `ToolState`, своя машина без `xstate`. Ввод — команды с координатами **плана** (DOM и
 * экран → план — вьювер, ADR 0020); флаги снапа и viewport — здесь же (не документ). Единственная точка перехода —
 * `transition`: новое замороженное состояние → `breakSeries` при смене выделения (ADR 0018 D5) → `tools:changed`
 * ровно на каждое изменение (включая `pointerMove`), ни одного на no-op → отложенные побочные вызовы (команды
 * документа, история). Документ до коммита не трогается: превью и локальные стеки живут в состоянии (ADR 0018 D8).
 * Внешние события: `beforeReplace` (undo/redo/`load`) → `interrupt()`; `view:changed` вне конструктора → отмена
 * жеста с сохранением выделения; `document:changed` → пересчёт снапа по свежему индексу кандидатов.
 */
export class ToolsNamespace {
  /** Текущий член union — то, что видят обработчики; `state` — замороженная композиция с общими полями. */
  private current: ToolVariant = createEditingState();
  private state: ToolState;
  private snapFlags: SnapFlags = DEFAULT_SNAP_FLAGS;
  private viewport: Viewport = DEFAULT_VIEWPORT;
  /** Последний ввод указателя — для пересчёта снапа при смене флагов/viewport/документа и фильтра дублей. */
  private pointer: PointerInput | null = null;
  private readonly index = new SnapCandidateIndex();
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    private readonly store: PlannerStore,
    private readonly bus: PlannerBus,
    private readonly logger: PlannerLogger,
  ) {
    this.state = freeze(this.compose(this.current), true);
    // Подписки изолированы, как в `PlannerManager.on`: исключение здесь иначе вылетело бы из чужой транзакции.
    const onView = this.guarded(() => {
      if (this.store.getDocument().view.activeView === 'constructor') return;
      const variant = this.current;
      this.transition({ state: handlerOf(variant).leaveConstructor(variant, this.context()) });
    });
    const onDocument = this.guarded(() => this.refresh());
    bus.on('view:changed', onView);
    bus.on('document:changed', onDocument);
    this.unsubscribe.push(
      () => bus.off('view:changed', onView),
      () => bus.off('document:changed', onDocument),
    );
  }

  /** Замороженный снимок состояния автомата; ссылка стабильна между переходами. */
  get(): ToolState {
    return this.state;
  }

  // --- Инструменты -----------------------------------------------------------------------------------

  /**
   * Включает инструмент рисования. Из рисования/жеста — отмена текущего без коммита и старт нового одним переходом
   * (ADR 0019: «смена инструмента посреди рисования = `cancel()` + `start`»); выделение конструктора при этом
   * снимается (режим рисования и выделение взаимоисключающие). Только в конструкторе.
   */
  start(tool: DrawingTool): Result<void, StartToolError> {
    const starter = Object.hasOwn(STARTERS, tool) ? STARTERS[tool] : undefined;
    if (!starter) return err({ kind: 'unknown-tool', tool });
    const view = this.store.getDocument().view.activeView;
    if (view !== 'constructor') return err({ kind: 'view-not-constructor', view });
    const ctx = this.context();
    if (ctx.floorId === null) return err({ kind: 'no-active-floor' });
    this.transition({ state: starter(ctx) });
    return ok(undefined);
  }

  /** Esc: рисование/жест отменяется без коммита → `editing`; в `editing` — снятие выделения (спека 06). */
  cancel(): void {
    const variant = this.current;
    this.transition(handlerOf(variant).cancel(variant, this.context()));
  }

  /**
   * Прерывание извне (хук `beforeReplace` перед undo/redo/`load`, ADR 0018 D9): отмена жеста/рисования без коммита
   * и сброс hover/выделения → `editing`. Документ не читается — хук зовётся до замены.
   */
  interrupt(): void {
    const variant = this.current;
    this.transition({ state: handlerOf(variant).interrupt(variant, this.context()) });
  }

  // --- Указатель (координаты плана) --------------------------------------------------------------------

  pointerDown(input: PointerInput): void {
    this.pointerCommand(input, (handler, variant, ctx) => handler.pointerDown?.(variant, input, ctx));
  }

  pointerMove(input: PointerInput): void {
    this.pointerCommand(input, (handler, variant, ctx) => handler.pointerMove?.(variant, input, ctx));
  }

  pointerUp(input: PointerInput): void {
    this.pointerCommand(input, (handler, variant, ctx) => handler.pointerUp?.(variant, input, ctx));
  }

  doubleClick(input: PointerInput): void {
    this.pointerCommand(input, (handler, variant, ctx) => handler.doubleClick?.(variant, input, ctx));
  }

  /** `pointercancel` браузера: жест с зажатой кнопкой прерывается без коммита; рисование точек не рвёт (ADR 0019 «Что важно знать»). */
  pointerCancel(): void {
    const variant = this.current;
    this.transition(handlerOf(variant).pointerCancel(variant, this.context()));
  }

  /** `blur` окна: как `pointerCancel` (спека 09 «Blur вкладки во время drag»). */
  blur(): void {
    this.pointerCancel();
  }

  /**
   * Постановка точки из инпута длины (Q27): без снапа, правило замыкания — как у клика. Точка, отвергнутая гардом
   * входа (`too-short`, `duplicate-point`), — ошибка результата (инпут покажет), состояние не меняется.
   */
  commitPoint(point: PlanPosition): Result<void, CommitPointError> {
    if (typeof point !== 'object' || point === null || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return err({ kind: 'invalid-point', point });
    }
    const variant = this.current;
    const handler = handlerOf(variant);
    if (!handler.commitPoint) return err({ kind: 'not-drawing', state: variant.kind });
    const step = handler.commitPoint(variant, { x: point.x, y: point.y }, this.context());
    this.transition(step);
    return step.rejected ? err({ kind: step.rejected }) : ok(undefined);
  }

  /**
   * Сдвиг зафиксированной точки рисуемого контура (спека 07, второй инпут длины при рисовании): точка ставится
   * ровно в переданную координату, без снапа — как `commitPoint`. Один вызов = один шаг локального стека
   * undo/redo рисования (ADR 0018 D8): оверлей зовёт команду на подтверждении (Enter / blur / Tab), а не на
   * каждый символ. `making-rect` точек не хранит (оба его поля правят живой угол и коммитятся `commitPoint`),
   * поэтому там команда не определена.
   */
  setDraftPoint(index: number, point: PlanPosition): Result<void, SetDraftPointError> {
    if (typeof point !== 'object' || point === null || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return err({ kind: 'invalid-point', point });
    }
    const variant = this.current;
    const handler = handlerOf(variant);
    if (!handler.setDraftPoint) return err({ kind: 'not-drawing', state: variant.kind });
    // Границы индекса — здесь: `points` есть ровно у состояний с этой командой, а шаг обработчика ничего бы не
    // менял, и `PlaceStep.rejected` не пришлось бы расширять вариантом «нет такой точки».
    const points = variant.kind === 'making-walls' || variant.kind === 'making-room' ? variant.points : [];
    if (!Number.isInteger(index) || index < 0 || index >= points.length) {
      return err({ kind: 'unknown-draft-point', index });
    }
    const step = handler.setDraftPoint(variant, index, { x: point.x, y: point.y }, this.context());
    this.transition(step);
    return step.rejected ? err({ kind: step.rejected }) : ok(undefined);
  }

  // --- Клавиатура и панель ------------------------------------------------------------------------------

  /**
   * Действие клавиши или кнопки панели (ADR 0019 E5): смысл определяет состояние — в рисовании undo/redo идут в
   * локальный стек, в `editing` — в историю документа. `{ handled: false }` — автомат действие не потребил
   * (стрелки без выделения → вьювер панорамирует).
   */
  key(action: KeyAction): { handled: boolean } {
    if (action.kind === 'cancel') {
      this.cancel();
      return { handled: true };
    }
    const variant = this.current;
    const step: KeyStep = handlerOf(variant).key(variant, action, this.context());
    this.transition(step);
    return { handled: step.handled };
  }

  // --- Снап и viewport ---------------------------------------------------------------------------------

  /** Тумблеры снапа панели (спека 01 «Флаги в UI»): состояние `tools`, не документ; в рисовании снап пересчитывается. */
  setSnapFlags(patch: Partial<SnapFlags>): void {
    const next: SnapFlags = { ...this.snapFlags };
    let changed = false;
    for (const key of Object.keys(DEFAULT_SNAP_FLAGS) as (keyof SnapFlags)[]) {
      const value = patch[key];
      if (typeof value === 'boolean' && value !== next[key]) {
        next[key] = value;
        changed = true;
      }
    }
    if (!changed) return;
    this.snapFlags = next;
    this.refresh(true);
  }

  /** Видимая область от вьювера (ADR 0020 P4): `scale > 0`, размеры ≥ 0, всё конечное; равный viewport — no-op. */
  setViewport(viewport: Viewport): Result<void, SetViewportError> {
    const invalid = validateViewport(viewport);
    if (invalid) return err(invalid);
    if (sameViewport(this.viewport, viewport)) return ok(undefined);
    this.viewport = {
      scale: viewport.scale,
      center: { x: viewport.center.x, y: viewport.center.y },
      width: viewport.width,
      height: viewport.height,
    };
    this.refresh(true);
    return ok(undefined);
  }

  /** Снимает подписки на шину; вызывает `PlannerManager.dispose()`. */
  dispose(): void {
    for (const off of this.unsubscribe.splice(0)) off();
  }

  // --- Внутреннее ---------------------------------------------------------------------------------------

  private guarded(run: () => void): () => void {
    return () => {
      try {
        run();
      } catch (error) {
        this.logger.error('@uyutno/planner: tools subscriber threw', error);
      }
    };
  }

  private compose(variant: ToolVariant): ToolState {
    return { snapFlags: this.snapFlags, viewport: this.viewport, ...variant };
  }

  private context(): ToolContext {
    const document = this.store.getDocument();
    const floorId: Id | null = document.floors[0]?.id ?? null;
    const derived = this.store.getDerived().floors.find(floor => floor.id === floorId) ?? null;
    return {
      document,
      floorId,
      derived,
      viewport: this.viewport,
      snapFlags: this.snapFlags,
      pointer: this.pointer,
      snapIndex: (): SnapIndex => this.index.get(document, floorId ?? ''),
      addContours: (id, contours) => addContours(this.store, id, contours),
      movePoints: (id, moves, options) => movePoints(this.store, id, moves, options),
      deletePoint: (id, pointId) => deletePoint(this.store, id, pointId),
      historyUndo: () => this.store.restore('undo'),
      historyRedo: () => this.store.restore('redo'),
      logger: this.logger,
    };
  }

  private pointerCommand(
    input: PointerInput,
    run: (handler: ToolHandler<ToolVariant>, variant: ToolVariant, ctx: ToolContext) => Step | undefined,
  ): void {
    if (!isFiniteInput(input)) return;
    // Снимок ввода — plain-копия: вьювер может переиспользовать свой объект события.
    this.pointer = { x: input.x, y: input.y, mods: { ...input.mods }, button: input.button };
    const variant = this.current;
    this.transition(run(handlerOf(variant), variant, this.context()) ?? { state: variant });
  }

  /** Окружение изменилось: пересчёт производного текущего состояния; `force` — общие поля сменились, событие обязательно. */
  private refresh(force = false): void {
    const variant = this.current;
    const step = handlerOf(variant).refresh?.(variant, this.context()) ?? { state: variant };
    this.transition(step, force);
  }

  /**
   * Единственная точка перехода (ADR 0019 E1): та же ссылка варианта без `force` — no-op; иначе новое замороженное
   * состояние → `breakSeries` при смене выделения → `tools:changed` → отложенный побочный вызов шага.
   */
  private transition(step: Step, force = false): void {
    const prevVariant = this.current;
    if (step.state !== prevVariant || force) {
      const next = freeze(this.compose(step.state), true);
      this.current = step.state;
      this.state = next;
      if (selectionOf(prevVariant) !== selectionOf(step.state)) this.store.breakSeries();
      this.bus.emit('tools:changed', { state: next });
    }
    step.effect?.();
  }
}

const validateViewport = (viewport: Viewport): SetViewportError | null => {
  if (typeof viewport !== 'object' || viewport === null)
    return { kind: 'invalid-viewport', field: 'viewport', value: viewport };
  const { scale, center, width, height } = viewport;
  if (!(Number.isFinite(scale) && scale > 0)) return { kind: 'invalid-viewport', field: 'scale', value: scale };
  if (typeof center !== 'object' || center === null || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    return { kind: 'invalid-viewport', field: 'center', value: center };
  }
  if (!(Number.isFinite(width) && width >= 0)) return { kind: 'invalid-viewport', field: 'width', value: width };
  if (!(Number.isFinite(height) && height >= 0)) return { kind: 'invalid-viewport', field: 'height', value: height };
  return null;
};
