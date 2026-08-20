import type { WritableDraft } from 'immer';

import { createId, type Id } from '../../document/id';
import type { Area, Cover, FloorLayout, PlanPosition, Point } from '../../document/PlannerDocument';
import { quantize } from '../../document/quantize';
import { coordinateKey } from '../normalizeIds';
import { err, ok, type Result } from '../Result';

/** Пол этажа больше не существует (удалён пользователем или снят пересборкой — id производного не стабилен). */
export type UnknownCoverError = { kind: 'unknown-cover'; id: Id };
/** Зоны этажа с таким id нет (в том числе если её сняла ближайшая авто-пересборка). */
export type UnknownAreaError = { kind: 'unknown-area'; id: Id };

export const resolveCover = (layout: FloorLayout, id: Id): Result<Cover, UnknownCoverError> => {
  const cover = layout.covers.find(candidate => candidate.id === id);
  return cover ? ok(cover) : err({ kind: 'unknown-cover', id });
};

export const resolveArea = (layout: FloorLayout, id: Id): Result<Area, UnknownAreaError> => {
  const area = layout.areas.find(candidate => candidate.id === id);
  return area ? ok(area) : err({ kind: 'unknown-area', id });
};

/** Квантованная копия петли — единственная форма координат, попадающая в документ (ADR 0016 B1). */
export const quantizeLoop = (points: readonly PlanPosition[]): PlanPosition[] =>
  points.map(point => ({ x: quantize(point.x), y: quantize(point.y) }));

/** Координаты петли по id; пропавшие id молча пропускаются — как в `resolvePoints` нормализации. */
export const loopPositions = (layout: FloorLayout, ids: readonly Id[]): PlanPosition[] =>
  ids.map(id => layout.points[id]).filter((point): point is Point => point !== undefined);

/**
 * Индекс точек этажа по квантованной координате: при дублях выживает **меньший** id — то же правило, что у
 * `indexPointsByCoordinate` в `normalize`, чтобы команда и пересборка выбирали одну и ту же точку.
 */
export const indexPointIds = (points: Readonly<Record<Id, Point>>): Map<string, Id> => {
  const index = new Map<string, Id>();
  for (const point of Object.values(points)) {
    const key = coordinateKey(point);
    const existing = index.get(key);
    if (existing === undefined || point.id < existing) index.set(key, point.id);
  }
  return index;
};

/**
 * Дисциплина id вершин новой петли (ADR 0016 B4, ADR 0017 C1) — та же, что у `addContours`: вершина с
 * существующим квантованным ключом берёт id существующей точки (приваривание пола/зоны к углу комнаты —
 * «угол пола едет за углом стены»), одинаковые координаты внутри одного вызова получают один id, остальные
 * — новые. `index` живой: заведённые здесь точки в нём регистрируются.
 *
 * Точки пишутся в черновик сразу; оставшиеся без владельцев (например, если `normalize` отбракует запись)
 * снимает GC точек в конце нормализации.
 */
export const resolveLoopIds = (
  layout: WritableDraft<FloorLayout>,
  index: Map<string, Id>,
  points: readonly PlanPosition[],
): Id[] =>
  points.map(position => {
    const key = coordinateKey(position);
    let id = index.get(key);
    if (id === undefined) {
      id = createId();
      index.set(key, id);
      layout.points[id] = { id, x: position.x, y: position.y };
    }
    return id;
  });
