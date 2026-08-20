import type { Id } from '../../document/id';
import type { PlannerStore } from '../PlannerStore';
import { err, ok, type Result } from '../../document/Result';
import type { InvalidHeightError } from './addArea';
import { resolveArea, type UnknownAreaError } from './loopAccess';
import { resolveFloor, type UnknownFloorError } from './layoutAccess';

export type SetAreaHeightError = UnknownFloorError | UnknownAreaError | InvalidHeightError;

/** Ключ коалесинга серии правок высоты одной зоны (ADR 0018 D5) — формирует команда, не UI. */
export const areaHeightCoalesceKey = (id: Id): string => `area-height:${id}`;

/**
 * Команда `document.setAreaHeight` (ADR 0018 D1/D5): высота зоны — конечное число > 0 (парсинг форм ввода —
 * UI). Одна транзакция с ключом `'area-height:<id>'`, поэтому серия правок одного поля = одна запись
 * истории; другая зона, другая команда, undo/redo и смена выделения серию рвут.
 *
 * Высота — атрибут зоны, а не геометрия: `normalize` её не читает, набор `cuts[]` от неё не зависит (высота
 * вертикальной грани — производная от высот соседних зон). Повтор той же высоты — no-op immer: ни записи,
 * ни события.
 */
export const setAreaHeight = (
  store: PlannerStore,
  floorId: Id,
  id: Id,
  height: number,
): Result<void, SetAreaHeightError> => {
  const floor = resolveFloor(store.getDocument(), floorId);
  if (!floor.ok) return floor;
  const area = resolveArea(floor.value.layout, id);
  if (!area.ok) return area;
  if (!Number.isFinite(height) || height <= 0) return err({ kind: 'invalid-height', height });

  store.transact(
    draft => {
      const layout = draft.floors.find(candidate => candidate.id === floorId)!.layout;
      layout.areas.find(candidate => candidate.id === id)!.height = height;
    },
    { history: { zone: 'layout', coalesce: areaHeightCoalesceKey(id) } },
  );
  return ok(undefined);
};
