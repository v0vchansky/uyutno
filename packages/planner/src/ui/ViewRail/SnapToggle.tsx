import type React from 'react';

import type { SnapFlags } from '../../document/geometry/snap/getSnapPoint';
import type { DraftIconProps } from '../icons/draftIcons';
import { usePlannerManager } from '../PlannerContext';
import { PanelTooltip } from '../Tooltip/PanelTooltip';
import { usePlannerSelector } from '../usePlannerSelector';
import { RAIL_BUTTON_CLASS, RAIL_HOVER_CLASS, RAIL_ICON_SIZE } from './ViewButton';

export interface SnapToggleProps {
  /** Какой флаг снапа переключает кнопка; состояние читается и пишется по этому ключу. */
  flag: keyof SnapFlags;
  /** Первая строка тултипа, она же `aria-label` (handoff, «Тултипы» и «Доступность»). */
  title: string;
  /** Вторая строка: чем именно тумблер управляет — тултип снапа обязан не обещать больше, чем делает. */
  hint: string;
  icon: React.FC<DraftIconProps>;
}

/**
 * Включённый тумблер — иконка `--accent` на светлой подложке; заливку акцентом тумблеры не получают,
 * она занята видами (handoff «Рейл»: «два разных смысла одним приёмом читались бы как один список»).
 * Подложка в поставке задана сырым `#FBEDE6` (аудит поставки, «Что осталось» п. 7) — в код переносится не HEX,
 * а производная от акцента той же светлоты.
 */
const ON_CLASS = 'bg-[color-mix(in_oklch,var(--accent)_12%,var(--surface))] text-[var(--accent)]';

/** Выключенный — приглушённая иконка без подложки; `#A8A8A8` поставки заменён ролью темы `--muted` (аудит, п. 7). */
const OFF_CLASS = `text-[var(--muted)] ${RAIL_HOVER_CLASS}`;

/**
 * Тумблер снапа в рейле (спека 01 «Флаги в UI»): состояние живёт в `tools`, не в документе, поэтому кнопка
 * читает и пишет его сама — родителю знать про флаги нечего. Разметка — `role="switch"` + `aria-checked`
 * (handoff, «Доступность»), а не `aria-pressed`: у тумблера два устойчивых положения, а не нажатие.
 *
 * Клавиатурных слушателей здесь нет: единственный владелец клавиатуры — `projection/input/keyboard.ts`
 * (ADR 0019). Кнопке хватает нативных Enter/Space.
 */
export const SnapToggle: React.FC<SnapToggleProps> = ({ flag, title, hint, icon: Icon }) => {
  const manager = usePlannerManager();
  // Селектор возвращает `boolean`, а не объект флагов: `tools:changed` прилетает на каждый pointerMove,
  // и новый объект на каждый вызов дал бы бесконечный ре-рендер (ADR 0015 «Что важно знать»).
  const checked = usePlannerSelector(m => m.tools.get().snapFlags[flag]);
  const patch: Partial<SnapFlags> = { [flag]: !checked };

  return (
    <PanelTooltip title={title} hint={hint} placement='right'>
      <button
        type='button'
        role='switch'
        aria-checked={checked}
        aria-label={title}
        onClick={() => manager.tools.setSnapFlags(patch)}
        className={`${RAIL_BUTTON_CLASS} ${checked ? ON_CLASS : OFF_CLASS}`}
      >
        <Icon size={RAIL_ICON_SIZE} />
      </button>
    </PanelTooltip>
  );
};
