import type React from 'react';

import type { Units } from '../../document/PlannerDocument';
import { usePlannerManager } from '../PlannerContext';
import { usePlannerSelector } from '../usePlannerSelector';

/**
 * Три сегмента — и ровно три: имперской системы в продукте нет (решение 18 брифа `docs/ui/briefs/planner-editor.md`,
 * инвариант «единицы — сантиметры» пакета). Подписи бытовые, `aria-label` полным словом: сегмент 26px не даёт
 * скринридеру ничего, кроме «см».
 */
const UNIT_SEGMENTS: { units: Units; label: string; ariaLabel: string }[] = [
  { units: 'cm', label: 'см', ariaLabel: 'Сантиметры' },
  { units: 'm', label: 'м', ariaLabel: 'Метры' },
  { units: 'mm', label: 'мм', ariaLabel: 'Миллиметры' },
];

/**
 * Переключатель единиц группы контролов холста (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`,
 * «Группа контролов холста»): три сегмента 26px, активный на `--surface-tertiary`. Переключение глобальное для
 * проекта — единицы живут в документе (`settings.units`), поэтому пишутся командой фасада, а все подписи и поля
 * перерисовываются от события шины.
 *
 * Радиус 8px, а не 6px из поставки: 6px — необъявленное отступление от шкалы радиусов 8/12/24 (аудит
 * `docs/ui/handoffs/planner/README-audit.md`, «Что осталось» п. 8), приводим к шкале.
 *
 * Разметка — `role="group"` из обычных кнопок с `aria-pressed`, а **не** `radiogroup` из трёх `radio`. По смыслу
 * это действительно выбор одного значения из списка, но паттерн ARIA radiogroup обязывает к roving tabindex и
 * навигации стрелками, а завести их нельзя: единственный владелец клавиатуры — `projection/input/keyboard.ts`
 * (ADR 0019 E5), своих слушателей в скине не бывает. Роль, обещающая клавиатуру, которой нет, хуже отсутствия
 * роли — по этой же причине рейл отказался от `toolbar` (`ui/ViewRail/ViewRail.tsx`). `aria-pressed` совпадает с
 * разметкой видов рейла (handoff, «Доступность»), поэтому скин остаётся однородным.
 */
export const UnitsSegment: React.FC = () => {
  const manager = usePlannerManager();
  // Селектор возвращает примитив (строку) — требование стабильности `usePlannerSelector` выполнено.
  const units = usePlannerSelector(m => m.document.get().settings.units);

  return (
    <div role='group' aria-label='Единицы измерения' className='flex items-center gap-0.5'>
      {UNIT_SEGMENTS.map(segment => {
        const active = segment.units === units;
        return (
          <button
            key={segment.units}
            type='button'
            aria-pressed={active}
            aria-label={segment.ariaLabel}
            // «Наведение» для контролов холста в поставке не задано (аудит, «Что осталось» п. 4) — берём
            // существующую роль темы `--surface-secondary`, а не заводим новый цвет. `cursor-pointer` — явно:
            // preflight Tailwind v4 ставит кнопкам `cursor: default`, конвенция платформы возвращает указатель.
            className={`flex h-8 w-[26px] cursor-pointer items-center justify-center rounded-lg text-xs leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] ${
              active
                ? 'bg-[var(--surface-tertiary)] text-[var(--surface-tertiary-foreground)]'
                : 'text-[var(--muted)] hover:bg-[var(--surface-secondary)]'
            }`}
            onClick={() => manager.document.setSettings({ units: segment.units })}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
};
