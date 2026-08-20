import type { CoverShape } from '../document/geometry/covers/coverShape';
import { findAutoCovers } from '../document/geometry/covers/findAutoCovers';
import { findCoverHoles } from '../document/geometry/covers/findCoverHoles';
import { mergeCovers } from '../document/geometry/covers/mergeCovers';
import { rebuildCovers } from '../document/geometry/covers/rebuildCovers';
import { sortByArea } from '../document/geometry/predicates/sortByArea';
import { type AnchoredRecord, matchCoverRecords } from '../document/geometry/reattach/matchCoverRecords';
import type { ContourSet } from '../document/geometry/triangulate/triangulateContours';
import type { Id } from '../document/id';
import type { ContourKind, PlanPosition } from '../document/PlannerDocument';
import { dedupeCycle, type WeldPoint } from './normalizeIds';

/** Минимум вершин, при котором пол остаётся полом (та же граница, что у контуров и каскада `deletePoint`). */
const MIN_COVER_POINTS = 3;

/**
 * Потолок проходов стабилизации набора полов — страховка от зацикливания, как у `clearContour`. В
 * установившемся состоянии хватает одного прохода (вход прохода совпал с его выходом); второй нужен там,
 * где правка стен реально меняет форму пола. Недостижение неподвижной точки за этот потолок — не «сдаться
 * молча», а `converged: false`: вызывающий оставляет хранимые полы как есть и логирует (см. `rebuild.ts`).
 */
const MAX_COVER_PASSES = 4;

/** Хранимый пол на входе пересборки: вид, id точек (для тождества цикла) и их координаты. */
export interface StoredCover {
  kind: ContourKind;
  pointIds: readonly Id[];
  points: readonly PlanPosition[];
  ceilingHidden: boolean;
}

/** Пол после пересборки: вид, id вершин и перенесённые данные. Id самой записи назначает `rebuild.ts`. */
export interface NormalizedCover {
  kind: ContourKind;
  points: Id[];
  ceilingHidden: boolean;
}

export interface NormalizeCoversInput {
  /** Хранимые полы в порядке `layout.covers` — он же порядок «первого пола-донора» спеки 02. */
  covers: readonly StoredCover[];
  /** Полости-комнаты после фазы (1). */
  rooms: ContourSet;
  /** Обводы тел стен после фазы (1). */
  walls: ContourSet;
  /**
   * Разрешение координаты в id точки этажа — та же дисциплина, что у контуров (ADR 0017 C1), но поверх
   * `weld`: вершина пола ссылается на id уже существующей точки (ADR 0016 B4).
   */
  idOf: (position: PlanPosition) => Id;
  /**
   * Приваривание вершины к существующей точке этажа в пределах кванта (`createPointWeld`). Применяется к
   * **каждому** выходу прохода, а не только перед `idOf`: без этого вход следующего прогона `normalize`
   * отличался бы от выхода предыдущего на квант и неподвижной точки не было бы вовсе.
   */
  weld: WeldPoint;
}

export interface NormalizeCoversResult {
  covers: NormalizedCover[];
  /** Хоть один обход оборвался внутри `rebuildContours`: хранимое переписывать нельзя — только `warn`. */
  softFail: boolean;
  /** Неподвижная точка достигнута: выход прохода совпал с его входом. `false` — хранимое не переписывать. */
  converged: boolean;
}

/**
 * Фазы (4)–(6) `normalize` (ADR 0017 C6/C9,
 * [спека 02](../../../../docs/product/features/planner/02-rooms-floors-ceilings.md), шаги 4–6 «Автоматической
 * перестройки») — три чистых кирпича `covers/` в одном порядке, плюс перенос данных полов:
 *
 * - **(4) `rebuildCovers`** — хранимые полы ужимаются под новые комнаты: обводы (`kind: 'outer'`) идут в `covers`,
 *   дырки (`kind: 'inner'`) — в `coverHoles`, комнаты ограничивают, тела стен вычитаются. `separateContacting`
 *   там `true`: касающиеся полы остаются разными телами, склеивает их фаза (5), а не подрезка.
 * - **(5) `findAutoCovers` + `mergeCovers`** — дефолтный пол ищется только там, где после (4) пола не осталось
 *   (в `covers` идут **только обводы**: вырез под лестницу авто-полом не зарастает), после чего объединение
 *   «существующие + новые авто-полы» сливается `mergeCovers` **с касанием** (спека 02: полы, соприкоснувшиеся
 *   или пересёкшиеся косвенно из-за правки стен, объединяются автоматически, без диалога).
 * - **(6) `findCoverHoles`** — вложенность полов от меньшего к большему; дырка, не доставшаяся никакому обводу,
 *   удаляется (спека 02 «Осиротевшие внутренние полы»). В нашей плоской модели (`Cover.kind`) это ещё и то, что
 *   делает набор записей самосогласованным: хранится не дерево, а список, и хозяин дырки вычисляется заново.
 *
 * **Перенос данных полов** — `matchCoverRecords` (перекрытие площади, донор не расходуется), отдельно для обводов
 * и отдельно для дырок: `ceilingHidden` наследуется «внешняя от внешней, дырка от дырки», а у слитого пола донор —
 * первый по порядку хранения, то есть ровно «первый пол-донор» спеки 02. Пол без донора — новый, `ceilingHidden: false`.
 *
 * **Порядок записей** задаёт `sortByArea` — функция одной лишь геометрии. Это не косметика: порядок выхода
 * `rebuildContours` зависит от порядка входа, а вход второго прогона `normalize` — это выход первого; без
 * сортировки набор мог бы «перетасовываться» между прогонами и ломать идемпотентность по ссылке.
 *
 * **Неподвижная точка или отказ.** Проходы (4)+(5) повторяются, пока выход не совпадёт со входом, но не
 * больше `MAX_COVER_PASSES`. Не сошлось — `converged: false`, и вызывающий **не переписывает** хранимые полы
 * (политика soft-fail): записать несошедшееся состояние значило бы сломать
 * `normalize(normalize(x)) == normalize(x)`, на котором держится restore undo/redo (ADR 0018 D3). Сходимость
 * обеспечивает `weld`: без приваривания вершина, посчитанная триангуляцией полов, отличалась бы от угла
 * комнаты на квант и уезжала бы на каждом прогоне (см. `createPointWeld`).
 *
 * **Чего эта функция не делает лишний раз** (ADR 0017 C11 разрешает полный синхронный recompute, но не
 * заведомо пустой): без полов и без комнат не вызывается вовсе; `rebuildCovers` — только когда есть что
 * ужимать; `findAutoCovers` — только когда есть комнаты и свободная площадь могла появиться; `mergeCovers` —
 * только когда полов хотя бы два.
 *
 * Вход не мутируется; `idOf`/`weld` — единственный побочный эффект (регистрация новой точки этажа).
 */
export const normalizeCovers = ({ covers, rooms, walls, idOf, weld }: NormalizeCoversInput): NormalizeCoversResult => {
  // Ранний выход: без хранимых полов и без комнат строить нечего, а `rebuildCovers`/`findAutoCovers` всё равно
  // потянули бы полную триангуляцию тел стен (ADR 0017 C11 разрешает полный recompute, но не пустой).
  if (covers.length === 0 && rooms.length === 0) return { covers: [], softFail: false, converged: true };

  const storedOuter = covers.filter(cover => cover.kind === 'outer');
  const storedInner = covers.filter(cover => cover.kind === 'inner');

  // Стабилизация набора: в `layout.covers` уходит **неподвижная точка** прохода (4)+(5), иначе следующий
  // `normalize` пересобрал бы полы иначе и идемпотентности (ADR 0018 D3) не было бы, а на ней держится restore
  // undo/redo. Один проход её не даёт: обвод строится по триангуляции, вершины которой внесены **прежними**
  // полами (они идут в `subtract`), поэтому в нём остаются вершины, которых на следующем прогоне уже не будет
  // (санитизация PSLG их убирает), а освободившийся при этом микро-участок комнаты ловит уже `findAutoCovers`.
  // Приём тот же, что у `clearContour`: проходы до неподвижной точки с потолком на число итераций. В
  // установившемся состоянии это ровно один проход, который сразу подтверждает совпадение с хранимым.
  let softFail = false;
  let converged = false;
  let outlines = ordered(
    storedOuter.map(cover => cover.points),
    'outer',
    weld,
  );
  let holes = ordered(
    storedInner.map(cover => cover.points),
    'inner',
    weld,
  );
  // Свободная площадь комнат уже застелена предыдущим проходом: `findAutoCovers` по определению отдаёт **всю**
  // свободную площадь, а слияние площадь объединения не меняет. Используется в `skipAuto` ниже.
  let filled = false;
  for (let pass = 0; pass < MAX_COVER_PASSES && !converged; pass++) {
    const shrunk =
      outlines.length === 0 && holes.length === 0
        ? EMPTY_PASS
        : rebuildCovers({ covers: outlines, coverHoles: holes, rooms, walls });
    // Порядок и приваривание — единые для входа прохода, его промежуточных наборов и записей в документе:
    // выход `rebuildContours` зависит от порядка входа, поэтому «совпало как множество» неподвижной точкой
    // ещё не является, а сравнивать и подавать назад надо ровно те координаты, что уйдут в id.
    const shrunkOutlines = ordered(shrunk.covers.map(outlineOf), 'outer', weld);
    const shrunkHoles = ordered(shrunk.covers.flatMap(holesOf), 'inner', weld);
    // Пропуск фазы (5). Свободной площади нет, когда её застелил предыдущий проход и **этот** ужал полы в
    // тождество: площадь объединения не изменилась, значит `findAutoCovers` вернул бы пустой набор. А стоит
    // он ровно столько же, сколько `rebuildCovers` — ADR 0017 C11 разрешает полный синхронный recompute, но
    // не заведомо пустой повторный. Тождество проверяется по координатам, поэтому подрезка даже на квант
    // отправляет проход по общему пути.
    const skipAuto =
      rooms.length === 0 || (filled && sameLoops(outlines, shrunkOutlines) && sameLoops(holes, shrunkHoles));
    const auto = skipAuto ? EMPTY_PASS : findAutoCovers({ rooms, walls, covers: shrunk.covers.map(outlineOf) });
    if (!skipAuto) filled = true;
    const shapes = auto.covers.length === 0 ? shrunk.covers : [...shrunk.covers, ...auto.covers];
    // `mergeCovers` на одном (или ни одного) поле — тождество: пары для `coversRelated` нет, а триангуляция
    // объединения нужна только группе из двух и более. Пропускаем явно, чтобы не платить за `relatedCoverGroups`.
    const merged = shapes.length < 2 ? { covers: shapes, softFail: false } : mergeCovers(shapes, { contact: true });
    if (shrunk.softFail || auto.softFail || merged.softFail) softFail = true;
    // Ни авто-полов, ни слияния — набор прохода уже приведён к общему виду выше, второй раз не считаем.
    const intact = merged.covers === shrunk.covers;
    const nextOutlines = intact ? shrunkOutlines : ordered(merged.covers.map(outlineOf), 'outer', weld);
    const nextHoles = intact ? shrunkHoles : ordered(merged.covers.flatMap(holesOf), 'inner', weld);
    converged = sameLoops(outlines, nextOutlines) && sameLoops(holes, nextHoles);
    outlines = nextOutlines;
    holes = nextHoles;
  }
  if (!converged) return { covers: [], softFail, converged: false };
  const { holes: owned } = findCoverHoles(outlines, holes);

  const outlineIds = outlines.map(outline => dedupeCycle(outline.map(idOf)));
  const holeIds = holes.map(hole => dedupeCycle(hole.map(idOf)));
  const outlineDonors = matchCoverRecords(
    storedOuter.map(anchorOf),
    outlines.map((outline, index) => ({ ids: outlineIds[index]!, outline })),
  );
  const holeDonors = matchCoverRecords(
    storedInner.map(anchorOf),
    holes.map((hole, index) => ({ ids: holeIds[index]!, outline: hole })),
  );

  const records: { record: NormalizedCover; kind: ContourKind; points: readonly PlanPosition[] }[] = [];
  outlines.forEach((outline, index) => {
    const points = outlineIds[index]!;
    // Обвод, схлопнувшийся до пары вершин, полом не является — его дырки уходят вместе с ним как сироты.
    if (points.length < MIN_COVER_POINTS) return;
    records.push({
      kind: 'outer',
      points: outline,
      record: { kind: 'outer', points, ceilingHidden: hiddenFrom(outlineDonors[index], storedOuter) },
    });
    for (const hole of owned[index]!) {
      const holePoints = holeIds[hole]!;
      if (holePoints.length < MIN_COVER_POINTS) continue;
      records.push({
        kind: 'inner',
        points: holes[hole]!,
        record: { kind: 'inner', points: holePoints, ceilingHidden: hiddenFrom(holeDonors[hole], storedInner) },
      });
    }
  });

  return { covers: sortByArea(records).map(entry => entry.record), softFail, converged: true };
};

/**
 * Пустой результат кирпича `covers/` — им подменяется вызов, которому нечего строить (ранние выходы прохода).
 * Общий на весь модуль: результаты кирпичей только читаются, наружу этот массив не отдаётся (записи собираются
 * из `outlines`/`holes`, а те всегда свежие после `ordered`).
 */
const EMPTY_PASS: { covers: CoverShape[]; softFail: boolean } = { covers: [], softFail: false };

const outlineOf = (shape: CoverShape): PlanPosition[] => shape.outline;
const holesOf = (shape: CoverShape): PlanPosition[][] => shape.holes;

const anchorOf = (cover: StoredCover): AnchoredRecord => ({ anchorIds: cover.pointIds, anchor: cover.points });

/**
 * Петли, приваренные к точкам этажа и упорядоченные `sortByArea` — единый вид и для входа прохода, и для
 * его выхода, и для записей в документе (см. `weld` в `NormalizeCoversInput`).
 */
const ordered = (loops: readonly (readonly PlanPosition[])[], kind: ContourKind, weld: WeldPoint): PlanPosition[][] => {
  const welded = loops.map(points => points.map(weld));
  return sortByArea(welded.map(points => ({ points, kind }))).map(entry => entry.points);
};

/** Наборы петель совпали покоординатно (вершины квантованы, эпсилон не нужен) и в том же порядке. */
const sameLoops = (a: readonly (readonly PlanPosition[])[], b: readonly (readonly PlanPosition[])[]): boolean =>
  a.length === b.length &&
  a.every(
    (loop, index) =>
      loop.length === b[index]!.length &&
      loop.every((point, i) => point.x === b[index]![i]!.x && point.y === b[index]![i]!.y),
  );

/** Флаг потолка от донора по перекрытию площади; без донора пол новый — потолок виден (спека 02). */
const hiddenFrom = (donor: number | null | undefined, records: readonly StoredCover[]): boolean =>
  donor === null || donor === undefined ? false : records[donor]!.ceilingHidden;
