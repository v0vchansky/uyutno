import { type AreaRejection, validateArea } from '../../document/geometry/areas/validateArea';
import { validateContour } from '../../document/geometry/contours/validateContour';
import { createId, type Id } from '../../document/id';
import type { PlanPosition } from '../../document/PlannerDocument';
import type { PlannerStore } from '../PlannerStore';
import { err, ok, type Result } from '../../document/Result';
import { indexPointIds, loopPositions, quantizeLoop, resolveLoopIds } from './loopAccess';
import { isFinitePosition, resolveFloor, type UnknownFloorError } from './layoutAccess';

/** Высота зоны: конечное число > 0 (ADR 0018 D1: `undefined`/`NaN` в документ не попадают). */
export type InvalidHeightError = { kind: 'invalid-height'; height: number };

export type AddAreaError =
  | UnknownFloorError
  /** Не конечная координата (`NaN`/`±Infinity`). */
  | { kind: 'invalid-coordinate' }
  | InvalidHeightError
  /** Граница зоны пересекает сама себя. */
  | { kind: 'contour-self-intersected' }
  /** < 3 точек, дубли точек или площадь/сливер ниже порога. */
  | { kind: 'contour-degenerate' }
  /** Граница не лежит целиком внутри комнаты либо режет тело стены (спека 02 «Пересечения»). */
  | { kind: 'area-crosses-walls' }
  /** С существующей зоной отношение строже касания. */
  | { kind: 'area-overlaps-area' }
  /** Хоть одна точка не совпала с точкой комнаты — зона не переживёт ближайшую пересборку. */
  | { kind: 'area-unsupported' };

/**
 * Причина отбраковки `validateArea` → ошибка команды; коды геометрии контура общие с `addCover`.
 * Объекты-константы: ошибка — read-only значение, в документ не попадает и не мутируется.
 */
const ERROR_OF: Record<AreaRejection, AddAreaError> = {
  'self-intersected': { kind: 'contour-self-intersected' },
  degenerate: { kind: 'contour-degenerate' },
  'crosses-walls': { kind: 'area-crosses-walls' },
  'overlaps-area': { kind: 'area-overlaps-area' },
  unsupported: { kind: 'area-unsupported' },
};

/**
 * Команда `document.addArea` (ADR 0018 D1, [спека 02](../../../../../docs/product/features/planner/02-rooms-floors-ceilings.md)
 * «Зоны (Areas)», «Пересечение зон и отклонение зоны»): зона с пониженным потолком одним контуром.
 * Порядок валидации — floorId → конечность координат → высота → геометрия контура (`validateContour` с
 * `minEdgeLength: 0`) → правила зоны (`validateArea`). Дальше квантование → одна транзакция
 * `history: { zone: 'layout' }` → `normalize` (там же появятся записи `cuts[]` — фаза (3)) → одно
 * `document:changed`.
 *
 * **Отказ типизирован, хотя для пользователя он молчаливый.** Спека 02 требует «мгновенный отказ без
 * модалок и тостов» — это про UI; команда обязана вернуть `Result`, иначе отказ неотличим от no-op.
 *
 * **Опора проверяется теми же правилами, что и на пересборке** (`requireSupport: true`): зона, чьи точки не
 * совпали с точками комнат, была бы снята ближайшим `normalize`, и принять её значило бы молча потерять
 * данные пользователя. Снап «точка к углу» при рисовании (шаг 7) обеспечивает опору до вызова команды.
 *
 * Хранимые контуры этажа уже нормализованы, поэтому `inner` = комнаты, `outer` = обводы тел стен — тот же
 * вход, что фаза (3) `normalize` собирает из результата пересборки.
 */
export const addArea = (
  store: PlannerStore,
  floorId: Id,
  points: readonly PlanPosition[],
  height: number,
): Result<void, AddAreaError> => {
  const floor = resolveFloor(store.getDocument(), floorId);
  if (!floor.ok) return floor;
  if (!points.every(isFinitePosition)) return err({ kind: 'invalid-coordinate' });
  if (!Number.isFinite(height) || height <= 0) return err({ kind: 'invalid-height', height });

  const { layout } = floor.value;
  const loop = quantizeLoop(points);
  const validation = validateContour(loop, { minEdgeLength: 0 });
  if (!validation.ok) {
    return err({ kind: validation.reason === 'selfIntersected' ? 'contour-self-intersected' : 'contour-degenerate' });
  }
  const rooms = layout.contours
    .filter(contour => contour.kind === 'inner')
    .map(contour => loopPositions(layout, contour.points));
  const walls = layout.contours
    .filter(contour => contour.kind === 'outer')
    .map(contour => loopPositions(layout, contour.points));
  const rejection = validateArea({
    points: loop,
    rooms,
    walls,
    areas: layout.areas.map(area => loopPositions(layout, area.points)),
    requireSupport: true,
    roomPoints: rooms.flat(),
  });
  if (rejection !== null) return err(ERROR_OF[rejection]);

  const index = indexPointIds(layout.points);
  store.transact(
    draft => {
      const draftLayout = draft.floors.find(candidate => candidate.id === floorId)!.layout;
      draftLayout.areas.push({ id: createId(), points: resolveLoopIds(draftLayout, index, loop), height });
    },
    { history: { zone: 'layout' } },
  );
  return ok(undefined);
};
