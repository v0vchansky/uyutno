import type React from 'react';
import { Redo2, Undo2 } from 'lucide-react';

import { usePlannerManager } from '../PlannerContext';
import { PanelTooltip } from '../Tooltip/PanelTooltip';
import { useHistoryButtons } from './useHistoryButtons';

/**
 * Строка истории панели инструментов (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Панель
 * инструментов»): отмена и повтор иконками 32×32, справа подпись «история», снизу граница `--separator`.
 * Отмена и повтор живут только здесь — в шапке редактора их нет.
 *
 * Клик идёт **тем же маршрутом, что клавиша** — `tools.key({ kind: 'undo' | 'redo' })` (ADR 0019 E5: «кнопки
 * панели — тем же путём»): в рисовании это локальный стек инструмента, в `editing` — история документа.
 * Прямой `history.undo()` здесь был бы вторым смыслом у одной кнопки.
 *
 * Своих слушателей клавиатуры панель не заводит: единственный владелец клавиатуры — `projection/input/keyboard.ts`.
 */

/**
 * Тексты тултипов = `aria-label` кнопок (handoff, «Тултипы»). `Ctrl+Shift+Z` вторым вариантом повтора — по спеке
 * `docs/product/features/planner/09-undo-redo.md`; в поставке дизайна он пропущен (аудит
 * `docs/ui/handoffs/planner/README-audit.md`, «Что осталось» п. 9).
 *
 * Обе формы — ⌘ и Ctrl — показываются одной строкой, а не по детекту платформы: рантайм-детект дал бы расхождение
 * разметки между SSR и гидрацией, а пользы на один символ.
 */
const HISTORY_BUTTONS = {
  undo: { title: 'Отменить', hint: 'Ctrl+Z (⌘Z на macOS)' },
  redo: { title: 'Повторить', hint: 'Ctrl+Y или Ctrl+Shift+Z (⌘⇧Z на macOS)' },
} as const;

/**
 * 32×32, радиус 8px, иконка 20px (handoff). «Наведение» в поставке не задано — добор за дизайн: существующая роль
 * темы `--surface-secondary`, а не новый цвет (аудит, «Что осталось» п. 4).
 *
 * `cursor-pointer` — явно: preflight Tailwind v4 ставит `button { cursor: default }`, курсор над кликабельным
 * задаётся руками, как всюду на платформе. У выключенной кнопки побеждает `disabled:cursor-not-allowed`: вариант
 * `disabled:` — это `.disabled\:cursor-not-allowed:disabled`, специфичность выше голого класса.
 */
const HISTORY_BUTTON_CLASS =
  'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--surface-foreground)] ' +
  'enabled:hover:bg-[var(--surface-secondary)] disabled:cursor-not-allowed disabled:opacity-40 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]';

export const HistoryRow: React.FC = () => {
  const manager = usePlannerManager();
  const { canUndo, canRedo } = useHistoryButtons();

  return (
    <div className='flex items-center gap-0.5 border-b border-[var(--separator)] pb-2'>
      <PanelTooltip title={HISTORY_BUTTONS.undo.title} hint={HISTORY_BUTTONS.undo.hint} placement='bottom'>
        <button
          type='button'
          aria-label={HISTORY_BUTTONS.undo.title}
          disabled={!canUndo}
          onClick={() => manager.tools.key({ kind: 'undo' })}
          className={HISTORY_BUTTON_CLASS}
        >
          <Undo2 size={20} aria-hidden focusable={false} />
        </button>
      </PanelTooltip>
      <PanelTooltip title={HISTORY_BUTTONS.redo.title} hint={HISTORY_BUTTONS.redo.hint} placement='bottom'>
        <button
          type='button'
          aria-label={HISTORY_BUTTONS.redo.title}
          disabled={!canRedo}
          onClick={() => manager.tools.key({ kind: 'redo' })}
          className={HISTORY_BUTTON_CLASS}
        >
          <Redo2 size={20} aria-hidden focusable={false} />
        </button>
      </PanelTooltip>
      <span className='ml-auto pr-1 text-[11px] leading-none text-[var(--muted)]'>история</span>
    </div>
  );
};
