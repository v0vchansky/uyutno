import { onFaceHandle } from '../../document/geometry/hittest/faceHandle';
import { hitTest, type HitTestOptions, sameHitTarget } from '../../document/geometry/hittest/hitTest';
import type { Id } from '../../document/id';
import type { PlanPosition } from '../../document/PlannerDocument';
import type { ToolContext } from './ToolHandler';
import type { EditingState, HitTarget } from './ToolState';

/**
 * Общее для хаба `editing` и драгов (0059): хит-тест по окружению автомата, порог драга, проверка выделения
 * после смены документа и сборка `editing` со стабильными ссылками цели (фильтр no-op `tools:changed`).
 */

/** Порог начала драга, **CSS px** (спека 01 «Зажать и сдвинуть больше 3 px»; ADR 0019 E2 — одна константа вместо `POINT_SIZE/2` и `CLICK_SHIFT`). Метрика — евклид. */
export const DRAG_THRESHOLD = 3;

/** Правка живёт только в конструкторе (спека 08): вне его указатель и клавиши правки хаб не обрабатывает, выделение хранит. */
export const inConstructor = (ctx: ToolContext): boolean => ctx.document.view.activeView === 'constructor';

/** Хит-тест в точке плана по планировке активного этажа и комнатам последнего rebuild; без этажа — `null`. */
export const hitAt = (point: PlanPosition, ctx: ToolContext, options?: HitTestOptions): HitTarget | null => {
  const floor = ctx.document.floors.find(candidate => candidate.id === ctx.floorId);
  if (!floor) return null;
  return hitTest(point, floor.layout, ctx.derived?.rooms ?? [], ctx.viewport, options);
};

/**
 * Ручка деления грани под курсором (задача 0096) — вложенный уровень хит-теста: считается **только** внутри уже
 * выигравшей грани, поэтому приоритет угла соблюдается сам собой (попал в вершину — грани нет, ручки нет тоже).
 */
export const onSplitHandle = (hover: HitTarget | null, point: PlanPosition, ctx: ToolContext): boolean => {
  if (hover?.kind !== 'wall') return false;
  const ends = facePoints(hover.face, ctx);
  return ends !== null && onFaceHandle(point, ends.a, ends.b, ctx.viewport);
};

/** Та же цель по значению → прежняя ссылка (ссылка `selection` стабильна между движениями, ADR 0019 «Что важно знать»). */
export const keepTarget = (previous: HitTarget | null, next: HitTarget | null): HitTarget | null =>
  sameHitTarget(previous, next) ? previous : next;

/**
 * Жива ли цель в текущем документе: вершина — есть в пуле; сторона — контур на месте и концы соседствуют в кольце
 * (в любом порядке: `normalize` сохраняет id контура при той же циклической последовательности); комната — есть в
 * производном. Мёртвая цель после команды/undo снимается с выделения (после undo/redo его и так снимает `interrupt`).
 */
export const targetAlive = (target: HitTarget, ctx: ToolContext): boolean => {
  const floor = ctx.document.floors.find(candidate => candidate.id === ctx.floorId);
  if (!floor) return false;
  const { layout } = floor;
  switch (target.kind) {
    case 'point':
      return Object.hasOwn(layout.points, target.id);
    case 'wall': {
      const contour = layout.contours.find(candidate => candidate.id === target.face.contourId);
      if (!contour) return false;
      const n = contour.points.length;
      for (let i = 0; i < n; i++) {
        const a = contour.points[i]!;
        const b = contour.points[(i + 1) % n]!;
        if ((a === target.face.a && b === target.face.b) || (a === target.face.b && b === target.face.a)) return true;
      }
      return false;
    }
    case 'room':
      return ctx.derived?.rooms.some(room => room.roomId === target.roomId) ?? false;
  }
};

/** Координаты концов грани по документу; `null`, если контур/точки пропали. */
export const facePoints = (
  face: { a: Id; b: Id },
  ctx: ToolContext,
): { a: PlanPosition & { id: Id }; b: PlanPosition & { id: Id } } | null => {
  const floor = ctx.document.floors.find(candidate => candidate.id === ctx.floorId);
  if (!floor) return null;
  const a = floor.layout.points[face.a];
  const b = floor.layout.points[face.b];
  return a && b ? { a, b } : null;
};

/** `editing` без нажатия: hover по последнему вводу указателя, выделение — переданное. */
export const editingWith = (selection: HitTarget | null, ctx: ToolContext): EditingState => ({
  kind: 'editing',
  hover: ctx.pointer ? hitAt(ctx.pointer, ctx) : null,
  selection,
});
