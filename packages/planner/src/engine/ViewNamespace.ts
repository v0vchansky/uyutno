import {
  CAMERA_VIEW_KINDS,
  createDefaultCamera,
  VIEW_KINDS,
  type CameraViewKind,
  type DocumentView,
  type ViewCameras,
  type ViewKind,
} from '../document/PlannerDocument';
import { quantize } from '../document/quantize';
import type { PlannerStore } from './PlannerStore';
import { err, ok, type Result } from './Result';

export type SetActiveViewError = { kind: 'invalid-view'; view: unknown };

export type SetCameraError =
  | { kind: 'invalid-view'; view: unknown }
  | { kind: 'invalid-camera'; view: CameraViewKind; field: string; value: unknown };

/** Поля камеры, являющиеся координатами плана/высотой (см) — квантуются как любая координата документа (B1). */
const COORDINATE_FIELDS: ReadonlySet<string> = new Set(['x', 'y', 'elevation']);

/**
 * Неймспейс `view` фасада (ADR 0015 A2): активный вид и камеры видов — `Document.view` (ADR 0016 B7).
 * Команды меняют только `view`, поэтому транзакция даёт `view:changed` без rebuild и без `document:changed`;
 * `view` вне истории и dirty (ADR 0018 D3/D7) — `history: 'none'`; смена активного вида меняет активную зону
 * истории (D4), отчего может прийти `history:changed`.
 * Камера коммитится сюда по завершении интеракции, не покадрово (ADR 0015 «Что важно знать»).
 */
export class ViewNamespace {
  constructor(private readonly store: PlannerStore) {}

  /** Замороженный снимок `Document.view`. */
  get(): DocumentView {
    return this.store.getDocument().view;
  }

  setActive(view: ViewKind): Result<void, SetActiveViewError> {
    if (!VIEW_KINDS.includes(view)) return err({ kind: 'invalid-view', view });
    this.store.transact(
      draft => {
        draft.view.activeView = view;
      },
      { history: 'none' },
    );
    return ok(undefined);
  }

  /**
   * Пишет камеру вида по её схеме (ключи дефолтной камеры вида): каждое поле обязательно и конечно,
   * лишние поля отвергаются, `zoom ∈ [0, 1]` (спека 08/10 — нормализованный зум). Координаты (`x`, `y`,
   * `elevation`) квантуются до 0.001 см, все числа нормализуют `-0` → `0` (plain-JSON round-trip, B5).
   */
  setCamera<V extends CameraViewKind>(view: V, camera: ViewCameras[V]): Result<void, SetCameraError> {
    if (!CAMERA_VIEW_KINDS.includes(view)) return err({ kind: 'invalid-view', view });

    const normalized = normalizeCamera(view, camera);
    if (!normalized.ok) return normalized;

    this.store.transact(draft => assignCamera(draft.view.cameras, view, normalized.value), { history: 'none' });
    return ok(undefined);
  }

  /** Сбрасывает камеру вида к дефолту (спека 08: клик по активной кнопке вида). */
  resetCamera(view: CameraViewKind): Result<void, SetActiveViewError> {
    if (!CAMERA_VIEW_KINDS.includes(view)) return err({ kind: 'invalid-view', view });
    this.store.transact(draft => assignCamera(draft.view.cameras, view, createDefaultCamera(view)), {
      history: 'none',
    });
    return ok(undefined);
  }
}

/** Валидация и нормализация входа по схеме камеры вида; на выходе — новый объект ровно с полями схемы. */
const normalizeCamera = <V extends CameraViewKind>(
  view: V,
  camera: ViewCameras[V],
): Result<ViewCameras[V], SetCameraError> => {
  // Интерфейсы камер без индексной сигнатуры — обход по ключам через `unknown`, локально в этой функции.
  const schema = createDefaultCamera(view) as unknown as Record<string, number>;
  const input = camera as unknown as Record<string, unknown>;
  const result: Record<string, number> = {};

  for (const field of Object.keys(input)) {
    if (!(field in schema)) return err({ kind: 'invalid-camera', view, field, value: input[field] });
  }
  for (const field of Object.keys(schema)) {
    const value = input[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return err({ kind: 'invalid-camera', view, field, value });
    }
    if (field === 'zoom' && (value < 0 || value > 1)) return err({ kind: 'invalid-camera', view, field, value });
    result[field] = COORDINATE_FIELDS.has(field) ? quantize(value) : value || 0;
  }
  return ok(result as unknown as ViewCameras[V]);
};

/**
 * Присваивает поля камеры поимённо, а не объектом: immer видит присваивание того же примитива как no-op,
 * поэтому команда с неизменившимися значениями не порождает ни нового снимка, ни события.
 */
const assignCamera = <V extends CameraViewKind>(cameras: ViewCameras, view: V, camera: ViewCameras[V]): void => {
  const target = cameras[view];
  for (const field of Object.keys(camera) as (keyof ViewCameras[V])[]) target[field] = camera[field];
};
