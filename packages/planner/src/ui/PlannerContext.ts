import { createContext, useContext } from 'react';

import type { PlannerManager } from '../engine/PlannerManager';
import type { PlannerInstance, PlannerProjections } from '../projection/createPlanner';

/**
 * Поднятый планер для React-скина (ADR 0015 A4, ADR 0020 P6): через контекст пакета, не через `Registry`
 * платформы. Провайдер — `<Planner />`; контекст несёт `PlannerInstance` (`manager` + `projections`).
 */
export const PlannerContext = createContext<PlannerInstance | null>(null);

const usePlannerInstance = (hook: string): PlannerInstance => {
  const instance = useContext(PlannerContext);
  if (!instance) {
    throw new Error(`@uyutno/planner: ${hook}() must be used inside <Planner /> (PlannerContext is empty)`);
  }
  return instance;
};

/** Менеджер из ближайшего `<Planner />`; вне него — ошибка с понятной причиной, а не `null` в рантайме. */
export const usePlannerManager = (): PlannerManager => usePlannerInstance('usePlannerManager').manager;

/**
 * Проекции — для действий, локальных вьюверу и не проходящих через документ (ADR 0020 P6): «в центр»
 * (`canvas2d.fitToContent()`), сброс камеры конструктора, шаг зума для контрола «− % +» (решение 7).
 */
export const usePlannerProjections = (): PlannerProjections => usePlannerInstance('usePlannerProjections').projections;
