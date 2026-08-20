/**
 * Узкий вход `@uyutno/planner/format` — схема формата, `serialize`/`parse`, `migrate` и номер версии.
 * **Ничего сверх**: этот вход импортирует серверный процесс (ADR 0021, «Конверт и схема»), и утечка
 * `three`, `react` или любого файла `engine/`/`projection/`/`ui/` означала бы половину редактора на
 * бэкенде. Требование к структуре пакета, а не пожелание.
 *
 * Держится тремя вещами: override `packages/planner/src/format/**` в корневом `eslint.config.mjs`
 * (ловит написанные импорты), гвард `importGraph.test.ts` (обходит реальный граф и ловит транзитивные)
 * и тем, что `document/PlannerDocument.ts` оставлен без runtime-импортов.
 *
 * Точек вызова у одного и того же кода две: сервер мигрирует документы на чтении, а клиент — черновик
 * демо в localStorage, до которого сервер не дотягивается (ADR 0021, «Что важно знать»).
 */

export { documentSchema } from './schema';
export { serialize } from './serialize';
export { parse } from './parse';
export { migrate, migrateWith, type Migrated } from './migrate';
export { DOCUMENT_FORMAT, DOCUMENT_VERSION, MIGRATIONS, versionOf } from './version';
export type { DocumentFormat, JsonObject, JsonValue, Migration } from './version';
export type { CorruptReason, ParseError } from './errors';

/**
 * Типы, без которых вызвать `parse`/`serialize` нельзя: форма документа и `Result`. Оба — только типы,
 * в рантайм не попадают и «сверх» ничего не добавляют.
 */
export type {
  Area,
  CameraViewKind,
  Contour,
  ContourKind,
  Cover,
  Cut,
  DocumentSettings,
  DocumentView,
  Floor,
  FloorLayout,
  FloorScene,
  OrbitCamera,
  PlanCamera,
  PlanPosition,
  PlannerDocument,
  Point,
  Room,
  Ruler,
  SceneItem,
  SceneItemKind,
  Units,
  ViewCameras,
  ViewKind,
  WalkCamera,
} from '../document/PlannerDocument';
export type { Id } from '../document/id';
export type { Result } from '../document/Result';
