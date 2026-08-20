import { createId } from './id';
import { createDefaultView, DEFAULT_WALL_HEIGHT, type Floor, type PlannerDocument } from './PlannerDocument';
import { DOCUMENT_FORMAT, DOCUMENT_VERSION } from '../format/version';

/**
 * Фабрики пустого проекта. Живут отдельно от `PlannerDocument.ts` намеренно: это единственное место
 * документа, которому нужен **runtime**-генератор id (`uuidv7`). Благодаря выносу `PlannerDocument.ts`
 * остаётся модулем без единого runtime-импорта — форма документа и её константы, — и узкий вход
 * `format/` (его импортирует серверный процесс, ADR 0021) берёт оттуда `UNITS`/`VIEW_KINDS`/дефолтные
 * камеры, не утягивая за собой ничего исполняемого.
 */
export const createEmptyFloor = (): Floor => ({
  id: createId(),
  layout: { points: {}, contours: [], covers: [], areas: [], cuts: [], rooms: [] },
  scene: { items: [], rulers: [], hidden: [] },
});

/** Пустой документ нового проекта: один этаж, см, `wallHeight = 280`, дефолтные вид и камеры. */
export const createEmptyDocument = (): PlannerDocument => ({
  format: DOCUMENT_FORMAT,
  version: DOCUMENT_VERSION,
  settings: { units: 'cm', wallHeight: DEFAULT_WALL_HEIGHT },
  view: createDefaultView(),
  floors: [createEmptyFloor()],
});
