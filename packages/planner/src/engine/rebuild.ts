import { current, isDraft, type WritableDraft } from 'immer';

import { areaPairs, contourFaces } from '../document/geometry/areas/areaEdges';
import { reconcileCuts } from '../document/geometry/areas/cutRecords';
import { type WallAxis, findAxes } from '../document/geometry/axes/findAxes';
import { layoutFaces } from '../document/geometry/axes/layoutFaces';
import { canonicalCycleKey, sameCycle } from '../document/geometry/contours/cyclicSequence';
import { rebuildContours } from '../document/geometry/contours/rebuildContours';
import { contourArea } from '../document/geometry/predicates/contourArea';
import { sortByArea } from '../document/geometry/predicates/sortByArea';
import { matchRoomRecords } from '../document/geometry/reattach/matchRoomRecords';
import { createId as createUuid, type Id } from '../document/id';
import type {
  Area,
  Contour,
  ContourKind,
  Cover,
  Cut,
  Floor,
  FloorLayout,
  PlanPosition,
  PlannerDocument,
  Point,
  Room,
} from '../document/PlannerDocument';
import { quantize } from '../document/quantize';
import {
  type AreaGeometry,
  type CutGeometry,
  type DerivedArea,
  type DerivedCut,
  derivedAreas,
  derivedCuts,
} from './derivedAreas';
import { type CoverGeometry, type DerivedCeiling, type DerivedCover, derivedCovers } from './derivedCovers';
import { type DerivedFace, type DerivedSkirting, type FaceRoom, derivedFaces } from './derivedFaces';
import { createTriangleResolver } from './derivedRegions';
import { normalizeAreas } from './normalizeAreas';
import { normalizeCovers } from './normalizeCovers';
import { coordinateKey, createPointWeld, dedupeCycle, sameArray } from './normalizeIds';

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
 * пересборками нет (Q3/Q35): комнаты, стены, полы, зоны и вырезы адресуются id хранимых контуров/записей,
 * оси — парой граней, грани и плинтусы — контуром и парой id концов. Только plain-значения: ссылки на узлы
 * замороженного снимка допустимы, узлы черновика — нет.
 *
 * Состав 2b (решение (2) задачи 0070, строка в ADR 0017 «Что важно знать»): к `walls`/`rooms`/`axes` шага 2
 * добавлены `covers` (полы), `ceilings` (потолки — **ссылкой** на пол, форма 1-в-1), `areas` (крышки зон),
 * `cuts` (вертикальные грани вырезов с двумя высотами), `faces` (верх стены на грани комнаты и признак
 * «совпала с ребром зоны») и `skirtings` (осевые квады плинтусов). Позже без смены формы: дырки проёмов и
 * индекс проём→ось, разрывы плинтуса (`gaps`, шаг 6), коннекторы и меши (шаг 4), профили и материалы (шаг 7).
 */
export interface DerivedFloor {
  readonly id: Id;
  readonly walls: readonly DerivedWall[];
  readonly rooms: readonly DerivedRoom[];
  readonly axes: readonly WallAxis[];
  readonly covers: readonly DerivedCover[];
  /** Ровно один потолок на каждый пол `covers`, в том же порядке. */
  readonly ceilings: readonly DerivedCeiling[];
  readonly areas: readonly DerivedArea[];
  readonly cuts: readonly DerivedCut[];
  readonly faces: readonly DerivedFace[];
  readonly skirtings: readonly DerivedSkirting[];
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
 * (`outer` = обводы тел стен, `inner` = комнаты; рёбра хранимых зон идут туда же cut-парами; дисциплина id —
 * по квантованной координате, контур сохраняет id при той же циклической последовательности точек; порядок —
 * `sortByArea`), (2) пере-привязывает `rooms[]` (`compareContoursByArea`, сироты остаются, новым — высота
 * проекта), (3) отбраковывает зоны без опоры/с пересечением стен и сводит `cuts[]` к нужному набору
 * (`normalizeAreas`), (4)–(6) ужимает хранимые полы, дописывает авто-полы, сливает связанные и снимает
 * осиротевшие дырки (`normalizeCovers`), после чего удаляет точки без владельцев (`contours`/`covers`/
 * `areas`/`cuts`). Пишет в черновик только при фактическом изменении: ссылки неизменённых узлов сохраняются.
 * Идемпотентна и по значению, и по ссылке: `normalize(normalize(x)) == normalize(x)` (ADR 0018 D3).
 */
export const normalize = (draft: WritableDraft<PlannerDocument>, options: NormalizeOptions = {}): void => {
  const createId = options.createId ?? createUuid;
  const warn = options.warn ?? (() => {});
  for (const floor of draft.floors) normalizeFloor(floor, draft.settings.wallHeight, createId, warn);
};

/**
 * Построение производного — вторая фаза rebuild: чистая функция от **финализированного** (замороженного)
 * снимка, поэтому в `DerivedState` не могут утечь прокси immer. Триангуляция нормализованного `layout`
 * (рёбра зон — теми же cut-парами, что в `normalize`) → `walls`/`rooms` (треугольники по id точек) →
 * `axes` (C8) → полы и потолки своей триангуляцией (`derivedCovers`) → крышки зон и высоты вырезов
 * (`derivedAreas`/`derivedCuts`) → высоты граней комнат и плинтусы (`derivedFaces`). Вершина без id,
 * контур/запись без пары, пол без группы — нарушение инвариантов нормализации: предупреждение в `warn`,
 * элемент пропускается, исключений нет.
 */
export const rebuild = (document: PlannerDocument, options: RebuildOptions = {}): DerivedState => ({
  floors: document.floors.map(floor => rebuildFloor(floor, document.settings.wallHeight, options.warn ?? (() => {}))),
});

// ---------------------------------------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------------------------------------

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
  // Рёбра хранимых зон идут в триангуляцию как fixed-пары (ADR 0017 C6): треугольники ложатся по границе зоны,
  // а интерьерные cut-рёбра границей комнаты не считаются — правило живёт внутри `rebuildContours`.
  const cutPairs = layout.areas.flatMap(area => areaPairs(resolvePoints(area.points, layout.points)));
  const result = rebuildContours({
    outer: stored.filter(c => c.kind === 'outer').map(c => c.points),
    inner: stored.filter(c => c.kind === 'inner').map(c => c.points),
    cutPairs,
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
  // Дисциплина общих вершин полов/зон (ADR 0016 B4, ADR 0017 C1): вершина, попавшая в пределы кванта от уже
  // существующей точки этажа, берёт её координату и id. Контуров это не касается — их вершины приходят из
  // **той же** триангуляции, что и точки этажа, и опознаются точным ключом (см. `createPointWeld`).
  const weld = createPointWeld(idByKey);
  const anchoredIdOf = (position: PlanPosition): Id => idOf(weld(position));
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

  // Геометрия новых комнат и тел стен — общий вход фаз (3)–(6); координаты берутся по назначенным id,
  // чтобы хранимое и то, что видят полы/зоны, не расходились после схлопывания дублей (`dedupeCycle`).
  const positionOf = (id: Id): Point => newPoints.get(id) ?? layout.points[id]!;
  const roomContours: PlanPosition[][] = [];
  const wallContours: PlanPosition[][] = [];
  candidates.forEach(candidate => {
    (candidate.kind === 'inner' ? roomContours : wallContours).push(candidate.ids.map(positionOf));
  });

  // (3) Зоны и cuts.
  const areaGeometry = layout.areas.map(area => {
    const points = resolvePoints(area.points, layout.points);
    // Зона с пропавшим id опоры уже не имеет — отбраковывается вместе с потерявшими её.
    return points.length === area.points.length ? points : null;
  });
  const areasResult = normalizeAreas({
    areas: areaGeometry,
    rooms: roomContours,
    walls: wallContours,
    roomPoints: roomContours.flat(),
    faces: contourFaces([...wallContours, ...roomContours]),
    idOf: anchoredIdOf,
  });
  const nextDraftAreas = areasResult.kept.map((kept): WritableDraft<Area> => {
    const existing = draftLayout.areas[kept.index]!;
    if (!sameArray(existing.points, kept.points)) existing.points = kept.points;
    return existing;
  });
  if (!sameArray(draftLayout.areas, nextDraftAreas)) draftLayout.areas = nextDraftAreas;

  // `reconcileCuts` всегда отдаёт новый массив в порядке `required` — пишем только при фактическом изменении,
  // иначе `normalize` перестал бы быть идемпотентным по ссылке (ADR 0017 «Что важно знать», ADR 0018 D3).
  const nextDraftCuts = reconcileCuts<WritableDraft<Cut>>(draftLayout.cuts, areasResult.cuts, edge => ({
    id: createId(),
    a: edge.a,
    b: edge.b,
  }));
  if (!sameArray(draftLayout.cuts, nextDraftCuts)) draftLayout.cuts = nextDraftCuts;

  // (4)–(6) Полы: ужать хранимые, дописать авто-полы, слить связанные, снять осиротевшие дырки.
  const coversResult = normalizeCovers({
    covers: layout.covers.map(cover => ({
      kind: cover.kind,
      pointIds: cover.points,
      points: resolvePoints(cover.points, layout.points),
      ceilingHidden: cover.ceilingHidden,
    })),
    rooms: roomContours,
    walls: wallContours,
    idOf: anchoredIdOf,
    weld,
  });
  let nextCovers: readonly (WritableDraft<Cover> | Cover)[] = draftLayout.covers;
  if (coversResult.softFail) {
    // Как в фазе (1): неполный результат обхода хранимое не переписывает — полы пользователя остаются как есть.
    warn(`normalize: cover tracing soft-fail on floor ${floor.id} — covers left as is`);
  } else if (!coversResult.converged) {
    // Неподвижная точка (4)+(5) не достигнута за отведённые проходы. Записать несошедшееся состояние — значит
    // сломать `normalize(normalize(x)) == normalize(x)`, на котором держится restore undo/redo (ADR 0018 D3),
    // поэтому политика та же, что у soft-fail: хранимое как есть, факт — в `warn`.
    warn(`normalize: cover rebuild did not converge on floor ${floor.id} — covers left as is`);
  } else {
    const oldCoverIds = new Map<string, Id[]>();
    for (const cover of layout.covers) {
      const key = `${cover.kind}:${canonicalCycleKey(cover.points)}`;
      const list = oldCoverIds.get(key);
      if (list) list.push(cover.id);
      else oldCoverIds.set(key, [cover.id]);
    }
    const draftCovers = new Map(draftLayout.covers.map(cover => [cover.id, cover]));
    const rebuilt = coversResult.covers.map((cover): WritableDraft<Cover> | Cover => {
      const id = oldCoverIds.get(`${cover.kind}:${canonicalCycleKey(cover.points)}`)?.shift() ?? createId();
      const existing = draftCovers.get(id);
      // Вид совпадает по построению: ключ сохранения id включает `kind`.
      if (!existing) return { id, kind: cover.kind, points: cover.points, ceilingHidden: cover.ceilingHidden };
      if (!sameArray(existing.points, cover.points)) existing.points = cover.points;
      if (existing.ceilingHidden !== cover.ceilingHidden) existing.ceilingHidden = cover.ceilingHidden;
      return existing;
    });
    if (!sameArray(draftLayout.covers, rebuilt)) draftLayout.covers = rebuilt as WritableDraft<Cover>[];
    nextCovers = rebuilt;
  }

  // Точки: владельцы — contours/covers/areas/cuts; новые добавляются, только если ими владеют, лишние удаляются.
  const owned = new Set<Id>();
  for (const contour of nextContours) for (const id of contour.points) owned.add(id);
  for (const cover of nextCovers) for (const id of cover.points) owned.add(id);
  for (const area of nextDraftAreas) for (const id of area.points) owned.add(id);
  for (const cut of nextDraftCuts) {
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

// ---------------------------------------------------------------------------------------------------------
// rebuild
// ---------------------------------------------------------------------------------------------------------

const rebuildFloor = (floor: Floor, wallHeight: number, warn: WarningSink): DerivedFloor => {
  const { layout } = floor;
  const contours = layout.contours
    .map(contour => ({ contour, points: resolvePoints(contour.points, layout.points) }))
    .filter(entry => entry.points.length >= 3);
  // Зоны и вырезы с разрешёнными координатами. Рёбра зон уходят в триангуляцию теми же cut-парами, что в
  // `normalize` (ADR 0017 C6): без них группы не были бы разрезаны по границе зоны и крышку зоны нечем было
  // бы набрать; комнат это деление не порождает — интерьерные cut-рёбра склеиваются в `rebuildContours`.
  const areas: AreaGeometry[] = layout.areas.map(area => {
    const points = resolvePoints(area.points, layout.points);
    return { record: area, positions: points.length === area.points.length ? points : null };
  });
  const cuts: CutGeometry[] = layout.cuts.map(cut => {
    const a = layout.points[cut.a];
    const b = layout.points[cut.b];
    return { record: cut, positions: a !== undefined && b !== undefined ? [a, b] : null };
  });
  const result = rebuildContours({
    outer: contours.filter(c => c.contour.kind === 'outer').map(c => c.points),
    inner: contours.filter(c => c.contour.kind === 'inner').map(c => c.points),
    cutPairs: areas.flatMap(area => (area.positions === null ? [] : areaPairs(area.positions))),
  });
  if (result.softFail) warn(`rebuild: contour tracing soft-fail on floor ${floor.id}`);

  const idByKey = indexPointsByCoordinate(layout.points);
  const resolver = createTriangleResolver(result.triangulation, idByKey, () =>
    warn(`rebuild: triangulation vertex without a point id on floor ${floor.id} — layout is not normalized`),
  );
  const idLoop = (loop: readonly number[]): Id[] | null => {
    const ids: Id[] = [];
    for (const index of loop) {
      const id = resolver.vertex(index);
      if (id === null) return null;
      ids.push(id);
    }
    return ids;
  };

  const walls: DerivedWall[] = [];
  const rooms: DerivedRoom[] = [];
  // Комнаты как хозяйки полов/зон/вырезов и как источник граней — собираются в том же проходе.
  const roomRefs: FaceRoom[] = [];
  for (const { contour } of contours) {
    if (contour.kind === 'outer') {
      const wall = result.walls.find(candidate => matchesContour(idLoop(candidate.outline), contour));
      if (!wall) {
        warn(`rebuild: outer contour ${contour.id} has no fill group on floor ${floor.id}`);
        continue;
      }
      walls.push({ contourId: contour.id, triangles: resolver.triangles(wall.triangles) });
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
      triangles: resolver.triangles(room.triangles),
      area: Math.abs(contourArea(outlinePositions)) - holesArea,
    });
    roomRefs.push({
      contourId: contour.id,
      roomId: record.id,
      points: contour.points,
      positions: outlinePositions,
      ceilingHeight: record.ceilingHeight,
    });
  }

  const hosts = roomRefs.map(room => ({
    roomId: room.roomId,
    outline: room.positions,
    ceilingHeight: room.ceilingHeight,
  }));
  const storedCovers: CoverGeometry[] = layout.covers.map(cover => {
    const points = resolvePoints(cover.points, layout.points);
    return { record: cover, positions: points.length === cover.points.length ? points : null };
  });
  const { covers, ceilings } = derivedCovers({
    covers: storedCovers,
    rooms: hosts,
    idByKey,
    wallHeight,
    floorId: floor.id,
    warn,
  });

  return {
    id: floor.id,
    walls,
    rooms,
    axes: findAxes(layoutFaces(layout.contours, layout.points)),
    covers,
    ceilings,
    areas: derivedAreas({
      areas,
      rooms: hosts,
      triangulation: result.triangulation,
      resolver,
      floorId: floor.id,
      warn,
    }),
    cuts: derivedCuts({
      cuts,
      areas,
      rooms: hosts,
      faces: contourFaces(contours.map(entry => entry.points)),
      idOf: position => idByKey.get(coordinateKey(position)) ?? null,
      wallHeight,
      floorId: floor.id,
      warn,
    }),
    ...derivedFaces({
      rooms: roomRefs,
      areas: areas.flatMap(area =>
        area.positions === null ? [] : [{ points: area.positions, height: area.record.height }],
      ),
    }),
  };
};

const matchesContour = (ids: readonly Id[] | null, contour: Contour): boolean =>
  ids !== null && sameCycle(ids, contour.points);
