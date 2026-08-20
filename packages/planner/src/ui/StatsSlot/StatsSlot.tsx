import type React from 'react';

/**
 * Место под панель статистики (решение 11 брифа `docs/ui/briefs/planner-editor.md`, handoff
 * `docs/ui/handoffs/planner/planner-editor-ui.md`, «Группа контролов холста»): 180×36px с пунктирной рамкой
 * `--border`, над полоской контролов в той же правой колонке холста.
 *
 * Прямоугольник **намеренно пустой**: сводка (площадь, периметр, число комнат) — отдельная работа, а её место
 * держится сейчас, чтобы правая колонка не переехала, когда содержимое появится. Для скринридера пустая рамка
 * смысла не несёт — `aria-hidden`. Позиционирует его, как и полоску контролов, родитель.
 */
/** Высота слота, CSS px (класс `h-9`). Нужна `ConstructorSkin` для нижнего inset камеры. */
export const STATS_SLOT_HEIGHT = 36;

export const StatsSlot: React.FC = () => (
  <div aria-hidden='true' className='h-9 w-[180px] rounded-xl border border-dashed border-[var(--border)]' />
);
