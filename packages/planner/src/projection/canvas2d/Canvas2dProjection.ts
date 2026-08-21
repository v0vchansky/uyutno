import type { Bounds } from '../../document/geometry/predicates/findMinMax';
import type { Viewport } from '../../document/geometry/viewport';
import { viewToPlan } from '../../document/geometry/viewport';
import type { DocumentView, PlanPosition } from '../../document/PlannerDocument';
import type { PlannerLogger, PlannerManager } from '../../engine/PlannerManager';
import type { PointerInput, PointerMods, ToolState } from '../../engine/tools/ToolState';
import { CANVAS2D_VIEWS, ProjectionGate } from '../ProjectionGate';
import { RenderLoop } from '../RenderLoop';
import {
  type CanvasSize,
  centeredCamera,
  type ConstructorCameraState,
  DEFAULT_CAMERA,
  fitCamera,
  NO_INSETS,
  panBy,
  safeFrameOf,
  scaleAt,
  viewportOf,
  type ViewportInsets,
  ZOOM_SCALE_BASE_INDEX,
  ZOOM_SCALE_STEPS,
  zoomStep,
} from './camera';
import { cursorFor } from './cursorFor';
import { type DraftPalette, readDraftPalette } from './draftStyle';
import { drawFrame } from './drawFrame';

/** Шаг пана стрелками, CSS px за нажатие; `factor` из keymap умножает его (Shift — быстрее). */
export const KEYBOARD_PAN_STEP = 40;

/** Основная кнопка указателя и кнопка, которой панорамируют (`PointerEvent.button`). */
const PRIMARY_BUTTON = 0;
const SECONDARY_BUTTON = 2;

/** Inset приходит из чужого слоя: `NaN`/`Infinity`/отрицательное превращаем в `0`, а не в поехавшую камеру. */
const sanitizeInset = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

export interface Canvas2dProjectionOptions {
  /** Бюджет кадров render-on-demand; дефолт — `FRAME_BUDGET` (`RenderLoop`). */
  frameBudget?: number;
  logger: PlannerLogger;
  /**
   * Фабрика 2D-контекста — DI для тестов (ADR 0020 P7): jsdom не даёт `getContext('2d')`.
   * По умолчанию — `canvas.getContext('2d')`.
   */
  getContext?: (canvas: HTMLCanvasElement) => CanvasRenderingContext2D | null;
}

/** Счётчик кадров для perf-гварда — то же имя поля, что у Three-проекции (ADR 0020 P1). */
export interface Canvas2dStats {
  frame: number;
}

/** Текущий шаг дискретной шкалы зума — наружу для контрола «− % +» группы контролов холста (решение 7). */
export interface ZoomState {
  /** Индекс в шкале, `0…steps − 1`. */
  index: number;
  /** Масштаб плана: `1` = 100%. */
  scale: number;
  steps: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

/**
 * Canvas2D-проекция конструктора (ADR 0020): второй `<canvas>` в `<Planner />` с 2D-контекстом. Читает документ,
 * `DerivedFloor` и `ToolState`, **в документ не пишет**; рисует чертёжный вид (`drawFrame`); владеет **всем
 * вводом указателя** канваса (клавиатура — `projection/input/keyboard.ts`, единственный владелец, ADR 0019 E5);
 * держит локальную камеру конструктора (дискретная шкала, пан, зум вокруг курсора) и — единственная — пишет
 * `tools.setViewport`.
 *
 * Канвас лежит во всю ширину контейнера, а панели скина — непрозрачные оверлеи поверх него, поэтому «весь кадр»
 * и «видимая часть кадра» — разные прямоугольники. Второй задаётся снаружи через `setViewportInsets()` (числа
 * знает только скин) и учитывается там, где камера сама выбирает, куда положить план: `fitToContent()`,
 * `resetCamera()`, шаг зума кнопками. Пересчёт экран ↔ план от insets не зависит — канвас-то полноразмерный.
 *
 * Активна при `view.activeView === 'constructor'`; на чужом виде кадров не планирует (`ProjectionGate`).
 * Порядок инициализации — как у `ThreeProjection` (0049): `RenderLoop` → 2D-контекст → подписки → `ResizeObserver`.
 */
export class Canvas2dProjection {
  private readonly logger: PlannerLogger;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly loop: RenderLoop;
  private readonly gate: ProjectionGate;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribe: (() => void)[];
  private readonly zoomListeners = new Set<(zoom: ZoomState) => void>();
  private readonly view: Window;

  private palette: DraftPalette;
  private size: CanvasSize = { width: 0, height: 0 };
  private devicePixelRatio = 1;
  private camera: ConstructorCameraState = { ...DEFAULT_CAMERA };
  private viewport: Viewport;
  /** Части кадра под непрозрачными оверлеями скина; до `setViewportInsets` — весь кадр видимый. */
  private insets: ViewportInsets = { ...NO_INSETS };

  private panPointerId: number | null = null;
  private panButton: number | null = null;
  private panOrigin: PlanPosition | null = null;
  /** Указатель, отданный автомату инструментов: пока он есть, пан не начинается (и наоборот). */
  private toolPointerId: number | null = null;
  private panModifier = false;
  private cursor = '';
  private frame = 0;
  private disposed = false;

  constructor(
    readonly manager: PlannerManager,
    readonly canvas: HTMLCanvasElement,
    { frameBudget, logger, getContext }: Canvas2dProjectionOptions,
  ) {
    this.logger = logger;
    const view = canvas.ownerDocument.defaultView;
    if (!view) throw new Error('@uyutno/planner: canvas must belong to a document with a window');
    this.view = view;

    // Всё, что может отвергнуть параметры (бюджет кадров), — до захвата ресурсов, как в 0049.
    this.loop = new RenderLoop({
      render: this.render,
      frameBudget,
      requestAnimationFrame: callback => view.requestAnimationFrame(callback),
      cancelAnimationFrame: handle => view.cancelAnimationFrame(handle),
    });

    const ctx = (getContext ?? (element => element.getContext('2d')))(canvas);
    if (!ctx) {
      this.loop.dispose();
      throw new Error('@uyutno/planner: canvas 2d context is not available');
    }
    this.ctx = ctx;
    this.palette = readDraftPalette(canvas);
    this.viewport = viewportOf(this.camera, this.size);
    this.gate = new ProjectionGate(CANVAS2D_VIEWS, this.loop, manager.view.get().activeView);

    this.unsubscribe = [
      manager.on('view:changed', this.onViewChanged),
      manager.on('tools:changed', this.onToolsChanged),
      // Документ, история, флаги снапа — любое событие шины требует кадра (ADR 0015 A7, ADR 0020 P5).
      manager.subscribe(() => this.gate.invalidate()),
    ];

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    // `blur` окна — часть ввода вьювера (ADR 0020 P1): при потере фокуса во время драга `pointercancel`
    // приходит не всегда (спека 09 «Blur во время drag»).
    view.addEventListener('blur', this.onWindowBlur);

    // `ResizeObserver` смотрит на родителя канвасов — рамку холста, — а не на сам канвас: неактивный канвас
    // скрыт `hidden` и его rect нулевой (ADR 0020 «Что важно знать»). Содержимое рамки и есть холст: рейл и
    // внешний отступ лежат снаружи неё (задача 0089), в `contentRect` не попадают и кадр не завышают.
    const container = canvas.parentElement ?? canvas;
    this.resizeObserver = new view.ResizeObserver(entries => {
      const entry = entries.at(-1);
      if (!entry) return;
      this.resize({ width: entry.contentRect.width, height: entry.contentRect.height }, view.devicePixelRatio);
    });
    try {
      this.resizeObserver.observe(container, { box: 'device-pixel-content-box' });
    } catch {
      this.resizeObserver.observe(container);
    }

    this.applyCursor(manager.tools.get());
    // Автомат до этого держал `DEFAULT_VIEWPORT`: приводим его к реальному сразу при подъёме, чтобы
    // `getViewport()` и `ToolState.viewport` не расходились до первого колбэка `ResizeObserver` (ADR 0019 E1).
    this.syncViewport();
    this.logger.debug('@uyutno/planner: Canvas2dProjection created', { projectId: manager.projectId });
  }

  /** Запросить кадр. На чужом виде — no-op: приостановленная проекция кадров не планирует (ADR 0020 P5). */
  invalidate(): void {
    this.gate.invalidate();
  }

  get isRendering(): boolean {
    return this.loop.isRunning;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Активен ли конструктор — по нему `<Planner />` скрывает канвас. */
  get isActive(): boolean {
    return this.gate.isActive;
  }

  /** Счётчик отрисованных кадров: в покое не растёт (гвард слоя 3). */
  getStats(): Canvas2dStats {
    return { frame: this.frame };
  }

  /**
   * Текущий viewport, замороженный. По значению совпадает с `ToolState.viewport` — проекция единственная его
   * пишет (`tools.setViewport`), но автомат кладёт в состояние собственную копию, поэтому ссылки разные.
   */
  getViewport(): Viewport {
    return this.viewport;
  }

  /** Текущий шаг шкалы зума (решение 7): контрол «− % +» наполняется, не заглядывая в проекцию. */
  getZoom(): ZoomState {
    const { scaleIndex } = this.camera;
    return {
      index: scaleIndex,
      scale: scaleAt(scaleIndex),
      steps: ZOOM_SCALE_STEPS,
      canZoomIn: scaleIndex < ZOOM_SCALE_STEPS - 1,
      canZoomOut: scaleIndex > 0,
    };
  }

  /** Подписка на смену шага зума (решение 7). Возвращает отписку; после `dispose()` слушатели снимаются. */
  onZoomChanged(listener: (zoom: ZoomState) => void): () => void {
    this.zoomListeners.add(listener);
    return () => this.zoomListeners.delete(listener);
  }

  /**
   * Сообщить, какие полосы кадра закрыты непрозрачными оверлеями скина (рейл, панель инструментов, полоса
   * подсказок с группой контролов). Зовёт **скин** — он один знает свои размеры; проекция про React ничего не
   * знает и чисел панелей не хардкодит. Учитывается в `fitToContent()`, `resetCamera()` и шаге зума кнопками.
   *
   * Уже настроенную камеру не двигает: смена insets — не жест пользователя, а факт раскладки; иначе монтирование
   * панели или уход на чужой вид уводили бы план из-под курсора. Отрицательные и нечисловые значения
   * отбрасываются в `0` — контракт публичный, а кривой inset ломал бы всю арифметику камеры.
   */
  setViewportInsets(insets: Partial<ViewportInsets>): void {
    if (this.disposed) return;
    const next: ViewportInsets = {
      left: sanitizeInset(insets.left ?? this.insets.left),
      right: sanitizeInset(insets.right ?? this.insets.right),
      top: sanitizeInset(insets.top ?? this.insets.top),
      bottom: sanitizeInset(insets.bottom ?? this.insets.bottom),
    };
    if (
      next.left === this.insets.left &&
      next.right === this.insets.right &&
      next.top === this.insets.top &&
      next.bottom === this.insets.bottom
    ) {
      return;
    }
    this.insets = next;
  }

  /** Текущие insets кадра — копия. Нужны тому, кто считает свободную область холста (e2e, оверлеи). */
  getViewportInsets(): ViewportInsets {
    return { ...this.insets };
  }

  /**
   * Шаг зума вокруг центра **видимой** части кадра — кнопки «−»/«+» (0061); `delta` в шагах шкалы.
   * При нулевых insets это ровно центр кадра, то есть поведение до введения insets.
   */
  zoomBy(delta: number): void {
    const safe = safeFrameOf(this.size, this.insets);
    const anchor = { x: this.size.width / 2 + safe.offsetX, y: this.size.height / 2 + safe.offsetY };
    this.setCamera(zoomStep(this.camera, this.size, delta, anchor));
  }

  /**
   * «В центр»: габариты точек этажа с полями → ближайший шаг шкалы, не превышающий fit (ADR 0020 P3).
   * Вписывается в видимую часть кадра, а не под панели скина (`setViewportInsets`).
   */
  fitToContent(): void {
    this.setCamera(fitCamera(this.contentBounds(), this.size, this.insets));
  }

  /**
   * Сброс камеры к дефолту — клик по активной кнопке вида «конструктор» (спека 08): базовый шаг шкалы и начало
   * координат в центре **видимой** части кадра.
   */
  resetCamera(): void {
    this.setCamera(centeredCamera(DEFAULT_CAMERA.center, ZOOM_SCALE_BASE_INDEX, safeFrameOf(this.size, this.insets)));
  }

  /**
   * Пан с клавиатуры: зовётся владельцем клавиатуры, когда автомат не взял `nudge` (нет выделения).
   * `dx`/`dy` — в осях **плана** (`y` вверх). Возвращает `false` вне конструктора — тогда клавиша не наша.
   */
  panByKeyboard(dx: number, dy: number, factor: number): boolean {
    if (this.disposed || !this.gate.isActive) return false;
    const step = KEYBOARD_PAN_STEP * factor;
    this.setCamera(panBy(this.camera, -dx * step, dy * step));
    return true;
  }

  /** Space зажат — ЛКМ панорамирует (ADR 0020 P3). Ставит владелец клавиатуры. */
  setPanModifier(pressed: boolean): void {
    if (this.disposed || this.panModifier === pressed) return;
    this.panModifier = pressed;
    this.applyCursor(this.manager.tools.get());
  }

  /** Освобождение в обратном порядке: DOM-слушатели → подписки шины → `ResizeObserver` → луп. Повторный — no-op. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const { canvas } = this;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('dblclick', this.onDoubleClick);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.view.removeEventListener('blur', this.onWindowBlur);

    // Освобождение посреди жеста: захват указателя снимаем сами, не полагаясь на снятие канваса из DOM.
    if (this.panPointerId !== null) this.canvas.releasePointerCapture?.(this.panPointerId);
    this.panPointerId = null;
    this.panButton = null;
    this.panOrigin = null;
    this.releaseToolPointer();

    for (const off of this.unsubscribe) off();
    this.resizeObserver.disconnect();
    this.loop.dispose();
    this.zoomListeners.clear();

    this.logger.debug('@uyutno/planner: Canvas2dProjection disposed', { projectId: this.manager.projectId });
  }

  // ── Камера и viewport ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * Единственная точка изменения камеры: пересобрать viewport → отдать его автомату (`tools.setViewport` —
   * источник для снапа, куллинга и DOM-оверлея) → уведомить о шаге зума → кадр.
   */
  private setCamera(camera: ConstructorCameraState): void {
    if (this.disposed) return;
    const zoomChanged = camera.scaleIndex !== this.camera.scaleIndex;
    const moved = camera.center.x !== this.camera.center.x || camera.center.y !== this.camera.center.y;
    if (!zoomChanged && !moved) return;
    this.camera = camera;
    this.syncViewport();
    if (zoomChanged) {
      const zoom = this.getZoom();
      for (const listener of this.zoomListeners) listener(zoom);
    }
  }

  private syncViewport(): void {
    this.viewport = viewportOf(this.camera, this.size);
    const result = this.manager.tools.setViewport(this.viewport);
    if (!result.ok) this.logger.warn('@uyutno/planner: viewport rejected', result.error);
    this.gate.invalidate();
  }

  /** Габариты всех точек активного этажа — `null` на пустом холсте. */
  private contentBounds(): Bounds | null {
    const floor = this.manager.document.get().floors[0];
    if (!floor) return null;
    let bounds: Bounds | null = null;
    for (const position of Object.values(floor.layout.points)) {
      bounds = bounds
        ? {
            minX: Math.min(bounds.minX, position.x),
            minY: Math.min(bounds.minY, position.y),
            maxX: Math.max(bounds.maxX, position.x),
            maxY: Math.max(bounds.maxY, position.y),
          }
        : { minX: position.x, minY: position.y, maxX: position.x, maxY: position.y };
    }
    return bounds;
  }

  private resize(size: CanvasSize, devicePixelRatio: number): void {
    if (this.disposed) return;
    this.size = size;
    this.devicePixelRatio = devicePixelRatio;
    // DPR не капится (desktop-only, как 0049): буфер = CSS × DPR.
    this.canvas.width = Math.round(size.width * devicePixelRatio);
    this.canvas.height = Math.round(size.height * devicePixelRatio);
    // Тема статична, но при смене DPR/переносе окна перечитать её дешевле, чем держать отдельный канал.
    this.palette = readDraftPalette(this.canvas);
    this.syncViewport();
  }

  // ── Подписки шины ─────────────────────────────────────────────────────────────────────────────────────────

  private readonly onViewChanged = (view: DocumentView): void => {
    this.gate.setActiveView(view.activeView);
  };

  private readonly onToolsChanged = ({ state }: { state: ToolState }): void => {
    this.applyCursor(state);
  };

  private applyCursor(state: ToolState): void {
    const cursor = cursorFor(state, this.panPointerId !== null || this.panModifier);
    if (cursor === this.cursor) return;
    this.cursor = cursor;
    this.canvas.style.cursor = cursor;
  }

  // ── Ввод указателя ────────────────────────────────────────────────────────────────────────────────────────

  /** Экранные координаты события в CSS px канваса. */
  private screenOf(event: { clientX: number; clientY: number }): PlanPosition {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Ввод указателя в координатах **плана** — единственное место пересчёта экран → план (ADR 0020 P4). */
  private inputOf(event: PointerEvent | MouseEvent, button: number): PointerInput {
    const plan = viewToPlan(this.viewport, this.screenOf(event));
    const mods: PointerMods = {
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
      alt: event.altKey,
    };
    return { x: plan.x, y: plan.y, mods, button };
  }

  /**
   * У мыши `pointerId` один на все кнопки, поэтому пан и жест автомата разводятся **взаимным исключением**:
   * пока указатель отдан автомату, ПКМ пан не начинает, и наоборот. Иначе ЛКМ-драг + ПКМ дали бы `endPan` на
   * отпускании ЛКМ, а `tools.pointerUp` не пришёл бы вовсе — автомат завис бы в `dragging-*` до Esc.
   */
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.disposed) return;
    const isPan = event.button === SECONDARY_BUTTON || (event.button === PRIMARY_BUTTON && this.panModifier);
    if (isPan) {
      if (this.panPointerId !== null || this.toolPointerId !== null) return;
      this.panPointerId = event.pointerId;
      this.panButton = event.button;
      this.panOrigin = this.screenOf(event);
      this.canvas.setPointerCapture?.(event.pointerId);
      this.applyCursor(this.manager.tools.get());
      event.preventDefault();
      return;
    }
    if (event.button !== PRIMARY_BUTTON || this.panPointerId !== null || this.toolPointerId !== null) return;
    // Драг не должен теряться за краем канваса (ADR 0019 E5).
    this.toolPointerId = event.pointerId;
    this.canvas.setPointerCapture?.(event.pointerId);
    this.manager.tools.pointerDown(this.inputOf(event, event.button));
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.disposed) return;
    if (this.panPointerId === event.pointerId && this.panOrigin) {
      const screen = this.screenOf(event);
      this.setCamera(panBy(this.camera, screen.x - this.panOrigin.x, screen.y - this.panOrigin.y));
      this.panOrigin = screen;
      return;
    }
    this.manager.tools.pointerMove(this.inputOf(event, event.button));
  };

  /** Пан завершает **та же кнопка**, которой начат: отпускание другой кнопки его не трогает. */
  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.disposed) return;
    if (this.panPointerId === event.pointerId && this.panButton === event.button) {
      this.endPan();
      return;
    }
    if (this.toolPointerId !== event.pointerId || event.button !== PRIMARY_BUTTON) return;
    this.releaseToolPointer();
    this.manager.tools.pointerUp(this.inputOf(event, event.button));
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.disposed) return;
    if (this.panPointerId === event.pointerId) {
      this.endPan();
      return;
    }
    if (this.toolPointerId !== event.pointerId) return;
    this.releaseToolPointer();
    this.manager.tools.pointerCancel();
  };

  private endPan(): void {
    if (this.panPointerId !== null) this.canvas.releasePointerCapture?.(this.panPointerId);
    this.panPointerId = null;
    this.panButton = null;
    this.panOrigin = null;
    this.applyCursor(this.manager.tools.get());
  }

  private readonly onDoubleClick = (event: MouseEvent): void => {
    if (this.disposed) return;
    this.manager.tools.doubleClick(this.inputOf(event, PRIMARY_BUTTON));
  };

  /** Колесо — шаг индекса ±1 **вокруг курсора**: точка плана под курсором остаётся под ним (ADR 0020 P3). */
  private readonly onWheel = (event: WheelEvent): void => {
    if (this.disposed) return;
    event.preventDefault();
    if (event.deltaY === 0) return;
    this.setCamera(zoomStep(this.camera, this.size, event.deltaY < 0 ? 1 : -1, this.screenOf(event)));
  };

  /**
   * Потеря фокуса окна: жест прерывается без коммита, пан отменяется (ADR 0019 E5). Захват указателя снимается
   * здесь же — `pointerup` с тем же `pointerId` после alt-tab может не прийти вовсе, и тогда холст остался бы
   * с «занятым» указателем: гард взаимного исключения не пускал бы ни новый жест, ни пан.
   */
  private readonly onWindowBlur = (): void => {
    if (this.disposed) return;
    this.endPan();
    this.releaseToolPointer();
    this.manager.tools.blur();
  };

  private releaseToolPointer(): void {
    if (this.toolPointerId === null) return;
    this.canvas.releasePointerCapture?.(this.toolPointerId);
    this.toolPointerId = null;
  }

  /** ПКМ панорамирует — системного меню на холсте нет (ADR 0020 P3). */
  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  // ── Кадр ──────────────────────────────────────────────────────────────────────────────────────────────────

  private readonly render = (): void => {
    // Остаток бюджета кадров, начатый до ухода на чужой вид, в скрытый канвас не рисуется (ADR 0020 P5).
    if (!this.gate.isActive) return;
    const floor = this.manager.document.get().floors[0];
    if (!floor) return;
    try {
      drawFrame(this.ctx, {
        layout: floor.layout,
        derived: this.manager.document.getDerived().floors[0] ?? null,
        tools: this.manager.tools.get(),
        viewport: this.viewport,
        palette: this.palette,
        devicePixelRatio: this.devicePixelRatio,
      });
      this.frame += 1;
    } catch (error) {
      this.logger.error('@uyutno/planner: canvas2d render failed', error);
    }
  };
}
