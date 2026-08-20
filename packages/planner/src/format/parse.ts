import type { Floor, PlannerDocument } from '../document/PlannerDocument';
import { err, ok, type Result } from '../document/Result';
import { corrupt, type ParseError } from './errors';
import { migrate } from './migrate';
import { documentSchema } from './schema';

/**
 * Разбор чужого JSON в документ планера (ADR 0021). Порядок: конверт → миграции → схема → чистка
 * битых ссылок. Исключений наружу нет (ADR 0015 A2).
 *
 * Принимает и строку (колонка `projects.document`, localStorage-черновик), и уже разобранный объект.
 */
export const parse = (raw: unknown): Result<PlannerDocument, ParseError> => {
  const migrated = migrate(raw);
  if (!migrated.ok) return migrated;

  const result = documentSchema.safeParse(migrated.value.document);
  if (!result.success) {
    const first = result.error.issues[0];
    return err(
      corrupt('schema', first === undefined ? 'не соответствует схеме' : `${first.path.join('.')}: ${first.message}`),
    );
  }

  const document = result.data as PlannerDocument;
  for (const floor of document.floors) dropDanglingRefs(floor);
  return ok(document);
};

/**
 * Ссылка на отсутствующий id — **не «битый проект»**: запись молча пропускается, остальной план грузится
 * (спека 10 «Ошибочные сценарии», ADR 0016 B2). Дальше отрабатывает обычная пересборка.
 *
 * Пропускается именно **запись целиком**, а не «дырявый» id из списка: контур, потерявший вершину,
 * перестаёт быть той геометрией, которую рисовал пользователь, и молча превратился бы в другую фигуру.
 *
 * **`rooms[]` — исключение, и это не оплошность.** ADR 0021 в перечислении битых ссылок называет
 * «комната → отсутствующая точка» вместе с контурами, но там же, в «Смежном», требует обратного:
 * «записи-сироты `rooms[]` в v0 не чистим», и задача 0079 повторяет это дословно («парсеру их
 * фильтровать не надо»). Спорить нечему — второе прочтение единственно рабочее:
 *
 * - `anchor` по определению **устаревающая** ссылка: это «id точек контура на момент последнего rebuild»
 *   (ADR 0016 B3/Q3), которую `normalize` переписывает сам, а `matchRoomRecords` восстанавливает по
 *   перекрытию площади. Геометрию комнаты `anchor` не задаёт — в отличие от точек контура, пола и зоны;
 * - запись комнаты несёт **пользовательские атрибуты** (имя, высота потолка, дальше материалы). Выбросив
 *   её по устаревшему якорю, парсер терял бы данные, которые пользователь вводил руками;
 * - и это ловится тестом: `normalize` штатно оставляет запись с якорем на точках, которые сам же собрал
 *   заново, поэтому фильтрация делала бы **путь загрузки неидемпотентным** — `normalize(load(save(x)))`
 *   отличался бы от `normalize(x)` ровно на пропавшую комнату (`engine/loadPathIdempotency.test.ts`).
 *
 * `scene.hidden` не чистится по той же причине: там id любых сущностей, не только точек.
 */
const dropDanglingRefs = (floor: Floor): void => {
  const { layout } = floor;
  const alive = (id: string): boolean => Object.prototype.hasOwnProperty.call(layout.points, id);
  layout.contours = layout.contours.filter(contour => contour.points.every(alive));
  layout.covers = layout.covers.filter(cover => cover.points.every(alive));
  layout.areas = layout.areas.filter(area => area.points.every(alive));
  layout.cuts = layout.cuts.filter(cut => alive(cut.a) && alive(cut.b));
};
