import { REVISION } from 'three';

import type { PlannerManager } from '../../engine/PlannerManager';

/**
 * Слой `projection/` — проекции документа во вьюверы; `projection/three/` — одна `Scene`,
 * один `WebGLRenderer`, камеры видов, `RenderLoop` (ADR 0015). Без React — энфорсится ESLint.
 *
 * Заглушка: рендерер, `ResizeObserver`, render-on-demand и `dispose()` сцены — следующая задача шага 1.
 * Модуль-уровневый импорт `three` оставлен намеренно: он исполняется и в SSR-бандле платформы
 * (three бандлится туда by design, ADR 0015 «Что важно знать»), и каркас должен это проверять.
 */
export class ThreeProjection {
  /** Ревизия three, с которой собран пакет (ADR 0003 — r185). */
  static readonly threeRevision = REVISION;

  constructor(
    readonly manager: PlannerManager,
    readonly canvas: HTMLCanvasElement,
  ) {}

  dispose(): void {}
}
