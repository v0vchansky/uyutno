import type { PlannerLogger } from '@uyutno/planner';

/**
 * Временный адаптер DI-логгера планера (ADR 0015 A8) над `console`.
 * TODO: заменить на логгер клиентского модуля `core` (ADR 0007), когда он появится —
 * парковка «Клиентского модуля `core` и логгера нет» в docs/product/architecture/planner-build-order.md.
 * Модульная константа — стабильная ссылка, чтобы `<Planner logger />` не пересоздавал планер на ре-рендерах.
 */
export const plannerLogger: PlannerLogger = {
  debug: (message, ...args) => console.debug(message, ...args),
  info: (message, ...args) => console.info(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
};
