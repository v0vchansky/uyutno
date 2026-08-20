import { findCoverHoles } from '../document/geometry/covers/findCoverHoles';
import { contourArea } from '../document/geometry/predicates/contourArea';
import { triangulateContours } from '../document/geometry/triangulate/triangulateContours';
import type { Id } from '../document/id';
import type { Cover, PlanPosition } from '../document/PlannerDocument';
import { createTriangleResolver, innermostIndex, regionPoint } from './derivedRegions';
import type { Triangle, WarningSink } from './rebuild';

/**
 * Пол в производном: обвод и дырки — **по id точек `layout`** (то же, что хранит `Cover`, только с уже
 * вычисленной вложенностью), треугольники — по id тех же точек. `roomId` — комната, внутри которой пол
 * лежит; `null` — пол вне комнат (после `normalize` таких не бывает, но `rebuild` работает и на
 * ненормализованном снимке). `area` — площадь обвода за вычетом дырок, см², как у `DerivedRoom`.
 */
export interface DerivedCover {
  readonly coverId: Id;
  readonly roomId: Id | null;
  readonly outline: readonly Id[];
  readonly holes: readonly (readonly Id[])[];
  readonly triangles: readonly Triangle[];
  readonly area: number;
}

/**
 * Потолок «висит» на поле: спека 02 «Потолки» — «форма 1-в-1 повторяет форму пола, включая дырки»,
 * поэтому геометрия не дублируется, а адресуется ссылкой `coverId`. У каждого multi-material пола
 * внутри комнаты — свой кусок потолка, что и даёт запись на пол, а не на комнату.
 *
 * - `height` — **с комнаты** (`Room.ceilingHeight`), а не с пола: спека 02 «Высота потолка» —
 *   «несколько multi-material полов внутри одной комнаты не могут иметь разные высоты потолка — потолок
 *   один на всю комнату». Расхождение с референсом осознанное: у него `DataCeiling.height` лежит на полу
 *   (`plannercore.js:61804`), но наша модель высоту на полу не хранит. Пол вне комнат берёт
 *   `settings.wallHeight`.
 * - `hidden` — **с пола** (`Cover.ceilingHidden`): спека 02 «Видимость потолка» хранит флаг именно на полу
 *   и наследует его по перекрытию площади независимо от атрибутов комнаты.
 *
 * Камерной авто-логики скрытия здесь нет и быть не может: «потолок скрыт, если камера выше потолка» —
 * состояние вида, её место в проекции (шаг 4). Крышка зоны (`DerivedArea`) этой логике не подчиняется
 * вовсе (спека 02 «Видимость крышки зоны»), поэтому своего `hidden` у неё нет.
 */
export interface DerivedCeiling {
  readonly coverId: Id;
  readonly height: number;
  readonly hidden: boolean;
}

/** Хранимый пол с разрешёнными координатами вершин (`null` — хоть один id не разрешился). */
export interface CoverGeometry {
  record: Cover;
  positions: readonly PlanPosition[] | null;
}

/** Комната как хозяйка пола: обвод в координатах, id записи и высота её потолка. */
export interface CoverRoom {
  roomId: Id;
  outline: readonly PlanPosition[];
  ceilingHeight: number;
}

export interface DerivedCoversInput {
  /** Хранимые полы в порядке `layout.covers` — он же порядок выхода. */
  covers: readonly CoverGeometry[];
  rooms: readonly CoverRoom[];
  /** Id точек этажа по ключу квантованной координаты (`coordinateKey`). */
  idByKey: ReadonlyMap<string, Id>;
  /** `settings.wallHeight` — высота потолка пола, не попавшего ни в одну комнату. */
  wallHeight: number;
  floorId: Id;
  warn: WarningSink;
}

export interface DerivedCoversResult {
  covers: DerivedCover[];
  ceilings: DerivedCeiling[];
}

/**
 * Полы и потолки производного (задача 0070, ADR 0017 C1/C9; спека 02 «Потолки», «Автоматическая
 * перестройка», шаг 6).
 *
 * Полы живут **своей** триангуляцией, а не триангуляцией контуров этажа: их вершины в общем пуле точек, но
 * их рёбра в `layout.contours` не входят, и без них треугольники не легли бы по границам полов. Вход —
 * ровно хранимый набор (`kind: 'outer'` → `outer`, `kind: 'inner'` → `inner`), поэтому fill-области = «пол
 * минус дырка» и никаких `bound`/`subtract` не нужно: подрезка под комнаты и вычитание тел стен уже
 * случились в `normalize` (фазы (4)–(6)), а `rebuild` — чистая функция от готового снимка.
 *
 * Область (группа треугольников) достаётся **ближайшему объемлющему** обводу (`innermostIndex`): пол,
 * лежащий в дырке другого пола, забирает свои треугольники себе, а не отдаёт хозяину дырки. Вложенность
 * дырок пересчитывается тем же `findCoverHoles`, что и в `normalize` — набор записей самосогласован, так
 * что результат тот же; хранить вычисленную принадлежность отдельно значило бы завести второй источник правды.
 *
 * Комната пола — по точке-представителю его области, а не по первой вершине (`findRoomsForCovers`
 * референса, `plannercore.js:55324`): вершина пола обычно лежит **на** контуре комнаты, и на общей стене
 * двух комнат «на границе» верно сразу для обеих. Точка внутри области отвечает однозначно.
 *
 * Нарушенные инварианты нормализации не бросают исключений: пол с пропавшим id точки, обвод короче трёх
 * вершин и обвод без единой fill-группы — `warn` и пропуск записи (вместе с её потолком).
 */
export const derivedCovers = ({
  covers,
  rooms,
  idByKey,
  wallHeight,
  floorId,
  warn,
}: DerivedCoversInput): DerivedCoversResult => {
  const usable: { record: Cover; positions: readonly PlanPosition[] }[] = [];
  for (const { record, positions } of covers) {
    if (positions === null) {
      warn(`rebuild: cover ${record.id} has a point without a record on floor ${floorId}`);
      continue;
    }
    if (positions.length < 3) {
      warn(`rebuild: cover ${record.id} has less than 3 points on floor ${floorId}`);
      continue;
    }
    usable.push({ record, positions });
  }
  const outer = usable.filter(entry => entry.record.kind === 'outer');
  const inner = usable.filter(entry => entry.record.kind === 'inner');
  if (outer.length === 0) return { covers: [], ceilings: [] };

  const outlines = outer.map(entry => entry.positions);
  const triangulation = triangulateContours({ outer: outlines, inner: inner.map(entry => entry.positions) });
  const resolver = createTriangleResolver(triangulation, idByKey, () =>
    warn(`rebuild: cover triangulation vertex without a point id on floor ${floorId} — layout is not normalized`),
  );

  // Раздача областей обводам: группа достаётся ближайшему объемлющему обводу, её точка-представитель
  // становится (первой) точкой, по которой пол ищет свою комнату.
  const groupTriangles: number[][] = outer.map(() => []);
  const anchors: (PlanPosition | null)[] = outer.map(() => null);
  for (const group of triangulation.groups) {
    if (!group.fill) continue;
    const point = regionPoint(triangulation, group.triangles);
    if (point === null) continue;
    const index = innermostIndex(point, outlines);
    if (index === null) continue;
    groupTriangles[index]!.push(...group.triangles);
    anchors[index] ??= point;
  }

  const { holes } = findCoverHoles(
    outlines,
    inner.map(entry => entry.positions),
  );
  const roomOutlines = rooms.map(room => room.outline);

  const derived: DerivedCover[] = [];
  const ceilings: DerivedCeiling[] = [];
  outer.forEach((entry, index) => {
    const anchor = anchors[index] ?? null;
    if (anchor === null) {
      warn(`rebuild: cover ${entry.record.id} has no fill group on floor ${floorId}`);
      return;
    }
    const owned = holes[index]!;
    const holeArea = owned.reduce((sum, hole) => sum + Math.abs(contourArea(inner[hole]!.positions)), 0);
    const roomIndex = innermostIndex(anchor, roomOutlines);
    const room = roomIndex === null ? null : rooms[roomIndex]!;
    derived.push({
      coverId: entry.record.id,
      roomId: room?.roomId ?? null,
      outline: entry.record.points,
      holes: owned.map(hole => inner[hole]!.record.points),
      // Порядок треугольников — по возрастанию индекса, как у групп `rebuildContours`.
      triangles: resolver.triangles(groupTriangles[index]!.sort((a, b) => a - b)),
      area: Math.abs(contourArea(entry.positions)) - holeArea,
    });
    ceilings.push({
      coverId: entry.record.id,
      height: room?.ceilingHeight ?? wallHeight,
      hidden: entry.record.ceilingHidden,
    });
  });

  return { covers: derived, ceilings };
};
