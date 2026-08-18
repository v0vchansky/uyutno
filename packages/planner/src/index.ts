/**
 * Публичный API пакета `@uyutno/planner` (ADR 0015). Платформа импортирует только отсюда.
 * Слои: `document/` → `engine/` → `projection/` → `ui/`; направление импортов энфорсится ESLint.
 */
export { createPlanner } from './projection/createPlanner';
export type { CreatePlannerParams, PlannerInstance } from './projection/createPlanner';
export type { ThreeProjection, ProjectionStats } from './projection/three/ThreeProjection';
export { Planner } from './ui/Planner/Planner';
export type { PlannerProps } from './ui/Planner/Planner';
export { usePlannerManager } from './ui/PlannerContext';
export { usePlannerSelector } from './ui/usePlannerSelector';
export type { PlannerLogger, PlannerManager } from './engine/PlannerManager';
export type { PlannerEvents } from './engine/PlannerBus';
export type { Result } from './engine/Result';
export type { LoadError, SetSettingsError } from './engine/DocumentNamespace';
export type { AddContoursError, ContourInput } from './engine/commands/addContours';
export type { MovePointsError, MovePointsOptions, PointMove } from './engine/commands/movePoints';
export type { DeletePointError } from './engine/commands/deletePoint';
export type { EdgeRef, SetEdgeLengthError, SetEdgeLengthOptions } from './engine/commands/setEdgeLength';
export type { SetWallWidthError } from './engine/commands/setWallWidth';
export type { SetActiveViewError, SetCameraError } from './engine/ViewNamespace';
export type { HistoryError, HistoryState } from './engine/HistoryNamespace';
export type { DerivedState, DerivedFloor, DerivedWall, DerivedRoom, Triangle } from './engine/rebuild';
export type { WallAxis, FaceRef } from './document/geometry/axes/findAxes';
export type {
  PlannerDocument,
  DocumentSettings,
  DocumentView,
  Units,
  ViewKind,
  CameraViewKind,
  ViewCameras,
  PlanCamera,
  OrbitCamera,
  WalkCamera,
  Floor,
  FloorLayout,
  FloorScene,
  PlanPosition,
  Point,
  Contour,
  ContourKind,
  Cover,
  Area,
  Cut,
  Room,
  SceneItem,
  SceneItemKind,
  Ruler,
} from './document/PlannerDocument';
export type { Id } from './document/id';
