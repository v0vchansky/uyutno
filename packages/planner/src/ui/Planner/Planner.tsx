import type React from 'react';
import { useEffect, useRef } from 'react';

import type { PlannerLogger } from '../engine/PlannerManager';
import { createPlanner } from '../projection/createPlanner';

/** Пропсы = DI-контракт с платформой (ADR 0015 A8): `projectId`, `logger`; canvas создаёт сам компонент. */
export interface PlannerProps {
  projectId: string;
  logger: PlannerLogger;
  className?: string;
}

/**
 * Тонкая обёртка над фабрикой (ADR 0015 A7): рендерит `<canvas>`, в `useEffect` поднимает планер,
 * на unmount зовёт `dispose()`. Единственный слой пакета с React. `PlannerContext`, `usePlannerSelector`,
 * панели — следующие задачи шага 1.
 */
export const Planner: React.FC<PlannerProps> = ({ projectId, logger, className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const planner = createPlanner({ canvas, projectId, logger });
    return () => planner.dispose();
  }, [projectId, logger]);

  return <canvas ref={canvasRef} className={className} />;
};
