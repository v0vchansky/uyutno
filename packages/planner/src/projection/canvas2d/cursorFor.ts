import type { ToolState } from '../../engine/tools/ToolState';
import { DRAFT_CURSORS } from './draftStyle';

/**
 * Курсор холста по состоянию автомата и активному пану (эталон холста, таблица «Курсоры»):
 * рисование — перекрестие, наведение на точку или сторону — `grab`, перетаскивание и панорамирование —
 * `grabbing`, пустой холст — `default`. Крестик снапа рисуется поверх курсора и его не заменяет.
 *
 * Наведение на комнату таблицей не описано — оно не «хватается», остаётся `default`.
 */
export const cursorFor = (tools: ToolState, panning: boolean): string => {
  if (panning) return DRAFT_CURSORS.dragging;
  switch (tools.kind) {
    case 'dragging-point':
    case 'dragging-wall':
      return DRAFT_CURSORS.dragging;
    case 'making-walls':
    case 'making-rect':
    case 'making-room':
      return DRAFT_CURSORS.drawing;
    case 'editing':
      return tools.hover?.kind === 'point' || tools.hover?.kind === 'wall' ? DRAFT_CURSORS.hover : DRAFT_CURSORS.idle;
  }
};
