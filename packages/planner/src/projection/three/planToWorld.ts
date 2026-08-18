import type { PlanPosition } from '../../document/PlannerDocument';

/** Точка мира Three, см: `+Y` — вверх (ADR 0016 B1). Plain-объект, без `Vector3` — тестируется без `three`. */
export interface WorldPosition {
  x: number;
  y: number;
  z: number;
}

/**
 * Единственное место маппинга плоскости плана в мир Three (ADR 0016 B1, ADR G позже расширяет, не переносит):
 * `(x, y) → (x, h, −y)`. Документ хранит только координаты плана; никаких инверсий `z` в сериализации и
 * ремапов в подсистемах — все, кому нужен мир, идут сюда. `height` — высота над полом, см.
 */
export const planToWorld = ({ x, y }: PlanPosition, height = 0): WorldPosition => ({ x, y: height, z: negate(y) });

/** Обратный маппинг (пикинг, проекция курсора на план): `(x, h, −y) → (x, y)`; высота отбрасывается. */
export const worldToPlan = ({ x, z }: WorldPosition): PlanPosition => ({ x, y: negate(z) });

/** `−0` не порождаем: `0 → 0`, остальное — обычное отрицание (`NaN`/`±Infinity` пробрасываются как есть). */
const negate = (value: number): number => (value === 0 ? 0 : -value);

/**
 * Направление «вверх по плану» (`+y` плана) в мире — вектор `up` ортокамеры сверху: выводится из того же
 * маппинга, а не задаётся отдельной константой, чтобы ориентация плана на экране имела один источник.
 */
export const PLAN_UP_IN_WORLD: WorldPosition = planToWorld({ x: 0, y: 1 });
