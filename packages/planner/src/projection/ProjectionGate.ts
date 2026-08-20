import type { ViewKind } from '../document/PlannerDocument';
import type { RenderLoop } from './RenderLoop';

/**
 * Виды, которые рисует Three-проекция (ADR 0020 P5). Конструктор — не её вид.
 */
export const THREE_VIEWS: readonly ViewKind[] = Object.freeze(['plan', 'orbit', 'walk']);

/** Виды Canvas2D-проекции конструктора (ADR 0020 P5). */
export const CANVAS2D_VIEWS: readonly ViewKind[] = Object.freeze(['constructor']);

/**
 * Взаимная приостановка проекций (ADR 0020 P5): у каждой проекции есть набор «своих» видов; пока активен чужой
 * вид, `invalidate()` кадров не планирует — иначе `tools:changed` на каждом `pointerMove` в конструкторе гонял бы
 * скрытый WebGL-канвас и гвард «idle FPS ≈ 0» терял бы смысл. Приостановленная проекция могла пропустить любое
 * число изменений, поэтому вход в свой вид всегда стоит одного `invalidate()` — считать пропуски незачем.
 *
 * Канвас неактивной проекции скрывает React (`hidden`), но `ResizeObserver` смотрит на контейнер, а не на канвас,
 * поэтому буферы от скрытия не обнуляются (ADR 0020 «Что важно знать»).
 */
export class ProjectionGate {
  private active: boolean;

  constructor(
    private readonly views: readonly ViewKind[],
    private readonly loop: RenderLoop,
    activeView: ViewKind,
  ) {
    this.active = this.views.includes(activeView);
  }

  /** Активен ли сейчас вид этой проекции. */
  get isActive(): boolean {
    return this.active;
  }

  /** Кадр по требованию: на чужом виде — no-op. */
  invalidate(): void {
    if (this.active) this.loop.invalidate();
  }

  /** Смена активного вида: вход в свой вид — ровно один кадр, уход — ничего (остаток бюджета кадров пуст). */
  setActiveView(view: ViewKind): void {
    const active = this.views.includes(view);
    if (active === this.active) return;
    this.active = active;
    if (active) this.loop.invalidate();
  }
}
