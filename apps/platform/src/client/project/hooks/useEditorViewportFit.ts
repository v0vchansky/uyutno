import { useSyncExternalStore } from 'react';

/**
 * Порог входа в редактор, CSS px: ниже него редактор не открывается вовсе — вместо него заглушка
 * «Редактор работает на компьютере» (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Адаптив» и
 * «Состояния экрана · оболочка»; гайдлайн `docs/ui/guidelines.md`, «Точки перелома» — на платформе точка одна).
 */
export const EDITOR_MIN_WIDTH = 1024;

const EDITOR_MEDIA_QUERY = `(min-width: ${EDITOR_MIN_WIDTH}px)`;

/**
 * `unknown` — ширина ещё не измерена: это SSR и первый (гидрационный) рендер. В этом состоянии рисуется каркас
 * без планера: сервер ширины окна не знает, а монтировать планер «на всякий случай» нельзя — на телефоне это
 * подняло бы WebGL-контекст ради того, чтобы через кадр его снести.
 */
export type EditorViewportFit = 'unknown' | 'fits' | 'too-narrow';

const subscribe = (onStoreChange: () => void): (() => void) => {
  const query = window.matchMedia(EDITOR_MEDIA_QUERY);
  query.addEventListener('change', onStoreChange);
  return () => query.removeEventListener('change', onStoreChange);
};

const getSnapshot = (): EditorViewportFit => (window.matchMedia(EDITOR_MEDIA_QUERY).matches ? 'fits' : 'too-narrow');

const getServerSnapshot = (): EditorViewportFit => 'unknown';

/**
 * Помещается ли редактор в окно. Через `useSyncExternalStore`, а не `useState` + `useEffect`: подписка на
 * `matchMedia` — внешний стор, и React сам переключает снимок сразу после гидрации, без рассинхрона разметки.
 *
 * Порог читается медиазапросом, а не шириной из `resize`: одно значение на CSS и JS, и никакого пересчёта на
 * каждый пиксель перетаскивания окна.
 */
export const useEditorViewportFit = (): EditorViewportFit =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
