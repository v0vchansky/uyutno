import { useCallback, useEffect, useState } from 'react';

import type { ZoomState } from '../../projection/canvas2d/Canvas2dProjection';
import { usePlannerProjections } from '../PlannerContext';

/**
 * Шаг дискретной шкалы зума и «в центр» — действия, локальные вьюверу конструктора: они не проходят через
 * документ, поэтому берутся не из фасада, а из проекции (ADR 0020 P6, `usePlannerProjections`).
 *
 * Источник правды — камера `Canvas2dProjection`: начальное значение читается синхронно (`getZoom()`), дальше
 * компонент живёт на подписке `onZoomChanged` — колесо мыши и «в центр» двигают шкалу мимо кнопок, и индикатор
 * обязан догонять их без клика. `useSyncExternalStore` здесь не берём намеренно: `getZoom()` собирает новый
 * объект на каждый вызов, а этому хуку нужен стабильный снимок — `useState` + `useEffect` проще и честнее.
 */
export interface ZoomControl {
  zoom: ZoomState;
  /** Шаг шкалы вверх (`zoomBy(+1)`) — кнопка «+». */
  zoomIn: () => void;
  /** Шаг шкалы вниз (`zoomBy(-1)`) — кнопка «−». */
  zoomOut: () => void;
  /** «В центр»: подобрать масштаб по габаритам плана. */
  fitToContent: () => void;
}

export const useZoomControl = (): ZoomControl => {
  const { canvas2d } = usePlannerProjections();
  const [zoom, setZoom] = useState<ZoomState>(() => canvas2d.getZoom());

  // Эффект только подписывается и отписывается: состояние двигает сам источник, вызывая слушателя.
  useEffect(() => canvas2d.onZoomChanged(setZoom), [canvas2d]);

  return {
    zoom,
    zoomIn: useCallback(() => canvas2d.zoomBy(1), [canvas2d]),
    zoomOut: useCallback(() => canvas2d.zoomBy(-1), [canvas2d]),
    fitToContent: useCallback(() => canvas2d.fitToContent(), [canvas2d]),
  };
};
