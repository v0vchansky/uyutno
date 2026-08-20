import { type AreaFace, classifyAreaEdges } from '../document/geometry/areas/areaEdges';
import { type CutEdge, requiredCuts } from '../document/geometry/areas/cutRecords';
import { validateArea } from '../document/geometry/areas/validateArea';
import type { ContourSet } from '../document/geometry/triangulate/triangulateContours';
import type { Id } from '../document/id';
import type { PlanPosition } from '../document/PlannerDocument';
import { dedupeCycle } from './normalizeIds';

export interface NormalizeAreasInput {
  /**
   * Хранимые зоны в порядке `layout.areas`: координаты их точек. `null` — зона, чьи точки не разрешаются
   * (пропавший id): такая уже не «сидит на графе комнат» и отбраковывается вместе с потерявшими опору.
   */
  areas: readonly (readonly PlanPosition[] | null)[];
  /** Полости-комнаты после фазы (1). */
  rooms: ContourSet;
  /** Обводы тел стен после фазы (1). */
  walls: ContourSet;
  /** Точки комнат — опора зон (тождество квантованной координаты, спека 02, решение 2026-08-17). */
  roomPoints: readonly PlanPosition[];
  /** Грани хранимых контуров (`outer` + `inner`) — по ним рёбра зоны делятся на «по стене» / «через интерьер». */
  faces: readonly AreaFace[];
  /** Разрешение координаты в id точки этажа — та же дисциплина, что у контуров (ADR 0017 C1). */
  idOf: (position: PlanPosition) => Id;
}

export interface KeptArea {
  /** Индекс зоны во входном массиве (= в `layout.areas`): запись переживает пересборку своим объектом. */
  index: number;
  /** Id точек зоны после разрешения по координате (общий id с комнатой — ADR 0016 B4). */
  points: Id[];
}

export interface NormalizeAreasResult {
  kept: KeptArea[];
  /** Набор записей `cuts[]`, который обязан существовать при выживших зонах (порядок — детерминированный). */
  cuts: CutEdge[];
}

/**
 * Фаза (3) `normalize` (ADR 0017 C6/C9, [спека 02](../../../../docs/product/features/planner/02-rooms-floors-ceilings.md)
 * «Пересечения», шаг 8 «Автоматической перестройки»): отбраковка зон, не переживших правку стен, и приведение
 * набора `cuts[]` к нужному.
 *
 * Каждая хранимая зона проверяется `validateArea` с `requireSupport: true` — при авто-пересборке зона обязана
 * буквально сидеть на вершинах комнат (тождество квантованной координаты), и одной неопёртой точки достаточно,
 * чтобы зона ушла целиком: частичной подгонки не бывает. Зоны проверяются **в порядке хранения**, и уже принятые
 * идут в `areas` следующей проверки — так пара «зона A выжила, зона B пересеклась с A» разрешается детерминированно
 * в пользу первой. Отбракованная зона просто не попадает в `kept`.
 *
 * Записи `cuts[]` набираются из **интерьерных участков** рёбер выживших зон (`classifyAreaEdges` — классификация
 * под-рёберная, длина результата числу рёбер зоны не равна) и дедуплицируются `requiredCuts` по неупорядоченной
 * паре id. Концы участка — либо точка зоны, либо конец грани контура, поэтому в id они резолвятся **по тождеству
 * квантованной координаты** (`idOf`), а не берутся из `area.points`. Сведение к хранимым записям (перенос id и
 * материала донора) — `reconcileCuts` в `rebuild.ts`: здесь считается только «что должно быть».
 *
 * Чистая функция от координат; вход не мутируется, `idOf` — единственный побочный эффект (регистрация новой точки).
 */
export const normalizeAreas = ({
  areas,
  rooms,
  walls,
  roomPoints,
  faces,
  idOf,
}: NormalizeAreasInput): NormalizeAreasResult => {
  const kept: KeptArea[] = [];
  const accepted: (readonly PlanPosition[])[] = [];
  const edgeSets: { interior: CutEdge[] }[] = [];
  areas.forEach((points, index) => {
    if (points === null) return;
    const rejection = validateArea({ points, rooms, walls, areas: accepted, requireSupport: true, roomPoints });
    if (rejection !== null) return;
    accepted.push(points);
    kept.push({ index, points: dedupeCycle(points.map(idOf)) });
    edgeSets.push({
      interior: classifyAreaEdges(points, faces)
        .filter(segment => segment.kind === 'interior')
        .map(segment => ({ a: idOf(segment.a), b: idOf(segment.b) })),
    });
  });
  return { kept, cuts: requiredCuts(edgeSets) };
};
