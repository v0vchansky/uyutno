import type { PlannerInstance } from '@uyutno/planner';

/**
 * Dev-only ручка к результату фабрики планера для Playwright-гварда (ADR 0015 A7, testing-strategy слой 3):
 * вне прода `ProjectPage` передаёт `announcePlannerReady` в `<Planner onReady />`, и после подъёма планера
 * на `window` уходит `CustomEvent` с `PlannerInstance` в `detail`. Тест сам вешает слушатель (`addInitScript`)
 * и держит ссылку у себя — приложение глобалов (`window.__*`) не заводит. В проде `announcePlannerReady`
 * равен `undefined`: проп не передаётся, события нет.
 */
export const PLANNER_READY_EVENT = 'planner:ready';

export type PlannerReadyEventDetail = PlannerInstance;

const dispatchPlannerReady = (planner: PlannerInstance): void => {
  window.dispatchEvent(new CustomEvent<PlannerReadyEventDetail>(PLANNER_READY_EVENT, { detail: planner }));
};

export const announcePlannerReady = process.env.NODE_ENV === 'production' ? undefined : dispatchPlannerReady;
