import { Color, OrthographicCamera, REVISION, Scene, WebGLRenderer } from 'three';

import type { DocumentView, PlanCamera } from '../../document/PlannerDocument';
import type { PlannerLogger, PlannerManager } from '../../engine/PlannerManager';
import { disposeSceneGraph } from './disposeSceneGraph';
import {
  computePlanFrustum,
  PLAN_CAMERA_ELEVATION,
  PLAN_CAMERA_FAR,
  PLAN_CAMERA_NEAR,
  type ViewportSize,
} from './planCamera';
import { PLAN_UP_IN_WORLD, planToWorld } from './planToWorld';
import { ProjectionGate, THREE_VIEWS } from '../ProjectionGate';
import { RenderLoop } from '../RenderLoop';

export interface ThreeProjectionOptions {
  /** Бюджет кадров render-on-demand; дефолт — `FRAME_BUDGET` (`RenderLoop`). */
  frameBudget?: number;
  logger: PlannerLogger;
}

/** Счётчики рендерера для perf/leak-гварда (ADR 0015 A7, testing-strategy слой 3). */
export interface ProjectionStats {
  /** `renderer.info.render.frame` — растёт на каждый отрисованный кадр; в покое стоит (idle FPS ≈ 0). */
  frame: number;
  /** `renderer.info.memory.geometries` — живые геометрии на GPU; после `dispose()` — 0. */
  geometries: number;
  /** `renderer.info.memory.textures` — живые текстуры на GPU; после `dispose()` — 0. */
  textures: number;
}

/**
 * Фон пустой сцены: нейтральный светло-серый (гайдлайн — нейтрали без подтона), чуть темнее фона страницы,
 * чтобы область планера читалась. Плоский свет 2D-плана и свет 3D — ADR G (шаг 4): в шаге 1 источников нет.
 */
const PLAN_BACKGROUND_COLOR = '#ebebeb';

/**
 * Проекция документа в Three (ADR 0015 A7): единственный слой пакета, который трогает `three` и DOM.
 * Один `WebGLRenderer` на переданный canvas, одна `Scene` (шаг 1 — пустая), ортокамера сверху из
 * `Document.view` (камера вида `plan`), `RenderLoop` render-on-demand, `ResizeObserver` на контейнер канваса.
 * Подписана на шину через фасад, документ читает через `manager.view.get()`, в документ не пишет.
 * Маппинг план→мир — только через `planToWorld` (ADR 0016 B1).
 *
 * Шаг 1 показывает камеру вида `plan` при любом `activeView`: конструктор (Canvas2D, Q17) и камеры
 * orbit/walk — свои шаги (2, 4, 9). Стили канвасу не пишет (`setSize(…, false)`): CSS-размер задаёт страница,
 * проекция подстраивает только буфер отрисовки под размер контейнера и `devicePixelRatio`.
 */
export class ThreeProjection {
  /** Ревизия three, с которой собран пакет (ADR 0003 — r185). */
  static readonly threeRevision = REVISION;

  /** Сцена — публична для гвардов слоя 3 (ассерты на scene-graph через `onReady`), не для мутаций извне. */
  readonly scene: Scene;

  private readonly renderer: WebGLRenderer;
  private readonly camera: OrthographicCamera;
  private readonly logger: PlannerLogger;
  private readonly loop: RenderLoop;
  private readonly gate: ProjectionGate;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribe: (() => void)[];
  private viewport: ViewportSize = { width: 0, height: 0 };
  private planCamera: PlanCamera;
  private disposed = false;

  constructor(
    readonly manager: PlannerManager,
    readonly canvas: HTMLCanvasElement,
    { frameBudget, logger }: ThreeProjectionOptions,
  ) {
    this.logger = logger;
    const win = canvas.ownerDocument.defaultView;
    if (!win) throw new Error('@uyutno/planner: canvas must belong to a document with a window');

    // Всё, что может отвергнуть параметры (бюджет кадров), — до создания GL-контекста: иначе он утёк бы.
    this.loop = new RenderLoop({
      render: this.render,
      frameBudget,
      requestAnimationFrame: callback => win.requestAnimationFrame(callback),
      cancelAnimationFrame: handle => win.cancelAnimationFrame(handle),
    });

    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    try {
      this.scene = new Scene();
      this.scene.background = new Color(PLAN_BACKGROUND_COLOR);
      this.camera = new OrthographicCamera(-1, 1, 1, -1, PLAN_CAMERA_NEAR, PLAN_CAMERA_FAR);
      this.camera.up.set(PLAN_UP_IN_WORLD.x, PLAN_UP_IN_WORLD.y, PLAN_UP_IN_WORLD.z);

      this.planCamera = manager.view.get().cameras.plan;
      this.applyCamera();

      // Пока активен конструктор, Three-проекция приостановлена (ADR 0020 P5): `tools:changed` идёт на каждый
      // `pointerMove`, и без приостановки скрытый WebGL-канвас рисовал бы кадр на каждое движение мыши.
      this.gate = new ProjectionGate(THREE_VIEWS, this.loop, manager.view.get().activeView);

      this.unsubscribe = [
        manager.on('view:changed', this.onViewChanged),
        // Любое событие шины (документ, вид, история) — кадр по требованию (ADR 0015 A7).
        manager.subscribe(() => this.gate.invalidate()),
      ];

      // Контейнер канваса — родитель: канвас растянут CSS-ом страницы на весь контейнер, буфер подстраивается
      // под его размер. `device-pixel-content-box` дополнительно будит observer при смене DPR (перенос окна
      // между мониторами); где box не поддерживается — обычное наблюдение CSS-размера.
      const container = canvas.parentElement ?? canvas;
      this.resizeObserver = new win.ResizeObserver(entries => {
        const entry = entries.at(-1);
        if (!entry) return;
        this.resize({ width: entry.contentRect.width, height: entry.contentRect.height }, win.devicePixelRatio);
      });
      try {
        this.resizeObserver.observe(container, { box: 'device-pixel-content-box' });
      } catch {
        this.resizeObserver.observe(container);
      }
    } catch (error) {
      // GL-контекст уже создан — освобождаем, чтобы неудачная инициализация не оставила его висеть.
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      throw error;
    }

    this.logger.debug('@uyutno/planner: ThreeProjection created', { projectId: manager.projectId });
  }

  /** Запросить кадр (render-on-demand). Идемпотентно; после `dispose()` — no-op. */
  invalidate(): void {
    this.gate.invalidate();
  }

  /** Активен ли вид этой проекции (`plan | orbit | walk`) — по нему `<Planner />` скрывает канвас. */
  get isActive(): boolean {
    return this.gate.isActive;
  }

  /** Есть ли запланированный кадр — в покое `false`. */
  get isRendering(): boolean {
    return this.loop.isRunning;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Счётчики рендерера для гварда «idle FPS ≈ 0 / память не течёт» (ADR 0015 A7). */
  getStats(): ProjectionStats {
    const { render, memory } = this.renderer.info;
    return { frame: render.frame, geometries: memory.geometries, textures: memory.textures };
  }

  /**
   * Освобождение в обратном порядке (ADR 0015 A7): подписки → `ResizeObserver` → `rAF` → геометрии/материалы/
   * текстуры сцены → `renderer.dispose()` + `forceContextLoss()`. Повторный вызов — no-op.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const off of this.unsubscribe) off();
    this.resizeObserver.disconnect();
    this.loop.dispose();

    disposeSceneGraph(this.scene);
    this.scene.clear();
    this.scene.background = null;

    this.renderer.dispose();
    this.renderer.forceContextLoss();

    this.logger.debug('@uyutno/planner: ThreeProjection disposed', { projectId: this.manager.projectId });
  }

  /** Новый размер контейнера и/или DPR: буфер рендерера, фрустум под aspect, кадр. */
  private resize(viewport: ViewportSize, devicePixelRatio: number): void {
    if (this.disposed) return;
    this.viewport = viewport;
    this.renderer.setPixelRatio(devicePixelRatio);
    this.renderer.setSize(viewport.width, viewport.height, false);
    this.applyCamera();
    this.gate.invalidate();
  }

  private readonly onViewChanged = (view: DocumentView): void => {
    this.planCamera = view.cameras.plan;
    this.applyCamera();
    this.gate.setActiveView(view.activeView);
  };

  /** Ортокамера сверху из камеры вида `plan`: центр `(x, y)` плана → мир через `planToWorld`, фрустум по зуму и aspect. */
  private applyCamera(): void {
    const { left, right, top, bottom } = computePlanFrustum(this.planCamera, this.viewport);
    this.camera.left = left;
    this.camera.right = right;
    this.camera.top = top;
    this.camera.bottom = bottom;

    const eye = planToWorld(this.planCamera, PLAN_CAMERA_ELEVATION);
    const target = planToWorld(this.planCamera, 0);
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.lookAt(target.x, target.y, target.z);
    this.camera.updateProjectionMatrix();
  }

  /** Кадр. Исключение рендера — в DI-логгер, не наружу из `rAF` (ADR 0015 A2): луп доиграет бюджет и уснёт. */
  private readonly render = (): void => {
    // Остаток бюджета кадров, начатый до ухода на чужой вид, в скрытый канвас не рисуется (ADR 0020 P5).
    if (!this.gate.isActive) return;
    try {
      this.renderer.render(this.scene, this.camera);
    } catch (error) {
      this.logger.error('@uyutno/planner: render failed', error);
    }
  };
}
