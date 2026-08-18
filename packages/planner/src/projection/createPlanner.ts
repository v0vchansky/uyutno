import { PlannerManager, type PlannerLogger } from '../engine/PlannerManager';
import { ThreeProjection } from './three/ThreeProjection';

/** Параметры фабрики = пропсы `<Planner />` плюс `canvas` (ADR 0015 A7/A8). */
export interface CreatePlannerParams {
  canvas: HTMLCanvasElement;
  projectId: string;
  logger: PlannerLogger;
  /** Бюджет кадров render-on-demand; дефолт `FRAME_BUDGET = 5` — в `RenderLoop` (ADR 0015 A7). */
  frameBudget?: number;
}

export interface PlannerInstance {
  manager: PlannerManager;
  projection: ThreeProjection;
  /** Освобождает проекцию и движок в обратном порядке; повторный вызов — no-op. */
  dispose(): void;
}

/**
 * Композиционный корень планера вне React (ADR 0015 A7): пустой документ → `PlannerManager` →
 * `ThreeProjection(manager, canvas)`. Единственная точка создания — `<Planner />` зовёт её же.
 * Если проекция не поднялась (нет WebGL-контекста), движок освобождается и ошибка пробрасывается:
 * полуживого планера не остаётся.
 */
export const createPlanner = ({ canvas, projectId, logger, frameBudget }: CreatePlannerParams): PlannerInstance => {
  const manager = new PlannerManager({ projectId, logger });

  let projection: ThreeProjection;
  try {
    projection = new ThreeProjection(manager, canvas, { frameBudget, logger });
  } catch (error) {
    manager.dispose();
    throw error;
  }

  let disposed = false;
  return {
    manager,
    projection,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      projection.dispose();
      manager.dispose();
    },
  };
};
