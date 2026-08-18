import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import type { PlannerLogger, PlannerManager } from '../../engine/PlannerManager';
import { createPlanner } from '../../projection/createPlanner';
import { PlannerContext } from '../PlannerContext';

/** Пропсы = DI-контракт с платформой (ADR 0015 A8): `projectId`, `logger`; canvas создаёт сам компонент. */
export interface PlannerProps {
  projectId: string;
  /** Может быть любой ссылкой: смена `logger` не пересоздаёт планер — новые записи идут в актуальный логгер. */
  logger: PlannerLogger;
  className?: string;
  /** Панели/оверлеи скина: рендерятся внутри `PlannerContext`, когда движок поднят (после первого эффекта). */
  children?: React.ReactNode;
}

/**
 * Тонкая обёртка над фабрикой (ADR 0015 A7): рендерит `<canvas>`, в `useEffect` поднимает планер через
 * `createPlanner`, кладёт `manager` в `PlannerContext`, на unmount зовёт `dispose()`. Единственный слой
 * пакета с React; владелец canvas один — React создаёт элемент и передаёт его фабрике.
 * Дети рендерятся только когда менеджер есть: до первого эффекта (и в SSR) контекст пуст.
 * Планер пересоздаётся только при смене `projectId`.
 */
export const Planner: React.FC<PlannerProps> = ({ projectId, logger, className, children }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [manager, setManager] = useState<PlannerManager | null>(null);

  // Актуальный логгер — через ref, а планеру отдаётся стабильный делегат: пропс-логгер вне deps эффекта.
  const loggerRef = useRef(logger);
  useEffect(() => {
    loggerRef.current = logger;
  });
  const [stableLogger] = useState<PlannerLogger>(() => ({
    debug: (message, ...args) => loggerRef.current.debug(message, ...args),
    info: (message, ...args) => loggerRef.current.info(message, ...args),
    warn: (message, ...args) => loggerRef.current.warn(message, ...args),
    error: (message, ...args) => loggerRef.current.error(message, ...args),
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const planner = createPlanner({ canvas, projectId, logger: stableLogger });
    setManager(planner.manager);
    return () => {
      setManager(null);
      planner.dispose();
    };
  }, [projectId, stableLogger]);

  return (
    <>
      <canvas ref={canvasRef} className={className} />
      {manager && <PlannerContext value={manager}>{children}</PlannerContext>}
    </>
  );
};
