import type { FaceRef } from '../document/geometry/axes/findAxes';
import type { Id } from '../document/id';
import {
  DOCUMENT_FORMAT,
  DOCUMENT_VERSION,
  UNITS,
  type DocumentSettings,
  type PlanPosition,
  type PlannerDocument,
} from '../document/PlannerDocument';
import { addArea, type AddAreaError } from './commands/addArea';
import { addContours, type AddContoursError, type ContourInput } from './commands/addContours';
import { addCover, type AddCoverError, type AddCoverOptions } from './commands/addCover';
import { deleteArea, type DeleteAreaError } from './commands/deleteArea';
import { deleteCover, type DeleteCoverError } from './commands/deleteCover';
import { deletePoint, type DeletePointError } from './commands/deletePoint';
import { insertPoint, type InsertPointError, type InsertPointOptions } from './commands/insertPoint';
import { movePoints, type MovePointsError, type MovePointsOptions, type PointMove } from './commands/movePoints';
import {
  setEdgeLength,
  type EdgeRef,
  type SetEdgeLengthError,
  type SetEdgeLengthOptions,
} from './commands/setEdgeLength';
import { setAreaHeight, type SetAreaHeightError } from './commands/setAreaHeight';
import { setWallWidth, type SetWallWidthError } from './commands/setWallWidth';
import type { PlannerStore } from './PlannerStore';
import { err, ok, type Result } from '../document/Result';
import type { DerivedState } from './rebuild';

export type LoadError =
  | { kind: 'unsupported-format'; format: unknown }
  | { kind: 'unsupported-version'; version: unknown; supported: number };

export type SetSettingsError =
  { kind: 'invalid-units'; units: unknown } | { kind: 'invalid-wall-height'; wallHeight: unknown };

/**
 * Неймспейс `document` фасада (ADR 0015 A2): снимок документа и производного, загрузка, `settings`, команды
 * планировки шага 2 (ADR 0018 D1) и dirty-флаг (D7). Каждая команда — валидация на границе → одна транзакция
 * `PlannerStore` → `normalize`/`rebuild` → одно `document:changed`; при ошибке документ не меняется.
 * Реализация команд — `engine/commands/*`, неймспейс один.
 */
export class DocumentNamespace {
  constructor(private readonly store: PlannerStore) {}

  /** Замороженный снимок документа. */
  get(): PlannerDocument {
    return this.store.getDocument();
  }

  /** Замороженный результат последнего rebuild — для проекций (ADR G); UI его не трогает. */
  getDerived(): DerivedState {
    return this.store.getDerived();
  }

  /**
   * Заменяет документ целиком (шаг 3 подключит сюда `storage.load`). Проверяет только `format`/`version` —
   * структурная валидация (zod) и миграции — ADR F. Документ становится собственностью движка и замораживается.
   * История — `'reset'` (ADR 0018 D5: оба контейнера чистятся, новый baseline), dirty сбрасывается, перед
   * заменой зовётся хук `beforeReplace` (D9).
   */
  load(document: PlannerDocument): Result<void, LoadError> {
    if (typeof document !== 'object' || document === null || document.format !== DOCUMENT_FORMAT) {
      return err({ kind: 'unsupported-format', format: document?.format });
    }
    if (!Number.isInteger(document.version) || document.version < 1 || document.version > DOCUMENT_VERSION) {
      return err({ kind: 'unsupported-version', version: document.version, supported: DOCUMENT_VERSION });
    }
    this.store.load(document);
    return ok(undefined);
  }

  /** Меняет настройки документа: `units` — из `UNITS`, `wallHeight` — конечное число > 0. Вне истории (D3), dirty ставит. */
  setSettings(patch: Partial<DocumentSettings>): Result<void, SetSettingsError> {
    const { units, wallHeight } = patch;
    if (units !== undefined && !UNITS.includes(units)) return err({ kind: 'invalid-units', units });
    if (wallHeight !== undefined && !(Number.isFinite(wallHeight) && wallHeight > 0)) {
      return err({ kind: 'invalid-wall-height', wallHeight });
    }
    // Поля присваиваются поимённо: `undefined` в документ не попадает (plain-JSON, ADR 0016 B5).
    this.store.transact(
      draft => {
        if (units !== undefined) draft.settings.units = units;
        if (wallHeight !== undefined) draft.settings.wallHeight = wallHeight;
      },
      { history: 'none' },
    );
    return ok(undefined);
  }

  // --- Команды планировки (ADR 0018 D1) -------------------------------------------------------------

  /** Сырые контуры инструмента (`outer`-квады ленты / прямоугольник, `inner` — комната по точкам) одной записью. */
  addContours(floorId: Id, contours: readonly ContourInput[]): Result<void, AddContoursError> {
    return addContours(this.store, floorId, contours);
  }

  /** Новые координаты точек (драг на `pointerUp`, нудж с `coalesce`); совладельцы общего id едут сами. */
  movePoints(floorId: Id, moves: readonly PointMove[], options?: MovePointsOptions): Result<void, MovePointsError> {
    return movePoints(this.store, floorId, moves, options);
  }

  /** Удаление вершины с каскадом D2 по всем владельцам. */
  deletePoint(floorId: Id, id: Id): Result<void, DeletePointError> {
    return deletePoint(this.store, floorId, id);
  }

  /**
   * Рождение вершины на существующей грани (ручка деления грани, спека 01): точка встаёт в кольцо контура между
   * концами грани, разрез соседних контуров/полов/зон делает `normalize`. Возвращает id новой вершины.
   */
  insertPoint(
    floorId: Id,
    face: FaceRef,
    position: PlanPosition,
    options?: InsertPointOptions,
  ): Result<Id, InsertPointError> {
    return insertPoint(this.store, floorId, face, position, options);
  }

  /** Длина ребра `a→b`: симметрично ±Δ/2 или вся Δ на конец, противоположный `anchor`. Серия по ребру — одна запись. */
  setEdgeLength(
    floorId: Id,
    edge: EdgeRef,
    length: number,
    options?: SetEdgeLengthOptions,
  ): Result<void, SetEdgeLengthError> {
    return setEdgeLength(this.store, floorId, edge, length, options);
  }

  /** Ширина стены по паре граней оси из `getDerived()`: сдвиг `faces[0]` по нормали. Серия по грани — одна запись. */
  setWallWidth(floorId: Id, faces: readonly [FaceRef, FaceRef], width: number): Result<void, SetWallWidthError> {
    return setWallWidth(this.store, floorId, faces, width);
  }

  // --- Полы и зоны (эпик 0066; спека 02 «Полы», «Зоны (Areas)») -------------------------------------

  /**
   * Ручной пол одним контуром: `kind: 'outer'` (дефолт) — пол, `'inner'` — пол-вычитание (дырка).
   * Подрезку под комнаты, слияние со связанными полами и снятие осиротевших дырок делает `normalize`.
   */
  addCover(floorId: Id, points: readonly PlanPosition[], options?: AddCoverOptions): Result<void, AddCoverError> {
    return addCover(this.store, floorId, points, options);
  }

  /** Явное удаление пола (спека 02: «оставить комнату без покрытия»); авто-пол за ним пересобирает `normalize`. */
  deleteCover(floorId: Id, id: Id): Result<void, DeleteCoverError> {
    return deleteCover(this.store, floorId, id);
  }

  /**
   * Зона с пониженным потолком. Отказ по правилам спеки 02 (стены, соседние зоны, опора) — типизированный
   * `Result`; для пользователя он молчаливый (модалок и тостов в v0 нет).
   */
  addArea(floorId: Id, points: readonly PlanPosition[], height: number): Result<void, AddAreaError> {
    return addArea(this.store, floorId, points, height);
  }

  /** Явное удаление зоны; её вертикальные грани `cuts[]` снимает `normalize` (владение вычисляется). */
  deleteArea(floorId: Id, id: Id): Result<void, DeleteAreaError> {
    return deleteArea(this.store, floorId, id);
  }

  /** Высота зоны, см (конечное число > 0). Серия правок одной зоны — одна запись истории. */
  setAreaHeight(floorId: Id, id: Id, height: number): Result<void, SetAreaHeightError> {
    return setAreaHeight(this.store, floorId, id, height);
  }

  // --- Dirty-флаг (ADR 0018 D7) ---------------------------------------------------------------------

  /** Есть ли несохранённые изменения содержимого: команды, `settings`, undo/redo — да; `view` — нет. */
  isDirty(): boolean {
    return this.store.isDirty();
  }

  /** Успешное сохранение (заглушка до ADR F): сбрасывает флаг, `document:dirty-changed` при смене. */
  markSaved(): void {
    this.store.markSaved();
  }
}
