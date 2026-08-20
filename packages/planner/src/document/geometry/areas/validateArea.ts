import type { PlanPosition } from '../../PlannerDocument';
import { compareContours, type ContourRelation } from '../predicates/compareContours';
import { contourValid } from '../predicates/contourArea';
import { contourSelfIntersected } from '../predicates/contourSelfIntersected';
import { areaSupported } from './areaSupport';

/**
 * Причина отбраковки зоны (спека 02 «Пересечения», «Пересечение зон и отклонение зоны»; ADR 0017 C9).
 * Предикаты одни и те же на обеих стадиях, разная только реакция: при рисовании — молчаливый отказ
 * команды (0071), при авто-пересборке — удаление уже сохранённой зоны (0069).
 *
 * - `self-intersected` — граница пересекает сама себя (`contourSelfIntersected`);
 * - `degenerate` — меньше трёх точек, микро-площадь или сливер (`contourValid`);
 * - `crosses-walls` — граница не лежит целиком внутри какой-либо комнаты либо режет тело стены;
 * - `overlaps-area` — с уже существующей зоной отношение строже касания;
 * - `unsupported` — хоть одна точка не совпала с точкой комнаты (`areaSupported`).
 */
export type AreaRejection = 'self-intersected' | 'degenerate' | 'crosses-walls' | 'overlaps-area' | 'unsupported';

export interface ValidateAreaInput {
  points: readonly PlanPosition[];
  /** Полости-комнаты. */
  rooms: readonly (readonly PlanPosition[])[];
  /** Обводы тел стен (внешние обводы; дырки не нужны — принадлежность комнате проверяется отдельно). */
  walls: readonly (readonly PlanPosition[])[];
  /** Уже существующие зоны (кроме проверяемой). */
  areas: readonly (readonly PlanPosition[])[];
  /** Проверять опору (стадия пересборки) — при рисовании опора обеспечивается снапом. */
  requireSupport?: boolean;
  /** Точки комнат для проверки опоры. */
  roomPoints?: Iterable<PlanPosition>;
}

/** Вложенность с точностью до общей границы: `coincide` — контуры совпали. */
const NESTED: readonly ContourRelation[] = ['belong', 'contactBelong', 'coincide'];
/** Зоны могут только касаться границами (спека 02, реверс: «не OUTSIDE и не CONTACT» → зона плохая). */
const AREAS_DISJOINT: readonly ContourRelation[] = ['outside', 'contact'];

/**
 * Годность зоны как единый предикат (ADR 0017 C9; спека 02 «Пересечения»). `null` — зона годна, иначе
 * первая по порядку проверок причина отказа. Порядок дешевле-и-строже к сложнее: самопересечение →
 * вырожденность → стены → соседние зоны → опора. Самопересечение проверяется **до** `contourValid`,
 * потому что у «бабочки» знаковая площадь схлопывается и вырожденность маскировала бы настоящую причину.
 *
 * «Не пересекает стены» — две проверки по спеке («её граница должна целиком лежать внутри существующей
 * комнаты (или касаться стен, но не пересекать их)»): зона обязана принадлежать хоть одной комнате
 * (`hosts`) и не иметь конфликта ни с одним телом стены. Зона, нарисованная вне всякой комнаты (в том
 * числе когда комнат нет вовсе), — тот же `crosses-walls`: отдельного кода отказа спека не вводит.
 *
 * Конфликт с телом стены — это `intersect` (граница прошла сквозь тело) **и** вложенность зоны в тело
 * (`belong`/`contactBelong`) — кроме случая, когда это тело само объемлет комнату-хозяйку: обвод
 * комнаты-кольца объемлет и её полость, поэтому зона внутри комнаты всегда «принадлежит» ему, и считать
 * это конфликтом нельзя. А вот зона в толще колонны (свободностоящей стены внутри комнаты) принадлежит
 * телу, которое комнату не объемлет, — её граница внутри комнаты не лежит, и это отказ.
 * `contain`/`contactContain` **допустимы**: стена, целиком лежащая внутри зоны, просто укорачивается и
 * прячется под крышкой (спека 02 «Что видит пользователь»), это не конфликт.
 *
 * Вырожденность и микро-площадь меряются общим `contourValid` (`MIN_CONTOUR_AREA` / `MIN_SP_RATIO`) —
 * зона у референса подкласс контура, своих порогов площади спека ей не даёт; нового порога не заводим.
 *
 * Чистая функция: вход не мутируется, порядок наборов на результат не влияет.
 */
export const validateArea = ({
  points,
  rooms,
  walls,
  areas,
  requireSupport = false,
  roomPoints = [],
}: ValidateAreaInput): AreaRejection | null => {
  if (contourSelfIntersected(points)) return 'self-intersected';
  if (!contourValid(points)) return 'degenerate';
  const hosts = rooms.filter(room => NESTED.includes(compareContours(points, room)));
  if (hosts.length === 0) return 'crosses-walls';
  for (const wall of walls) {
    const relation = compareContours(points, wall);
    if (relation === 'intersect') return 'crosses-walls';
    if (!NESTED.includes(relation)) continue;
    // Вложенность в тело стены безопасна, только если это тело объемлет комнату-хозяйку (обвод кольца).
    if (!hosts.some(host => NESTED.includes(compareContours(host, wall)))) return 'crosses-walls';
  }
  if (areas.some(other => !AREAS_DISJOINT.includes(compareContours(points, other)))) return 'overlaps-area';
  if (requireSupport && !areaSupported(points, roomPoints)) return 'unsupported';
  return null;
};
