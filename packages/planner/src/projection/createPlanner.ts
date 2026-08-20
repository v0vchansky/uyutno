import { PlannerManager, type PlannerLogger } from '../engine/PlannerManager';
import { Canvas2dProjection } from './canvas2d/Canvas2dProjection';
import { KeyboardInput } from './input/keyboard';
import { ThreeProjection } from './three/ThreeProjection';

/** Два канваса одного планера (ADR 0020 P6): Three снизу, Canvas2D конструктора сверху. */
export interface PlannerCanvases {
  three: HTMLCanvasElement;
  canvas2d: HTMLCanvasElement;
}

/** Параметры фабрики = пропсы `<Planner />` плюс `canvas` (ADR 0015 A7/A8). */
export interface CreatePlannerParams {
  canvas: PlannerCanvases;
  projectId: string;
  logger: PlannerLogger;
  /** Бюджет кадров render-on-demand; дефолт `FRAME_BUDGET = 5` — в `RenderLoop` (ADR 0015 A7). */
  frameBudget?: number;
}

export interface PlannerProjections {
  three: ThreeProjection;
  canvas2d: Canvas2dProjection;
}

export interface PlannerInstance {
  manager: PlannerManager;
  projections: PlannerProjections;
  /** Освобождает клавиатуру, проекции и движок в обратном порядке; повторный вызов — no-op. */
  dispose(): void;
}

/**
 * Композиционный корень планера вне React (ADR 0015 A7, ADR 0020 P6): пустой документ → `PlannerManager` →
 * `ThreeProjection` → `Canvas2dProjection` → владелец клавиатуры. `dispose` — строго обратный:
 * клавиатура → `canvas2d` → `three` → менеджер. Если что-то не поднялось, всё уже поднятое освобождается
 * и ошибка пробрасывается: полуживого планера не остаётся.
 */
export const createPlanner = ({ canvas, projectId, logger, frameBudget }: CreatePlannerParams): PlannerInstance => {
  const manager = new PlannerManager({ projectId, logger });
  const started: (() => void)[] = [() => manager.dispose()];

  const start = <T>(create: () => T): T => {
    try {
      return create();
    } catch (error) {
      for (const stop of started.reverse()) stop();
      throw error;
    }
  };

  const three = start(() => new ThreeProjection(manager, canvas.three, { frameBudget, logger }));
  started.push(() => three.dispose());

  const canvas2d = start(() => new Canvas2dProjection(manager, canvas.canvas2d, { frameBudget, logger }));
  started.push(() => canvas2d.dispose());

  const keyboard = start(() => {
    const view = canvas.canvas2d.ownerDocument.defaultView;
    if (!view) throw new Error('@uyutno/planner: canvas must belong to a document with a window');
    return new KeyboardInput(manager, view, {
      onPan: (dx, dy, factor) => canvas2d.panByKeyboard(dx, dy, factor),
      onPanModifier: pressed => canvas2d.setPanModifier(pressed),
    });
  });

  let disposed = false;
  return {
    manager,
    projections: { three, canvas2d },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      keyboard.dispose();
      canvas2d.dispose();
      three.dispose();
      manager.dispose();
    },
  };
};
