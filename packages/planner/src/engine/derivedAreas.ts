import { type AreaFace, classifyAreaEdges } from '../document/geometry/areas/areaEdges';
import { cutKey } from '../document/geometry/areas/cutRecords';
import { pointInContour } from '../document/geometry/predicates/pointInContour';
import type { Triangulation } from '../document/geometry/triangulate/triangulateContours';
import type { Id } from '../document/id';
import type { Area, Cut, PlanPosition } from '../document/PlannerDocument';
import { innermostIndex, regionPoint, type TriangleResolver } from './derivedRegions';
import type { Triangle, WarningSink } from './rebuild';

/**
 * Крышка зоны на её высоте (спека 02 «Зоны»: «в 3D — своя крышка на заданной высоте»). `outline` — точки
 * хранимой зоны как есть: зона рисуется пользователем, её обвод не выводится. Дырок у зоны не бывает —
 * `validateArea` требует простого контура внутри одной комнаты.
 *
 * Своего флага видимости здесь нет: крышка **не** подчиняется камерной авто-логике скрытия потолков
 * (спека 02 «Видимость крышки зоны»), а пользовательский флаг — шаг 7.
 */
export interface DerivedArea {
  readonly areaId: Id;
  readonly roomId: Id | null;
  readonly outline: readonly Id[];
  readonly triangles: readonly Triangle[];
  readonly height: number;
}

/**
 * Вертикальная грань выреза — полоса от `low` до `height` вдоль хранимого ребра `cuts[]` (спека 02
 * «Вертикальные грани зоны»). Сама грань и обе её высоты **выводятся** (ADR 0016 «Хранится / выводится»),
 * хранится только пара концов и материал.
 *
 * Правило высот — дословно по референсу (`plannercore.js:54009–54018`, верифицировано): у ребра, общего
 * для **двух** зон, `height = max(h1, h2)` и `low = min(h1, h2)` (полоса закрывает перепад между
 * крышками); иначе `height` — высота стен, а при **одной** соседней зоне `low` — её высота. Ребро без
 * единой зоны-владелицы после `normalize` не существует, но `rebuild` работает и на ненормализованном
 * снимке: тогда `low = 0` (инициализация `WC.DataCut`).
 *
 * Расхождение с референсом одно и осознанное: «высота стен» у нас — `Room.ceilingHeight` комнаты,
 * содержащей вырез (спека 02: высота комнаты «влияет и на потолок, и на верхнюю границу стен внутри
 * комнаты»), а не глобальный `cap.wallsHeight`; вне комнат — `settings.wallHeight`.
 *
 * `low <= height` держится, пока высота зоны не выше потолка её комнаты. Производное хранимое не чинит:
 * зона выше комнаты даст `low > height`, и это видно наружу, а не молча схлопывается.
 */
export interface DerivedCut {
  readonly cutId: Id;
  readonly a: Id;
  readonly b: Id;
  readonly low: number;
  readonly height: number;
}

/** Хранимая зона с разрешёнными координатами вершин (`null` — хоть один id не разрешился). */
export interface AreaGeometry {
  record: Area;
  positions: readonly PlanPosition[] | null;
}

/** Хранимый вырез с разрешёнными концами (`null` — хоть один id не разрешился). */
export interface CutGeometry {
  record: Cut;
  positions: readonly [PlanPosition, PlanPosition] | null;
}

/** Комната как хозяйка зоны/выреза: обвод в координатах, id записи и высота потолка. */
export interface AreaRoom {
  roomId: Id;
  outline: readonly PlanPosition[];
  ceilingHeight: number;
}

export interface DerivedAreasInput {
  /** Хранимые зоны в порядке `layout.areas` — он же порядок выхода. */
  areas: readonly AreaGeometry[];
  rooms: readonly AreaRoom[];
  /** Триангуляция контуров этажа — та же, из которой собраны `walls`/`rooms`. */
  triangulation: Triangulation;
  resolver: TriangleResolver;
  floorId: Id;
  warn: WarningSink;
}

export interface DerivedCutsInput {
  /** Хранимые вырезы в порядке `layout.cuts` — он же порядок выхода. */
  cuts: readonly CutGeometry[];
  areas: readonly AreaGeometry[];
  rooms: readonly AreaRoom[];
  /** Грани хранимых контуров (`outer` + `inner`) — тот же вход, что у фазы (3) `normalize`. */
  faces: readonly AreaFace[];
  /** Разрешение координаты в id точки этажа по тождеству квантованной координаты; `null` — точки нет. */
  idOf: (position: PlanPosition) => Id | null;
  /** `settings.wallHeight` — верх выреза, не попавшего ни в одну комнату. */
  wallHeight: number;
  floorId: Id;
  warn: WarningSink;
}

/**
 * Крышки зон (задача 0070, ADR 0017 C9).
 *
 * Треугольники раздаются **по группам триангуляции контуров этажа**: рёбра зон уходят в неё cut-парами
 * (ADR 0017 C6), поэтому группы разрезаны ровно по границам зон, и крышка набирается целыми группами. Для
 * каждой группы берётся точка-представитель, и группа достаётся первой зоне, чей контур её содержит —
 * `break` референса на первой совпавшей (`plannercore.js:55540`); зоны пересекаться не могут (спека 02),
 * так что порядок разрешает только вырожденные случаи.
 *
 * Берутся **не-fill** группы: fill — тело стены, а зона живёт в интерьере комнаты. У референса на этом
 * месте `TR.fillGroups`, но его наборы `outer`/`inner` в этой триангуляции инвертированы относительно
 * наших (`inpOuterContours` — контуры комнат-полостей), так что смысл тот же: «область, не являющаяся телом».
 *
 * Комната зоны — по той же точке-представителю, ближайшим объемлющим контуром (`innermostIndex`).
 *
 * Зона с пропавшим id точки и зона без единой группы — `warn` и пропуск записи, без исключений.
 */
export const derivedAreas = ({
  areas,
  rooms,
  triangulation,
  resolver,
  floorId,
  warn,
}: DerivedAreasInput): DerivedArea[] => {
  const usable: { record: Area; positions: readonly PlanPosition[] }[] = [];
  for (const { record, positions } of areas) {
    if (positions === null) {
      warn(`rebuild: area ${record.id} has a point without a record on floor ${floorId}`);
      continue;
    }
    usable.push({ record, positions });
  }
  if (usable.length === 0) return [];

  const buckets: number[][] = usable.map(() => []);
  const anchors: (PlanPosition | null)[] = usable.map(() => null);
  for (const group of triangulation.groups) {
    if (group.fill) continue;
    const point = regionPoint(triangulation, group.triangles);
    if (point === null) continue;
    const index = usable.findIndex(area => pointInContour(point, area.positions));
    if (index < 0) continue;
    buckets[index]!.push(...group.triangles);
    anchors[index] ??= point;
  }

  const roomOutlines = rooms.map(room => room.outline);
  const derived: DerivedArea[] = [];
  usable.forEach((entry, index) => {
    const anchor = anchors[index] ?? null;
    if (anchor === null) {
      warn(`rebuild: area ${entry.record.id} has no triangle group on floor ${floorId}`);
      return;
    }
    const roomIndex = innermostIndex(anchor, roomOutlines);
    derived.push({
      areaId: entry.record.id,
      roomId: roomIndex === null ? null : rooms[roomIndex]!.roomId,
      outline: entry.record.points,
      // Порядок треугольников — по возрастанию индекса, как у групп `rebuildContours`.
      triangles: resolver.triangles(buckets[index]!.sort((a, b) => a - b)),
      height: entry.record.height,
    });
  });
  return derived;
};

/**
 * Высоты вертикальных граней вырезов (задача 0070, ADR 0017 C9) — см. JSDoc `DerivedCut`.
 *
 * «Соседние зоны» вычисляются тем же способом, что и сам набор записей в `normalize`: интерьерные
 * **участки** рёбер каждой зоны (`classifyAreaEdges`) резолвятся в пары id, и каждая зона добавляет свою
 * высоту в список по ключу `cutKey`. Один и тот же ключ от одной зоны учитывается один раз, иначе
 * вырожденная зона, дважды прошедшая по одному ребру, читалась бы как две соседние.
 */
export const derivedCuts = ({
  cuts,
  areas,
  rooms,
  faces,
  idOf,
  wallHeight,
  floorId,
  warn,
}: DerivedCutsInput): DerivedCut[] => {
  const heights = new Map<string, number[]>();
  for (const { record, positions } of areas) {
    if (positions === null) continue;
    const seen = new Set<string>();
    for (const segment of classifyAreaEdges(positions, faces)) {
      if (segment.kind !== 'interior') continue;
      const a = idOf(segment.a);
      const b = idOf(segment.b);
      if (a === null || b === null || a === b) continue;
      const key = cutKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      const list = heights.get(key);
      if (list) list.push(record.height);
      else heights.set(key, [record.height]);
    }
  }

  const roomOutlines = rooms.map(room => room.outline);
  const derived: DerivedCut[] = [];
  for (const { record, positions } of cuts) {
    if (positions === null) {
      warn(`rebuild: cut ${record.id} has an end without a record on floor ${floorId}`);
      continue;
    }
    const neighbours = heights.get(cutKey(record.a, record.b)) ?? [];
    if (neighbours.length === 2) {
      derived.push({
        cutId: record.id,
        a: record.a,
        b: record.b,
        low: Math.min(neighbours[0]!, neighbours[1]!),
        height: Math.max(neighbours[0]!, neighbours[1]!),
      });
      continue;
    }
    const middle = { x: (positions[0].x + positions[1].x) / 2, y: (positions[0].y + positions[1].y) / 2 };
    const roomIndex = innermostIndex(middle, roomOutlines);
    derived.push({
      cutId: record.id,
      a: record.a,
      b: record.b,
      low: neighbours.length === 1 ? neighbours[0]! : 0,
      height: roomIndex === null ? wallHeight : rooms[roomIndex]!.ceilingHeight,
    });
  }
  return derived;
};
