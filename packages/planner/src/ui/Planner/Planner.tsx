import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import type { PlannerLogger, PlannerManager } from '../../engine/PlannerManager';
import { createPlanner, type PlannerInstance } from '../../projection/createPlanner';
import { PlannerContext } from '../PlannerContext';

/** Пропсы = DI-контракт с платформой (ADR 0015 A8): `projectId`, `logger`; canvas создаёт сам компонент. */
export interface PlannerProps {
  projectId: string;
  /** Может быть любой ссылкой: смена `logger` не пересоздаёт планер — новые записи идут в актуальный логгер. */
  logger: PlannerLogger;
  /** Бюджет кадров render-on-demand (ADR 0015 A7); по умолчанию `FRAME_BUDGET = 5`. Читается при монтировании. */
  frameBudget?: number;
  className?: string;
  /**
   * Результат фабрики после подъёма планера — ручка для инструментов и гвардов (Playwright читает `getStats()`,
   * ADR 0015 A7). Платформа передаёт только вне прода; глобалов (`window.__*`) пакет не заводит.
   * Как и `logger`, может быть любой ссылкой — смена не пересоздаёт планер.
   */
  onReady?: (planner: PlannerInstance) => void;
  /** Панели/оверлеи скина: рендерятся внутри `PlannerContext`, когда движок поднят (после первого эффекта). */
  children?: React.ReactNode;
}

/**
 * Тонкая обёртка над фабрикой (ADR 0015 A7): рендерит `<canvas>`, в `useEffect` поднимает планер через
 * `createPlanner`, кладёт `manager` в `PlannerContext`, на unmount зовёт `dispose()`. Единственный слой
 * пакета с React; владелец canvas один — React создаёт элемент и передаёт его фабрике.
 * Дети рендерятся только когда менеджер есть: до первого эффекта (и в SSR) контекст пуст.
 * Планер пересоздаётся только при смене `projectId` — вместе с новым `<canvas>` (`key`): после `dispose()`
 * контекст старого канваса потерян (`forceContextLoss`), второй рендерер на нём ничего бы не нарисовал.
 * `frameBudget` читается при монтировании. Если планер не поднялся (например, нет WebGL), ошибка уходит в
 * `logger.error`, контекст остаётся пустым — приложение-хост не падает; UI-фолбэк — отдельная задача.
 */
export const Planner: React.FC<PlannerProps> = ({ projectId, logger, frameBudget, className, onReady, children }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [manager, setManager] = useState<PlannerManager | null>(null);

  // Актуальные колбэки — через ref, планеру отдаётся стабильный делегат: пропсы-функции вне deps эффекта.
  const loggerRef = useRef(logger);
  const onReadyRef = useRef(onReady);
  const frameBudgetRef = useRef(frameBudget);
  useEffect(() => {
    loggerRef.current = logger;
    onReadyRef.current = onReady;
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

    let planner: PlannerInstance;
    try {
      planner = createPlanner({ canvas, projectId, logger: stableLogger, frameBudget: frameBudgetRef.current });
    } catch (error) {
      stableLogger.error('@uyutno/planner: failed to start planner', error);
      return;
    }
    setManager(planner.manager);
    onReadyRef.current?.(planner);
    return () => {
      setManager(null);
      planner.dispose();
    };
  }, [projectId, stableLogger]);

  return (
    <>
      <canvas key={projectId} ref={canvasRef} className={className} />
      {manager && <PlannerContext value={manager}>{children}</PlannerContext>}
    </>
  );
};
