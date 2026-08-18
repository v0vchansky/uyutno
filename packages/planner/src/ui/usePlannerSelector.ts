import { useSyncExternalStore } from 'react';

import type { PlannerManager } from '../engine/PlannerManager';
import { usePlannerManager } from './PlannerContext';

/**
 * Мост движок → React (ADR 0015 A4): движок — источник правды, компонент подписан через
 * `useSyncExternalStore` на wildcard-подписку фасада и на каждое событие перечитывает `selector(manager)`.
 *
 * Селектор обязан быть стабильным: возвращать примитивы или снимки фасада как есть (`document.get()`,
 * `view.get()`, `history.get()`, их поля). Новый объект на каждый вызов (`{ ...m.view.get() }`) даст
 * бесконечный ре-рендер (ADR 0015 «Что важно знать»). Серверный снимок = тот же селектор: SSR и гидрация
 * читают одно и то же начальное состояние.
 */
export const usePlannerSelector = <T>(selector: (manager: PlannerManager) => T): T => {
  const manager = usePlannerManager();
  const getSnapshot = (): T => selector(manager);
  return useSyncExternalStore(manager.subscribe, getSnapshot, getSnapshot);
};
