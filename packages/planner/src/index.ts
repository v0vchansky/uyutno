/**
 * Публичный API пакета `@uyutno/planner` (ADR 0015). Платформа импортирует только отсюда.
 * Слои: `document/` → `engine/` → `projection/` → `ui/`; направление импортов энфорсится ESLint.
 */
export { createPlanner } from './projection/createPlanner';
export type { CreatePlannerParams, PlannerInstance } from './projection/createPlanner';
export { Planner } from './ui/Planner';
export type { PlannerProps } from './ui/Planner';
export type { PlannerLogger, PlannerManager } from './engine/PlannerManager';
