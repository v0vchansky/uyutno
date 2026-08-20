import type React from 'react';

import type { DraftIconProps } from '../icons/draftIcons';
import { PanelTooltip } from '../Tooltip/PanelTooltip';

/**
 * Геометрия кнопки рейла (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Рейл»): 44×44, радиус 8px,
 * иконка по центру. Кольцо фокуса акцентное — раздел «Доступность» («кольцо фокуса всюду акцентное»).
 * Экспортируется в `SnapToggle`: тумблер — та же кнопка рейла, отличается только раскраской состояний.
 */
export const RAIL_BUTTON_CLASS =
  'flex size-11 cursor-pointer items-center justify-center rounded-lg ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]';

/** Иконка 20px внутри кнопки 44×44 (handoff, «Рейл»). */
export const RAIL_ICON_SIZE = 20;

/**
 * Состояние «наведение» поставка не описала (аудит `docs/ui/handoffs/planner/README-audit.md`, «Что осталось» п. 4).
 * Добор за дизайн: берём существующую роль темы `--surface-secondary`, а не заводим новый цвет.
 */
export const RAIL_HOVER_CLASS = 'hover:bg-[var(--surface-secondary)]';

export interface ViewButtonProps {
  /** Первая строка тултипа, она же `aria-label`: иконка без подписи обязана быть подписана (handoff, «Тултипы»). */
  title: string;
  /** Вторая строка тултипа — пояснение вида. */
  hint: string;
  icon: React.FC<DraftIconProps>;
  /** Активный вид — заливка `--accent` и белая иконка; `aria-pressed` читает то же состояние. */
  active: boolean;
  /** Клик: по неактивной — смена вида, по активной — сброс камеры этого вида (спека 08 «Смена вида»). */
  onSelect: () => void;
}

/** Кнопка вида в рейле; какой именно вид и что делает клик — знает `ViewRail`, кнопка только рисует состояние. */
export const ViewButton: React.FC<ViewButtonProps> = ({ title, hint, icon: Icon, active, onSelect }) => (
  <PanelTooltip title={title} hint={hint} placement='right'>
    <button
      type='button'
      aria-label={title}
      aria-pressed={active}
      onClick={onSelect}
      className={`${RAIL_BUTTON_CLASS} ${
        active ? 'bg-[var(--accent)] text-white' : `text-[var(--foreground)] ${RAIL_HOVER_CLASS}`
      }`}
    >
      <Icon size={RAIL_ICON_SIZE} />
    </button>
  </PanelTooltip>
);
