import type { PersistenceState, PlannerInstance } from '@uyutno/planner';
import { useSyncExternalStore } from 'react';

/** Планера нет — подписываться не на что; функции модульные, иначе `useSyncExternalStore` перепишется каждый рендер. */
const NO_SUBSCRIPTION = (): (() => void) => () => undefined;
const NO_STATE = (): null => null;

/**
 * Состояние сохранения из движка в шапку платформы (ADR 0015 A4: движок — источник правды, React читает
 * через `useSyncExternalStore`).
 *
 * Своего `usePlannerSelector` здесь взять нельзя: он живёт на `PlannerContext`, то есть **внутри**
 * `<Planner />`, а шапка стоит снаружи — над холстом. Поэтому подписка берётся у экземпляра напрямую;
 * `manager.subscribe` — стабильная ссылка на всю жизнь планера, а снимок `persistence.getState()`
 * заморожен и меняет ссылку только вместе с состоянием, так что лишних рендеров это не даёт.
 */
export const usePersistenceState = (planner: PlannerInstance | null): PersistenceState | null => {
  const subscribe = planner === null ? NO_SUBSCRIPTION : planner.manager.subscribe;
  const snapshot = planner === null ? NO_STATE : (): PersistenceState => planner.manager.persistence.getState();

  return useSyncExternalStore(subscribe, snapshot, snapshot);
};
