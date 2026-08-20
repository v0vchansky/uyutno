/**
 * Публичный API пакета `@uyutno/planner` (ADR 0015). Платформа импортирует только отсюда.
 * Слои: `document/` → `engine/` → `projection/` → `ui/`; направление импортов энфорсится ESLint.
 */
export { createPlanner } from './projection/createPlanner';
export type {
  CreatePlannerParams,
  PlannerCanvases,
  PlannerInstance,
  PlannerProjections,
} from './projection/createPlanner';
export type { ThreeProjection, ProjectionStats } from './projection/three/ThreeProjection';
export type { Canvas2dProjection, Canvas2dStats, ZoomState } from './projection/canvas2d/Canvas2dProjection';
/**
 * Полосы кадра под непрозрачными панелями скина: их сообщает камере конструктора сам скин
 * (`Canvas2dProjection.setViewportInsets`), чтобы «в центр» и сброс камеры вписывали план в видимую часть холста.
 */
export type { ViewportInsets } from './projection/canvas2d/camera';
export { Planner } from './ui/Planner/Planner';
export type { PlannerProps } from './ui/Planner/Planner';
export { ConstructorSkin } from './ui/ConstructorSkin/ConstructorSkin';
export type { ConstructorSkinProps } from './ui/ConstructorSkin/ConstructorSkin';
/**
 * DOM-оверлей размеров (задача 0060): подписи длин, поля ввода длины/ширины и подписи комнат. Монтируется
 * **ребёнком `ConstructorSkin`** — так он попадает и в контейнер с канвасами (ADR 0020 P6), и внутрь
 * `PlannerOverlayProvider`, через который он сообщает панелям фокус в поле длины (решение автора 3).
 */
export { LengthInputsOverlay } from './ui/LengthInputs/LengthInputsOverlay';
export {
  PlannerOverlayProvider,
  usePlannerLabelVisibility,
  useSetPlannerLabelVisibility,
  usePlannerLengthFocus,
  DEFAULT_LABEL_VISIBILITY,
} from './ui/PlannerOverlayContext';
export type { LabelVisibility, LengthInputFocus } from './ui/PlannerOverlayContext';
export { usePlannerManager, usePlannerProjections } from './ui/PlannerContext';
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
export type {
  StartToolError,
  CommitPointError,
  SetDraftPointError,
  SetViewportError,
} from './engine/tools/ToolsNamespace';
export type {
  ToolState,
  ToolKind,
  EditingState,
  MakingWallsState,
  MakingRectState,
  MakingRoomState,
  DraggingPointState,
  DraggingWallState,
  Pressed,
  HitTarget,
  DrawingTool,
  PointerInput,
  PointerMods,
  KeyAction,
} from './engine/tools/ToolState';
export type { HitRoom, HitTestOptions } from './document/geometry/hittest/hitTest';
export { sameHitTarget, POINT_SIZE, WALL_HIT_DIST } from './document/geometry/hittest/hitTest';
export { DRAG_THRESHOLD } from './engine/tools/editHit';
export type { SnapFlags, SnapResult, SnapHit } from './document/geometry/snap/getSnapPoint';
export type { SnapCandidate, Segment, AlignerPair } from './document/geometry/snap/candidates';
export type { SnapGuide } from './document/geometry/snap/guidesFor';
export type { Viewport } from './document/geometry/viewport';
export type { WallBlock, StartNeighbourSegments } from './document/geometry/band/blocksFromContour';
export type { OffsetSide } from './document/geometry/predicates/offsetPoint';
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
