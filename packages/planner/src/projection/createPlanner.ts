import { PlannerManager, type PlannerLogger } from '../engine/PlannerManager';
import { ThreeProjection } from './three/ThreeProjection';

/** Параметры фабрики = пропсы `<Planner />` плюс `canvas` (ADR 0015 A7/A8). */
export interface CreatePlannerParams {
  canvas: HTMLCanvasElement;
  projectId: string;
  logger: PlannerLogger;
  /** Бюджет кадров render-on-demand; дефолт — в проекции (ADR 0015 A7). */
  frameBudget?: number;
}

export interface PlannerInstance {
  manager: PlannerManager;
  projection: ThreeProjection;
  dispose(): void;
}

/**
 * Композиционный корень планера вне React (ADR 0015 A7): документ → `PlannerManager` → `ThreeProjection`.
 * `dispose()` — в обратном порядке. Заглушка: реальная сборка движка и проекции — следующие задачи шага 1.
 */
export const createPlanner = ({ canvas, projectId, logger }: CreatePlannerParams): PlannerInstance => {
  const manager = new PlannerManager({ projectId, logger });
  const projection = new ThreeProjection(manager, canvas);

  return {
    manager,
    projection,
    dispose: () => {
      projection.dispose();
      manager.dispose();
    },
  };
};
