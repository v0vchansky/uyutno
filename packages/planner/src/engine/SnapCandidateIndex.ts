import { freeze } from 'immer';

import { ringNeighbours, ringSegments, type Segment, type SnapCandidate } from '../document/geometry/snap/candidates';
import type { Id } from '../document/id';
import type { FloorLayout, PlanPosition, PlannerDocument } from '../document/PlannerDocument';

/** Индекс кандидатов снапа одного этажа: плоский пул вершин и рёбра контуров (стен) — вход чистых функций `snap/`. */
export interface SnapIndex {
  /** Все `layout.points` этажа (вершины контуров/полов/зон, ADR 0019 E2); соседи по кольцу — для биссектрисы. */
  candidates: readonly SnapCandidate[];
  /** Рёбра контуров стен (`layout.contours`) — `findNearSegments`, подавление гайдов «на стене». */
  segments: readonly Segment[];
}

const EMPTY_INDEX: SnapIndex = freeze({ candidates: [], segments: [] }, true);

/**
 * Пул кандидатов из планировки этажа (чистая функция): каждая точка `layout.points` — ровно один кандидат;
 * соседи по кольцу — из **первого** кольца, содержащего точку, в порядке `contours` → `covers` → `areas`
 * (у общей вершины нескольких контуров биссектриса берётся по первому — детерминированно, без дублей в пуле);
 * кольцо короче трёх вершин соседей не даёт. Точки не из документа (рисуемый контур) добавляет инструмент
 * через `draftCandidates`. Рёбра — только `contours` (спека 01 «на существующей стене»).
 */
export const buildSnapIndex = (layout: FloorLayout): SnapIndex => {
  // Инвариант документа после `normalize`: кольца ссылаются только на живые точки; битый id молча пропускается —
  // индекс производный и не место для валидации (её делает команда фасада / загрузка).
  const resolve = (ids: readonly Id[]) => ids.map(id => layout.points[id]).filter(point => point !== undefined);
  const neighbours = new Map<Id, { prev: PlanPosition; next: PlanPosition }>();
  const rings = [...layout.contours, ...layout.covers, ...layout.areas];
  for (const ring of rings) {
    const points = resolve(ring.points);
    points.forEach((point, index) => {
      if (neighbours.has(point.id)) return;
      const around = ringNeighbours(points, index, true);
      if (around) neighbours.set(point.id, around);
    });
  }
  const candidates = Object.values(layout.points).map(point => {
    const candidate: SnapCandidate = { id: point.id, x: point.x, y: point.y };
    const around = neighbours.get(point.id);
    if (around) {
      candidate.prev = around.prev;
      candidate.next = around.next;
    }
    return candidate;
  });
  const segments = layout.contours.flatMap(contour => ringSegments(resolve(contour.points)));
  return { candidates, segments };
};

/**
 * Индекс кандидатов снапа (ADR 0019 E2, аудит dd09 drop синглтона `WC.snapTool.reset()`): производный от документа,
 * мемоизирован **по ссылке** `floor.layout` — документ меняется только транзакцией `PlannerStore` (→ `document:changed`),
 * immer сохраняет неизменённые поддеревья по ссылке, поэтому новая ссылка планировки ⇔ пересборка, а смена `view`/
 * `settings`/другого этажа и undo/redo на прежний снимок попадают в кеш. Ленивый: строится при первом запросе после
 * изменения, а не на каждое событие. Экземпляр — на `PlannerManager` (неймспейс `tools`, 0057); глобалов и
 * синглтонов нет.
 */
export class SnapCandidateIndex {
  private readonly cache = new WeakMap<FloorLayout, SnapIndex>();

  /** Индекс этажа `floorId` для снимка `document` (глубоко заморожен); неизвестный этаж — пустой индекс. */
  get(document: PlannerDocument, floorId: Id): SnapIndex {
    const floor = document.floors.find(candidate => candidate.id === floorId);
    if (!floor) return EMPTY_INDEX;
    const cached = this.cache.get(floor.layout);
    if (cached) return cached;
    const index = freeze(buildSnapIndex(floor.layout), true);
    this.cache.set(floor.layout, index);
    return index;
  }
}
