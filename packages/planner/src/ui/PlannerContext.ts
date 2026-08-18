import { createContext, useContext } from 'react';

import type { PlannerManager } from '../engine/PlannerManager';

/**
 * Экземпляр фасада для React-скина (ADR 0015 A4): через контекст пакета, не через `Registry` платформы.
 * Провайдер — `<Planner />`; панели и хуки читают менеджер отсюда.
 */
export const PlannerContext = createContext<PlannerManager | null>(null);

/** Менеджер из ближайшего `<Planner />`; вне него — ошибка с понятной причиной, а не `null` в рантайме. */
export const usePlannerManager = (): PlannerManager => {
  const manager = useContext(PlannerContext);
  if (!manager) {
    throw new Error('@uyutno/planner: usePlannerManager() must be used inside <Planner /> (PlannerContext is empty)');
  }
  return manager;
};
