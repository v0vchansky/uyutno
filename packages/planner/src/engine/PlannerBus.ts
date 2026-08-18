import mitt, { type Emitter } from 'mitt';

import type { DocumentView, PlannerDocument } from '../document/PlannerDocument';
import type { HistoryState } from './HistoryNamespace';

/**
 * Карта событий шины (ADR 0015 A5). Имя — `<неймспейс>:<факт в прошедшем времени>`, payload — plain-данные
 * (снимки документа/вида, без Three-объектов и UI-подсказок), одно событие на факт, без edge-triggered пар.
 * Шина наружу пакета не отдаётся: подписка только через `subscribe`/`on` фасада.
 */
export type PlannerEvents = {
  /** Изменилось содержимое документа: `floors`, `settings` (не `view`). */
  'document:changed': { document: PlannerDocument };
  /** Изменился активный вид или камера вида (`Document.view`, ADR 0016 B7). */
  'view:changed': DocumentView;
  /** Изменилась доступность undo/redo — одно событие вместо трёх каналов (аудит roomtodo). */
  'history:changed': HistoryState;
};

export type PlannerEventType = keyof PlannerEvents;

export type PlannerBus = Emitter<PlannerEvents>;

export const createPlannerBus = (): PlannerBus => mitt<PlannerEvents>();
