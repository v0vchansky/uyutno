import { current, isDraft, type WritableDraft } from 'immer';

import { type WallAxis, findAxes } from '../document/geometry/axes/findAxes';
import { layoutFaces } from '../document/geometry/axes/layoutFaces';
import { canonicalCycleKey, sameCycle } from '../document/geometry/contours/cyclicSequence';
import { rebuildContours } from '../document/geometry/contours/rebuildContours';
import { contourArea } from '../document/geometry/predicates/contourArea';
import { sortByArea } from '../document/geometry/predicates/sortByArea';
import { matchRoomRecords } from '../document/geometry/reattach/matchRoomRecords';
import { createId as createUuid, type Id } from '../document/id';
import type {
  Contour,
  ContourKind,
  Floor,
  FloorLayout,
  PlanPosition,
  PlannerDocument,
  Point,
  Room,
} from '../document/PlannerDocument';
import { quantize } from '../document/quantize';

/** Треугольник по id точек `layout.points` (ADR 0017 C1): вход нормализован, Steiner-точек нет. */
export type Triangle = [Id, Id, Id];

/** Тело стены — fill-группа триангуляции на `outer`-контур. */
export interface DerivedWall {
  readonly contourId: Id;
  readonly triangles: readonly Triangle[];
}

/** Комната: `outline` — точки её `inner` (это и есть `anchor`), `holes` — обводы того, что лежит непосредственно внутри. */
export interface DerivedRoom {
  readonly contourId: Id;
  readonly roomId: Id;
  readonly outline: readonly Id[];
  readonly holes: readonly (readonly Id[])[];
  readonly triangles: readonly Triangle[];
  /** Площадь, см²: обвод минус дырки. */
  readonly area: number;
}

/**
 * Производное состояние этажа — результат rebuild, живёт в движке и не сериализуется (ADR 0016 «Хранится /
 * выводится», ADR 0017 C1). Пересоздаётся целиком на каждой транзакции содержимого, стабильных id между
 * пересборками нет (Q3/Q35): комнаты и стены адресуются id хранимых контуров/записей, оси — парой граней.
 * Только plain-значения: ссылки на узлы замороженного снимка допустимы, узлы черновика — нет. Позже без
 * смены формы: полы/зоны/cuts (2b), дырки проёмов и индекс проём→ось (шаг 6), коннекторы (шаг 4).
 */
export interface DerivedFloor {
  readonly id: Id;
  readonly walls: readonly DerivedWall[];
  readonly rooms: readonly DerivedRoom[];
  readonly axes: readonly WallAxis[];
}

export interface DerivedState {
  readonly floors: readonly DerivedFloor[];
}

/** Приёмник предупреждений ядра (soft-fail обхода, нарушенные инварианты) — движок отдаёт их в DI-логгер. */
export type WarningSink = (message: string) => void;

export interface NormalizeOptions {
  /** Генератор id новых точек/контуров/записей — инжектируется для детерминированных фикстур (ADR 0017 C10). */
  createId?: () => Id;
  warn?: WarningSink;
}

export interface RebuildOptions {
  warn?: WarningSink;
}

/**
 * Нормализация хранимого — первая фаза rebuild, часть транзакции фасада (ADR 0015 A2, ADR 0017 C1/C6/C7):
 * получает черновик документа **после** мутации команды и по каждому этажу (1) прогоняет `rebuildContours`
 * по хранимым `outer`/`inner` и переписывает `layout.contours`/`layout.points` результатом слияния
 * (`outer` = обводы тел стен, `inner` = комнаты; дисциплина id — по квантованной координате, контур сохраняет
 * id при той же циклической последовательности точек; точки без владельцев удаляются; порядок — `sortByArea`),
 * (2) пере-привязывает `rooms[]` (`compareContoursByArea`, сироты остаются, новым — высота проекта).
 * Пишет в черновик только при фактическом изменении: ссылки неизменённых узлов сохраняются.
 * Шаг 2b добавит фазы (3)–(6): зоны/cuts/полы. Идемпотентна: `normalize(normalize(x)) == normalize(x)`.
 */
export const normalize = (draft: WritableDraft<PlannerDocument>, options: NormalizeOptions = {}): void => {
  const createId = options.createId ?? createUuid;
  const warn = options.warn ?? (() => {});
  for (const floor of draft.floors) normalizeFloor(floor, draft.settings.wallHeight, createId, warn);
};

/**
 * Построение производного — вторая фаза rebuild: чистая функция от **финализированного** (замороженного)
 * снимка, поэтому в `DerivedState` не могут утечь прокси immer. Триангуляция нормализованного `layout` →
 * `walls`/`rooms` (треугольники по id точек) → `axes` (C8). Вершина без id или контур/запись без пары —
 * нарушение инвариантов нормализации: предупреждение в `warn`, элемент пропускается, исключений нет.
 */
export const rebuild = (document: PlannerDocument, options: RebuildOptions = {}): DerivedState => ({
  floors: document.floors.map(floor => rebuildFloor(floor, options.warn ?? (() => {}))),
});

// ---------------------------------------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------------------------------------

/** Ключ квантованной координаты — тождество точек (ADR 0017 C1/C3). */
const coordinateKey = (position: PlanPosition): string => `${quantize(position.x)}|${quantize(position.y)}`;

/** Существующие точки по координате: две точки в одной координате = одна, выживает меньший (старший uuidv7) id. */
const indexPointsByCoordinate = (points: Readonly<Record<Id, Point>>): Map<string, Id> => {
  const index = new Map<string, Id>();
  for (const point of Object.values(points)) {
    const key = coordinateKey(point);
    const existing = index.get(key);
    if (existing === undefined || point.id < existing) index.set(key, point.id);
  }
  return index;
};

const resolvePoints = (ids: readonly Id[], points: Readonly<Record<Id, Point>>): Point[] =>
  ids.map(id => points[id]).filter((point): point is Point => point !== undefined);

/** Кандидат в хранимый контур после слияния: вид, id точек, координаты (для сортировки/якорей). */
interface ContourCandidate {
  kind: ContourKind;
  points: PlanPosition[];
  ids: Id[];
}

const normalizeFloor = (
  floor: WritableDraft<Floor>,
  wallHeight: number,
  createId: () => Id,
  warn: WarningSink,
): void => {
  // Снимок этажа как plain-объект (быстрые чтения вне прокси); вне `produce` черновика нет — читаем как есть.
  const layout: FloorLayout = isDraft(floor.layout) ? current(floor.layout) : floor.layout;
  const stored = layout.contours
    .map(contour => ({ kind: contour.kind, points: resolvePoints(contour.points, layout.points) }))
    .filter(contour => contour.points.length >= 3);
  const result = rebuildContours({
    outer: stored.filter(c => c.kind === 'outer').map(c => c.points),
    inner: stored.filter(c => c.kind === 'inner').map(c => c.points),
  });
  if (result.softFail) {
    // Обход хотя бы одной группы оборвался: результат неполон, переписывать хранимое им — терять контуры
    // пользователя без следа. Хранимое остаётся как есть (снимок undo не портится), rebuild построит что сможет.
    warn(`normalize: contour tracing soft-fail on floor ${floor.id} — layout left as is`);
    return;
  }

  const { vertices } = result.triangulation;
  const loops: { kind: ContourKind; loop: readonly number[] }[] = [
    ...result.walls.map(wall => ({ kind: 'outer' as const, loop: wall.outline })),
    ...result.rooms.map(room => ({ kind: 'inner' as const, loop: room.outline })),
  ];
  const sortedLoops = sortByArea(loops.map(({ kind, loop }) => ({ kind, loop, points: loop.map(i => vertices[i]!) })));

  // Дисциплина id точек: существующая по квантованной координате, иначе новая — в порядке отсортированных обводов.
  const idByKey = indexPointsByCoordinate(layout.points);
  const newPoints = new Map<Id, Point>();
  const idOf = (position: PlanPosition): Id => {
    const key = coordinateKey(position);
    let id = idByKey.get(key);
    if (id === undefined) {
      id = createId();
      idByKey.set(key, id);
      newPoints.set(id, { id, x: quantize(position.x), y: quantize(position.y) });
    }
    return id;
  };
  const candidates: ContourCandidate[] = [];
  for (const { kind, points } of sortedLoops) {
    const ids = dedupeCycle(points.map(idOf));
    if (ids.length < 3) continue;
    candidates.push({ kind, ids, points });
  }

  // Id контуров: прежний при той же циклической последовательности точек и виде, иначе новый.
  const oldIdByCycle = new Map<string, Id[]>();
  for (const contour of layout.contours) {
    const key = `${contour.kind}:${canonicalCycleKey(contour.points)}`;
    const list = oldIdByCycle.get(key);
    if (list) list.push(contour.id);
    else oldIdByCycle.set(key, [contour.id]);
  }
  const contourIds = candidates.map(candidate => {
    const key = `${candidate.kind}:${canonicalCycleKey(candidate.ids)}`;
    return oldIdByCycle.get(key)?.shift() ?? createId();
  });

  // Пере-привязка rooms[]: якоря разрешаются по координатам черновика ДО удаления точек.
  const records = layout.rooms.map(room => ({
    anchorIds: room.anchor,
    anchor: resolvePoints(room.anchor, layout.points),
  }));
  const detected = candidates
    .map((candidate, index) => ({ candidate, id: contourIds[index]! }))
    .filter(({ candidate }) => candidate.kind === 'inner');
  const donors = matchRoomRecords(
    records,
    detected.map(({ candidate }) => ({ ids: candidate.ids, outline: candidate.points })),
  );
  const usedRecords = new Set<number>();
  const nextRooms: Room[] = [];
  detected.forEach(({ candidate }, index) => {
    const donor = donors[index]!;
    if (donor === null) {
      nextRooms.push({ id: createId(), anchor: candidate.ids, name: '', ceilingHeight: wallHeight });
      return;
    }
    const record = layout.rooms[donor]!;
    if (usedRecords.has(donor)) {
      // Вторая половинка разделённой комнаты: атрибуты донора, своя запись.
      nextRooms.push({ id: createId(), anchor: candidate.ids, name: record.name, ceilingHeight: record.ceilingHeight });
      return;
    }
    usedRecords.add(donor);
    nextRooms.push(sameArray(record.anchor, candidate.ids) ? record : { ...record, anchor: candidate.ids });
  });
  layout.rooms.forEach((record, index) => {
    if (!usedRecords.has(index)) nextRooms.push(record);
  });

  // Запись в черновик — только при фактическом изменении.
  const draftLayout = floor.layout;
  const draftById = new Map(draftLayout.contours.map(contour => [contour.id, contour]));
  const nextContours = candidates.map((candidate, index): WritableDraft<Contour> | Contour => {
    const id = contourIds[index]!;
    const existing = draftById.get(id);
    if (!existing) return { id, kind: candidate.kind, points: candidate.ids };
    // Вид совпадает по построению: ключ сохранения id включает `kind`.
    if (!sameArray(existing.points, candidate.ids)) existing.points = candidate.ids;
    return existing;
  });
  if (!sameArray(draftLayout.contours, nextContours)) draftLayout.contours = nextContours as WritableDraft<Contour>[];

  const draftRooms = new Map(draftLayout.rooms.map(room => [room.id, room]));
  const nextDraftRooms = nextRooms.map((room): WritableDraft<Room> | Room => {
    const existing = draftRooms.get(room.id);
    if (!existing) return room;
    if (!sameArray(existing.anchor, room.anchor)) existing.anchor = room.anchor;
    return existing;
  });
  if (!sameArray(draftLayout.rooms, nextDraftRooms)) draftLayout.rooms = nextDraftRooms as WritableDraft<Room>[];

  // Точки: владельцы — contours/covers/areas/cuts; новые добавляются, только если ими владеют, лишние удаляются.
  const owned = new Set<Id>();
  for (const contour of nextContours) for (const id of contour.points) owned.add(id);
  for (const cover of layout.covers) for (const id of cover.points) owned.add(id);
  for (const area of layout.areas) for (const id of area.points) owned.add(id);
  for (const cut of layout.cuts) {
    owned.add(cut.a);
    owned.add(cut.b);
  }
  for (const point of newPoints.values()) {
    if (owned.has(point.id)) draftLayout.points[point.id] = point;
  }
  for (const id of Object.keys(layout.points)) {
    if (!owned.has(id)) delete draftLayout.points[id];
  }
};

/** Схлопывание подряд идущих одинаковых id (в том числе на замыкании) — две вершины квантовались в одну точку. */
const dedupeCycle = (ids: readonly Id[]): Id[] => {
  const result: Id[] = [];
  for (const id of ids) {
    if (result[result.length - 1] !== id) result.push(id);
  }
  while (result.length > 1 && result[0] === result[result.length - 1]) result.pop();
  return result;
};

const sameArray = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

// ---------------------------------------------------------------------------------------------------------
// rebuild
// ---------------------------------------------------------------------------------------------------------

const rebuildFloor = (floor: Floor, warn: WarningSink): DerivedFloor => {
  const { layout } = floor;
  const contours = layout.contours
    .map(contour => ({ contour, points: resolvePoints(contour.points, layout.points) }))
    .filter(entry => entry.points.length >= 3);
  const result = rebuildContours({
    outer: contours.filter(c => c.contour.kind === 'outer').map(c => c.points),
    inner: contours.filter(c => c.contour.kind === 'inner').map(c => c.points),
  });
  if (result.softFail) warn(`rebuild: contour tracing soft-fail on floor ${floor.id}`);

  const idByKey = indexPointsByCoordinate(layout.points);
  const { vertices, triangles } = result.triangulation;
  const vertexIds = vertices.map(vertex => idByKey.get(coordinateKey(vertex)) ?? null);
  let missingVertexReported = false;
  const idLoop = (loop: readonly number[]): Id[] | null => {
    const ids: Id[] = [];
    for (const index of loop) {
      const id = vertexIds[index];
      if (id === null || id === undefined) return null;
      ids.push(id);
    }
    return ids;
  };
  const idTriangles = (indices: readonly number[]): Triangle[] => {
    const out: Triangle[] = [];
    for (const t of indices) {
      const [a, b, c] = triangles[t]!;
      const ia = vertexIds[a];
      const ib = vertexIds[b];
      const ic = vertexIds[c];
      if (!ia || !ib || !ic) {
        if (!missingVertexReported) {
          warn(`rebuild: triangulation vertex without a point id on floor ${floor.id} — layout is not normalized`);
          missingVertexReported = true;
        }
        continue;
      }
      out.push([ia, ib, ic]);
    }
    return out;
  };

  const walls: DerivedWall[] = [];
  const rooms: DerivedRoom[] = [];
  for (const { contour } of contours) {
    if (contour.kind === 'outer') {
      const wall = result.walls.find(candidate => matchesContour(idLoop(candidate.outline), contour));
      if (!wall) {
        warn(`rebuild: outer contour ${contour.id} has no fill group on floor ${floor.id}`);
        continue;
      }
      walls.push({ contourId: contour.id, triangles: idTriangles(wall.triangles) });
      continue;
    }
    const room = result.rooms.find(candidate => matchesContour(idLoop(candidate.outline), contour));
    if (!room) {
      warn(`rebuild: inner contour ${contour.id} has no room group on floor ${floor.id}`);
      continue;
    }
    const record = layout.rooms.find(candidate => sameCycle(candidate.anchor, contour.points));
    if (!record) {
      warn(`rebuild: room contour ${contour.id} has no rooms[] record on floor ${floor.id}`);
      continue;
    }
    const holes = room.holes.map(idLoop).filter((hole): hole is Id[] => hole !== null);
    const outlinePositions = resolvePoints(contour.points, layout.points);
    const holesArea = holes.reduce((sum, hole) => sum + Math.abs(contourArea(resolvePoints(hole, layout.points))), 0);
    rooms.push({
      contourId: contour.id,
      roomId: record.id,
      outline: contour.points,
      holes,
      triangles: idTriangles(room.triangles),
      area: Math.abs(contourArea(outlinePositions)) - holesArea,
    });
  }

  return { id: floor.id, walls, rooms, axes: findAxes(layoutFaces(layout.contours, layout.points)) };
};

const matchesContour = (ids: readonly Id[] | null, contour: Contour): boolean =>
  ids !== null && sameCycle(ids, contour.points);
