import type { FaceRef } from '../../document/geometry/axes/findAxes';
import type { StartNeighbourSegments, WallBlock } from '../../document/geometry/band/blocksFromContour';
import type { OffsetSide } from '../../document/geometry/predicates/offsetPoint';
import type { SnapFlags, SnapResult } from '../../document/geometry/snap/getSnapPoint';
import type { SnapGuide } from '../../document/geometry/snap/guidesFor';
import type { Viewport } from '../../document/geometry/viewport';
import type { Id } from '../../document/id';
import type { PlanPosition } from '../../document/PlannerDocument';

/**
 * Состояние автомата инструментов конструктора (ADR 0019 E1): один discriminated union по `kind`, plain-данные —
 * payload события `tools:changed` и снимок для `useSyncExternalStore`. Каждый переход — новый замороженный объект.
 * Здесь — состояния шага 2 из задачи 0057 (`editing`, `making-walls`); `making-rect`/`making-room` (0058),
 * `dragging-point`/`dragging-wall` (0059) добавляются членами union и обработчиками, не переписыванием.
 */

/** Цель хит-теста конструктора: вершина, сторона (грань оси) или комната (ADR 0019 E1/E4; хит-тест — 0059). */
export type HitTarget = { kind: 'point'; id: Id } | { kind: 'wall'; face: FaceRef } | { kind: 'room'; roomId: Id };

/**
 * Хаб `editing` (ADR 0019 E1): hover/выделение конструктора живут здесь, не в неймспейсе `selection`.
 * Хит-тест, `pressed`/драг и dblClick-удаление — задача 0059; в 0057 hover/selection всегда `null`.
 */
export interface EditingState {
  kind: 'editing';
  hover: HitTarget | null;
  selection: HitTarget | null;
}

/**
 * Инструмент «Стены» (ADR 0019 E3, спека 01 «Polyline Walls»): `points` — зафиксированные точки; `cursor` — живая
 * снапнутая точка (`null` до первого события указателя); `side`/`sideFixed` — сторона ленты (автовыбор при старте
 * от чужой стены до третьей точки, потом заморожена); `startNeighbours` — соседи первой точки на существующей стене
 * (T-стык, `null` — старт в пустоте); `preview` — квады ленты `blocksFromContour` по `points + cursor`; `snap`/`guides` —
 * результат снапа последнего движения и что из него рисовать (`guidesFor`); `undo`/`redo` — локальные стеки снимков
 * `points` (ADR 0018 D8: история документа о рисовании не знает).
 */
export interface MakingWallsState {
  kind: 'making-walls';
  points: readonly PlanPosition[];
  cursor: PlanPosition | null;
  side: OffsetSide;
  sideFixed: boolean;
  startNeighbours: StartNeighbourSegments | null;
  preview: readonly WallBlock[];
  snap: SnapResult | null;
  guides: readonly SnapGuide[];
  undo: readonly (readonly PlanPosition[])[];
  redo: readonly (readonly PlanPosition[])[];
}

/** Общие поля вне union (ADR 0019 E1): флаги снапа (не документ, не сохраняются) и viewport вьювера. */
export interface ToolCommon {
  snapFlags: SnapFlags;
  viewport: Viewport;
}

export type ToolVariant = EditingState | MakingWallsState;

export type ToolState = ToolCommon & ToolVariant;

export type ToolKind = ToolVariant['kind'];

/** Инструменты рисования, которые принимает `tools.start` в шаге 2; `'rect' | 'room'` — задача 0058. */
export type DrawingTool = 'walls';

/** Ввод указателя в координатах **плана** (экран → план делает вьювер, ADR 0019 E5): `button` — как у PointerEvent. */
export interface PointerInput {
  x: number;
  y: number;
  mods: PointerMods;
  button: number;
}

export interface PointerMods {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/** Действие клавиатуры (ADR 0019 E5): keymap `projection/input/keyboard.ts` → `tools.key(action)`; кнопки панели — тем же путём. */
export type KeyAction =
  { kind: 'cancel' } | { kind: 'undo' } | { kind: 'redo' } | { kind: 'nudge'; dx: number; dy: number; factor: number };

/**
 * Viewport до первого `tools.setViewport` от вьювера: базовый зум (`scale = 1`: 10 px = 10 см), центр в начале
 * координат, кадр 1024×768 CSS px — чтобы headless-сценарии (тесты, e2e через `onReady`) снапили и куллили
 * осмысленно и без обязательного вызова `setViewport`; реальный вьювер (0056) перезаписывает его при подъёме.
 */
export const DEFAULT_VIEWPORT: Readonly<Viewport> = Object.freeze({
  scale: 1,
  center: Object.freeze({ x: 0, y: 0 }),
  width: 1024,
  height: 768,
});

export const createEditingState = (): EditingState => ({ kind: 'editing', hover: null, selection: null });
