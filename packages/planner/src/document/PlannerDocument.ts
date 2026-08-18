import { createId, type Id } from './id';

/**
 * Модель документа планера — одно plain-JSON дерево, единственный источник правды для всех вьюверов
 * (ADR 0016). Здесь только то, что **хранится**; всё производное (стены-тела, комнаты-полигоны, оси…)
 * строится на rebuild в движке и не сериализуется. Инварианты plain-JSON (B5): объекты, массивы, строки,
 * конечные числа, boolean, `null`; без `undefined`-значений, `Map/Set/Date`, классов и циклов.
 *
 * Тип называется `PlannerDocument`, а не `Document`, как в скетче ADR 0016: пакет компилируется с `lib: dom`,
 * и забытый импорт `Document` молча подхватил бы DOM-глобал того же имени.
 */

/** Точка плоскости плана без идентичности: см, `(x, y)`; в мир Three маппится проекцией `(x, h, −y)` (B1). */
export interface PlanPosition {
  x: number;
  y: number;
}

/** Вершина единого пула этажа: сварка контуров/полов/зон = общий `id` (B3/B4). Координаты квантованы до 0.001. */
export interface Point extends PlanPosition {
  id: Id;
}

/** Единицы отображения длин (спека 07). Внутренняя единица всегда см (B1). */
export const UNITS = ['cm', 'm', 'mm', 'ftin'] as const;
export type Units = (typeof UNITS)[number];

/** Высота стен по умолчанию, см (`DEFAULT_WALL_HEIGHT`, README «Единицы и координаты»). */
export const DEFAULT_WALL_HEIGHT = 280;

export interface DocumentSettings {
  units: Units;
  /** Высота стен этажа, см. */
  wallHeight: number;
}

/** Виды редактора (спека 08). Конструктор — отдельный Canvas2D-вьювер того же документа (Q17). */
export const VIEW_KINDS = ['constructor', 'plan', 'orbit', 'walk'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

/**
 * Камера 2D top-view: центр кадра в координатах плана (см) и нормализованный зум `0..1` (спека 08/10).
 * Смысл шкалы зума (в масштаб/дистанцию) задаёт проекция вида (ADR G); документ хранит только число.
 */
export interface PlanCamera extends PlanPosition {
  zoom: number;
}

/** Камера 3D-orbit: якорь (план + высота, см), азимут/наклон в градусах (B1), зум `0..1` (спека 08). */
export interface OrbitCamera extends PlanPosition {
  elevation: number;
  pan: number;
  tilt: number;
  zoom: number;
}

/** Камера walk: позиция на плане (высота глаз фиксирована спекой 08), направление взгляда в градусах. */
export interface WalkCamera extends PlanPosition {
  pan: number;
  tilt: number;
}

/**
 * Камеры видов, хранимые в документе (спека 10 «Что сохраняется»). У конструктора свой дискретный зум/пан
 * (спека 08) — где он живёт, решает ADR E/G (парковка build-order); в документе его пока нет.
 */
export interface ViewCameras {
  plan: PlanCamera;
  orbit: OrbitCamera;
  walk: WalkCamera;
}

/** Виды, чьи камеры хранятся в документе (без конструктора — см. `ViewCameras`). */
export const CAMERA_VIEW_KINDS = ['plan', 'orbit', 'walk'] as const satisfies readonly (keyof ViewCameras)[];
export type CameraViewKind = (typeof CAMERA_VIEW_KINDS)[number];

/** Состояние вида в документе (B7): явный активный вид + камеры видов; меняется через `view` фасада. */
export interface DocumentView {
  activeView: ViewKind;
  cameras: ViewCameras;
}

/** Замкнутая петля граней стен — то, что рисует пользователь (contour-first). */
export interface Contour {
  id: Id;
  points: Id[];
}

/** Пол — самостоятельный контур (Q12). */
export interface Cover {
  id: Id;
  points: Id[];
}

/** Зона с пониженным потолком; `height` — см. */
export interface Area {
  id: Id;
  points: Id[];
  height: number;
}

/** Вертикальная грань зоны — явная запись с концами по id точек (Q12); материал — ADR J. */
export interface Cut {
  id: Id;
  a: Id;
  b: Id;
}

/** Атрибуты комнаты с якорем — id точек контура на момент последнего rebuild (Q3/Q35). */
export interface Room {
  id: Id;
  anchor: Id[];
  name: string;
  /** Высота потолка комнаты, см. */
  ceilingHeight: number;
}

/** «Планировка» этажа: единый пул вершин + ссылки на них по id (никогда по индексу). */
export interface FloorLayout {
  points: Record<Id, Point>;
  contours: Contour[];
  covers: Cover[];
  areas: Area[];
  cuts: Cut[];
  rooms: Room[];
}

export type SceneItemKind = 'model' | 'door' | 'window' | 'opening' | 'poster' | 'carpet';

/** Предмет обстановки/проём: мировые координаты плана, поворот в градусах; поля по `kind` — ADR H. */
export interface SceneItem extends PlanPosition {
  id: Id;
  kind: SceneItemKind;
  catalogId: string;
  elevation: number;
  rotation: number;
}

/** Пользовательская линейка — независимая пара координат плана (спека 07). */
export interface Ruler {
  id: Id;
  a: PlanPosition;
  b: PlanPosition;
}

/**
 * «Обстановка и отделка» этажа. `finishes` (ADR J) и `underlay` (ADR K) появятся своими шагами —
 * до их ADR полей в типе нет, чтобы не фиксировать схему раньше решения.
 */
export interface FloorScene {
  items: SceneItem[];
  rulers: Ruler[];
  hidden: Id[];
}

/** Этаж: `layout` и `scene` — отдельные поддеревья, чтобы undo снапшотил их по ссылке (B5, ADR D). */
export interface Floor {
  id: Id;
  layout: FloorLayout;
  scene: FloorScene;
}

export const DOCUMENT_FORMAT = 'uyutno.planner';
/** Целая монотонная версия формата (B6); миграции — ADR F. */
export const DOCUMENT_VERSION = 1;

export interface PlannerDocument {
  format: typeof DOCUMENT_FORMAT;
  version: number;
  settings: DocumentSettings;
  view: DocumentView;
  /** v0: ровно один этаж; UI показывает один (README «Multi-floor»). */
  floors: Floor[];
}

/**
 * Дефолтные камеры видов (спека 08 «При старте нового проекта», числа — реверс roomtodo 08):
 * план — центр `(0, 0)`, зум посередине шкалы; orbit — изометрия 45°/45° вокруг якоря на высоте 110 см,
 * зум 0.1 (≈ 3000 см дистанции в шкале референса); walk — центр сцены, взгляд вперёд.
 */
export const createDefaultCamera = <V extends CameraViewKind>(view: V): ViewCameras[V] => {
  const cameras: ViewCameras = {
    plan: { x: 0, y: 0, zoom: 0.5 },
    orbit: { x: 0, y: 0, elevation: 110, pan: 45, tilt: 45, zoom: 0.1 },
    walk: { x: 0, y: 0, pan: 0, tilt: 0 },
  };
  return cameras[view];
};

/** Новый пустой проект открывается в конструкторе (спека 08 «Виды»). */
export const createDefaultView = (): DocumentView => ({
  activeView: 'constructor',
  cameras: {
    plan: createDefaultCamera('plan'),
    orbit: createDefaultCamera('orbit'),
    walk: createDefaultCamera('walk'),
  },
});

export const createEmptyFloor = (): Floor => ({
  id: createId(),
  layout: { points: {}, contours: [], covers: [], areas: [], cuts: [], rooms: [] },
  scene: { items: [], rulers: [], hidden: [] },
});

/** Пустой документ нового проекта: один этаж, см, `wallHeight = 280`, дефолтные вид и камеры. */
export const createEmptyDocument = (): PlannerDocument => ({
  format: DOCUMENT_FORMAT,
  version: DOCUMENT_VERSION,
  settings: { units: 'cm', wallHeight: DEFAULT_WALL_HEIGHT },
  view: createDefaultView(),
  floors: [createEmptyFloor()],
});
