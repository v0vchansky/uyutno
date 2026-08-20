import { validateContour } from '../../document/geometry/contours/validateContour';
import { createId, type Id } from '../../document/id';
import type { ContourKind, PlanPosition } from '../../document/PlannerDocument';
import type { PlannerStore } from '../PlannerStore';
import { err, ok, type Result } from '../../document/Result';
import { indexPointIds, quantizeLoop, resolveLoopIds } from './loopAccess';
import { isFinitePosition, resolveFloor, type UnknownFloorError } from './layoutAccess';

export interface AddCoverOptions {
  /** `outer` (дефолт) — пол; `inner` — пол-вычитание (дырка) внутри пола-хозяина (ADR 0016 B4, спека 02). */
  kind?: ContourKind;
}

export type AddCoverError =
  | UnknownFloorError
  /** Не конечная координата (`NaN`/`±Infinity`) — в plain-JSON документ не попадает (ADR 0016 B5). */
  | { kind: 'invalid-coordinate' }
  /** Трансверсальное самопересечение контура пола (ADR 0017 C4). */
  | { kind: 'contour-self-intersected' }
  /** < 3 точек, дубли точек или площадь/сливер ниже порога (`contourValid`). */
  | { kind: 'contour-degenerate' };

/**
 * Команда `document.addCover` (ADR 0018 D1, [спека 02](../../../../../docs/product/features/planner/02-rooms-floors-ceilings.md)
 * «Полы», «Multi-material пол»): ручной пол одним контуром. Валидация на границе → квантование → одна
 * транзакция `history: { zone: 'layout' }` → `normalize`/`rebuild` → одно `document:changed`.
 *
 * **Команда сама ничего не сливает и не подрезает.** Она дописывает запись в `layout.covers`, а форму
 * приводят фазы (4)–(6) `normalize`: пол ужимается под комнаты и тела стен, слипается со связанными
 * (`mergeCovers` **с касанием**), осиротевшая дырка удаляется. Диалог «Объединить?» спеки 02 существует
 * только при ручном рисовании (шаг 7) и в ядре не моделируется — на стадии 2b и пересечение, и касание
 * дают один пол.
 *
 * **Порог длины ребра здесь не проверяется** (`minEdgeLength: 0`): 15 см — порог стены (спека 01), у пола
 * своего порога спека не вводит, а микро-полы отсекает общий `contourValid`.
 *
 * `ceilingHidden` новой записи — `false` (спека 02 «Видимость потолка»: флаг живёт на полу, дефолт — потолок
 * виден); переключатель — шаг 7.
 */
export const addCover = (
  store: PlannerStore,
  floorId: Id,
  points: readonly PlanPosition[],
  { kind = 'outer' }: AddCoverOptions = {},
): Result<void, AddCoverError> => {
  const floor = resolveFloor(store.getDocument(), floorId);
  if (!floor.ok) return floor;
  if (!points.every(isFinitePosition)) return err({ kind: 'invalid-coordinate' });

  const loop = quantizeLoop(points);
  const validation = validateContour(loop, { minEdgeLength: 0 });
  if (!validation.ok) {
    return err({ kind: validation.reason === 'selfIntersected' ? 'contour-self-intersected' : 'contour-degenerate' });
  }

  const index = indexPointIds(floor.value.layout.points);
  store.transact(
    draft => {
      const layout = draft.floors.find(candidate => candidate.id === floorId)!.layout;
      layout.covers.push({ id: createId(), kind, points: resolveLoopIds(layout, index, loop), ceilingHidden: false });
    },
    { history: { zone: 'layout' } },
  );
  return ok(undefined);
};
