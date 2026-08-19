import type { SnapFlags } from '../../document/geometry/snap/getSnapPoint';
import type { Viewport } from '../../document/geometry/viewport';
import type { Id } from '../../document/id';
import type { PlannerDocument, PlanPosition } from '../../document/PlannerDocument';
import type { AddContoursError, ContourInput } from '../commands/addContours';
import type { DeletePointError } from '../commands/deletePoint';
import type { MovePointsError, MovePointsOptions, PointMove } from '../commands/movePoints';
import type { HistoryError } from '../history/HistoryLog';
import type { PlannerLogger } from '../PlannerManager';
import type { DerivedFloor } from '../rebuild';
import type { Result } from '../Result';
import type { SnapIndex } from '../SnapCandidateIndex';
import type { EditingState, HitTarget, KeyAction, PointerInput, ToolVariant } from './ToolState';

/**
 * Окружение обработчика состояния (ADR 0019 E1): снимки документа/viewport/флагов, индекс кандидатов снапа и
 * команды движка. Обработчики — чистые функции над состоянием и окружением; побочные вызовы (команды, история)
 * возвращаются как `effect` и выполняются автоматом **после** перехода — так синхронные события транзакции
 * (`document:changed`, хук `beforeReplace`) застают автомат уже в новом состоянии, реентерабельных переходов нет.
 */
export interface ToolContext {
  document: PlannerDocument;
  /** Активный этаж (v0 — единственный); `null` — этажей нет. */
  floorId: Id | null;
  /** Производное активного этажа последнего rebuild (комнаты — для хит-теста); `null` — этажа нет. */
  derived: DerivedFloor | null;
  viewport: Viewport;
  snapFlags: SnapFlags;
  /** Последний известный ввод указателя (для пересчёта снапа при смене флагов/viewport/документа). */
  pointer: PointerInput | null;
  /** Индекс кандидатов снапа активного этажа (пустой, если этажа нет). */
  snapIndex(): SnapIndex;
  addContours(floorId: Id, contours: readonly ContourInput[]): Result<void, AddContoursError>;
  movePoints(floorId: Id, moves: readonly PointMove[], options?: MovePointsOptions): Result<void, MovePointsError>;
  deletePoint(floorId: Id, id: Id): Result<void, DeletePointError>;
  historyUndo(): Result<void, HistoryError>;
  historyRedo(): Result<void, HistoryError>;
  logger: PlannerLogger;
}

/** Результат шага: следующее состояние (та же ссылка — изменения нет) и отложенный побочный вызов. */
export interface Step {
  state: ToolVariant;
  effect?: () => void;
}

export interface KeyStep extends Step {
  /** Потребил ли автомат действие клавиши; `false` → вьювер решает сам (панорамирование стрелками, ADR 0019 E5). */
  handled: boolean;
}

/** Шаг постановки точки: `rejected` — точка молча проигнорирована гардом входа (инпут длины получает причину). */
export interface PlaceStep extends Step {
  rejected?: 'too-short' | 'duplicate-point';
}

/** Действия клавиш, доходящие до обработчика: `cancel` автомат обрабатывает сам (= `cancel()`), в обработчик не идёт. */
export type HandlerKeyAction = Exclude<KeyAction, { kind: 'cancel' }>;

/**
 * Обработчик одного состояния автомата — таблица переходов на discriminated union без классов состояний
 * (ADR 0019 E1). Возврат той же ссылки `state` = no-op (события нет). Обязательны отмена, прерывания (жест, хук,
 * выход из конструктора) и клавиши; остальные команды по умолчанию — no-op. Новое состояние = новый член union +
 * обработчик в таблице `HANDLERS` (и стартер в `STARTERS` для инструментов рисования), автомат не меняется.
 */
export interface ToolHandler<S extends ToolVariant> {
  pointerDown?(state: S, input: PointerInput, ctx: ToolContext): Step;
  pointerMove?(state: S, input: PointerInput, ctx: ToolContext): Step;
  pointerUp?(state: S, input: PointerInput, ctx: ToolContext): Step;
  doubleClick?(state: S, input: PointerInput, ctx: ToolContext): Step;
  /** `pointercancel` и `blur` окна: жест с зажатой кнопкой прерывается без коммита (спека 09); рисование точек не рвёт. */
  pointerCancel(state: S, ctx: ToolContext): Step;
  /** Esc: отмена жеста/рисования без коммита; в `editing` — снятие выделения. */
  cancel(state: S, ctx: ToolContext): Step;
  /**
   * Хук `beforeReplace` (undo/redo/`load`): отмена + сброс hover/выделения → `editing`. Зовётся до замены документа —
   * решения по документу не принимать (ADR 0018 D9).
   */
  interrupt(state: S, ctx: ToolContext): EditingState;
  /** `view:changed` на вид ≠ `constructor`: жест/рисование отменяется, выделение сохраняется (спека 08). */
  leaveConstructor(state: S, ctx: ToolContext): EditingState;
  key(state: S, action: HandlerKeyAction, ctx: ToolContext): KeyStep;
  /** Постановка точки из инпута длины (Q27) без снапа; вне рисования — не определено (`not-drawing`). */
  commitPoint?(state: S, point: PlanPosition, ctx: ToolContext): PlaceStep;
  /** Окружение изменилось (viewport, флаги снапа, документ): пересчёт производного от последнего ввода. */
  refresh?(state: S, ctx: ToolContext): Step;
  /**
   * Действующее выделение конструктора в этом состоянии — для `breakSeries` при его смене (ADR 0018 D5), сравнение
   * по ссылке. По умолчанию: `editing.selection`, у остальных — нет; драг переопределяет (та же ссылка цели, что в
   * `editing`), чтобы вход в жест и выход из него серию не рвали.
   */
  selectionOf?(state: S): HitTarget | null;
}

export type ToolHandlers = { [K in ToolVariant['kind']]: ToolHandler<Extract<ToolVariant, { kind: K }>> };
