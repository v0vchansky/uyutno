import { validateContour } from '../../document/geometry/contours/validateContour';
import { createId, type Id } from '../../document/id';
import type { ContourKind, PlanPosition, Point } from '../../document/PlannerDocument';
import { quantize } from '../../document/quantize';
import type { PlannerStore } from '../PlannerStore';
import { err, ok, type Result } from '../../document/Result';
import { isFinitePosition, resolveFloor, type UnknownFloorError } from './layoutAccess';

/** Сырой контур инструмента (ADR 0017 C1): квад ленты / прямоугольник — `outer`, комната по точкам — `inner`. */
export interface ContourInput {
  kind: ContourKind;
  points: PlanPosition[];
}

export type AddContoursError =
  | UnknownFloorError
  /** Не конечная координата (`NaN`/`±Infinity`) у контура `index` — в plain-JSON документ не попадает (B5). */
  | { kind: 'invalid-coordinate'; index: number }
  /** Трансверсальное самопересечение контура `index` (C4). */
  | { kind: 'contour-self-intersected'; index: number }
  /** < 3 точек, дубли точек или площадь/сливер ниже порога `contourValid` у контура `index`. */
  | { kind: 'contour-degenerate'; index: number };

/** Ключ квантованной координаты — тождество точек (ADR 0017 C1/C3), тот же, что у `normalize`. */
const coordinateKey = (position: PlanPosition): string => `${position.x}|${position.y}`;

/**
 * Команда `document.addContours` (ADR 0018 D1): валидация каждого контура (отказ одного — отказ пакета) →
 * квантование → одна транзакция: точки с существующим квантованным ключом получают id существующей точки
 * (сварка, T-стык), одинаковые координаты внутри пакета — один id, остальные — новые; контуры дописываются
 * в `layout.contours` как есть, дальше `normalize` (слияние, комнаты) → `rebuild` → одно `document:changed`.
 * Пустой пакет — `ok` без транзакции. Порог длины ребра здесь не проверяется: торцы квадов ленты короче
 * `MIN_WALL_LENGTH` по построению; длину рёбер контролирует инструмент на завершении рисования. `kind`
 * доверяем типу (вход — от инструментов движка, не сырой JSON; тот проверяет `load`/ADR F).
 */
export const addContours = (
  store: PlannerStore,
  floorId: Id,
  contours: readonly ContourInput[],
): Result<void, AddContoursError> => {
  const floor = resolveFloor(store.getDocument(), floorId);
  if (!floor.ok) return floor;

  const quantized: { kind: ContourKind; points: PlanPosition[] }[] = [];
  for (const [index, contour] of contours.entries()) {
    if (!contour.points.every(isFinitePosition)) return err({ kind: 'invalid-coordinate', index });
    const points = contour.points.map(point => ({ x: quantize(point.x), y: quantize(point.y) }));
    const validation = validateContour(points, { minEdgeLength: 0 });
    if (!validation.ok) {
      return err({
        kind: validation.reason === 'selfIntersected' ? 'contour-self-intersected' : 'contour-degenerate',
        index,
      });
    }
    quantized.push({ kind: contour.kind, points });
  }
  if (quantized.length === 0) return ok(undefined);

  // Индекс существующих точек по ключу; при дублях координат (после normalize их нет) — меньший id, как в normalize.
  const idByKey = new Map<string, Id>();
  for (const point of Object.values(floor.value.layout.points)) {
    const key = coordinateKey(point);
    const existing = idByKey.get(key);
    if (existing === undefined || point.id < existing) idByKey.set(key, point.id);
  }

  store.transact(
    draft => {
      const layout = draft.floors.find(candidate => candidate.id === floorId)!.layout;
      for (const { kind, points } of quantized) {
        const ids = points.map(position => {
          const key = coordinateKey(position);
          let id = idByKey.get(key);
          if (id === undefined) {
            id = createId();
            idByKey.set(key, id);
            const point: Point = { id, x: position.x, y: position.y };
            layout.points[id] = point;
          }
          return id;
        });
        layout.contours.push({ id: createId(), kind, points: ids });
      }
    },
    { history: { zone: 'layout' } },
  );
  return ok(undefined);
};
