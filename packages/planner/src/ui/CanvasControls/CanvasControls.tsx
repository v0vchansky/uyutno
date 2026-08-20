import type React from 'react';
import { Minus, Plus, Scan } from 'lucide-react';

import { PanelTooltip } from '../Tooltip/PanelTooltip';
import { UnitsSegment } from './UnitsSegment';
import { useZoomControl } from './useZoomControl';

/**
 * Тексты кнопок (они же `aria-label`, они же первая строка тултипа). В поставке подписей и тултипов пяти кнопок
 * группы контролов нет вовсе (аудит `docs/ui/handoffs/planner/README-audit.md`, «Что осталось» п. 2), а в
 * прототипе им скопированы `aria-label` от отмены и повтора — воспроизводить этот дефект нельзя, поэтому тексты
 * написаны здесь бытовым языком по формату раздела «Тултипы» handoff'а.
 */
const ZOOM_OUT = { title: 'Отдалить', hint: 'Шаг дискретной шкалы масштаба' };
const ZOOM_IN = { title: 'Приблизить', hint: 'Шаг дискретной шкалы масштаба' };
const FIT = { title: 'Показать весь план', hint: 'Подбирает масштаб по габаритам плана' };
/**
 * Индикатор — не кнопка и фокуса не получает, но подпись у него та же, что у остальных иконок полоски: через
 * `PanelTooltip`, а не нативный `title`. Нативная подсказка ломала бы однородность — своя задержка, свой вид,
 * своё поведение на фокусе. Раскладку обёртка не трогает: корень `PanelTooltip` — `display: contents`, плашка
 * позиционируется `fixed`, поэтому индикатор остаётся тем же flex-элементом полоски. Текст — масштаб **плана**
 * (handoff, «Группа контролов холста»: 1,0× = 100%).
 */
const ZOOM_INDICATOR = { title: 'Масштаб плана', hint: '1,0× = 100%' };

/**
 * Кнопка полоски: 32×32, радиус по шкале 8px, кольцо фокуса акцентное. «Наведение» и «нажато» в поставке не
 * заданы (аудит, «Что осталось» п. 4) — под наведение берём существующую роль темы `--surface-secondary`,
 * отдельного цвета не заводим.
 *
 * `cursor-pointer` задан явно: preflight Tailwind v4 ставит `button { cursor: default }`, и без этого класса
 * кнопки не меняли бы курсор (конвенция платформы — например `NewProjectTile`). Победа остаётся за
 * `disabled:cursor-not-allowed`: вариантные утилиты Tailwind идут в каскаде после безвариантных.
 */
const BUTTON_CLASS =
  'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--foreground)] hover:bg-[var(--surface-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

/** Разделитель между группами полоски: 1×16px `--border`. */
const Divider: React.FC = () => <span aria-hidden='true' className='mx-0.5 h-4 w-px bg-[var(--border)]' />;

/**
 * Зарезервированное место кнопки: пустой слот 32×32 без кнопки и без иконки. Нужен, чтобы геометрия и порядок
 * полоски совпали с макетом, пока функция не поставлена, — но неработающей кнопки в интерфейсе не появилось.
 */
const ReservedSlot: React.FC = () => <span aria-hidden='true' className='h-8 w-8' />;

/**
 * Группа контролов холста (решение 7 брифа `docs/ui/briefs/planner-editor.md`, handoff «Группа контролов
 * холста»): одна полоска внизу справа поверх холста — высота 36px, радиус 12px, фон `--surface`, тень
 * плавающей панели, padding 0 4px, кнопки 32×32 с шагом 2px, разделители 1×16px.
 *
 * Порядок по handoff'у: линейка · зум «− % +» · «в центр» · единицы · полноэкранный режим. **Линейка (шаг 8) и
 * полноэкранный режим в этой поставке не реализуются** — их места заняты пустыми слотами: порядок и ширина
 * полоски держатся, а кнопок, которые ничего не делают, у пользователя нет.
 *
 * Себя компонент не позиционирует: абсолют правой колонки холста ставит родитель (handoff, «Каркас»).
 * Клавиатурных слушателей здесь нет и быть не может — единственный владелец клавиатуры это
 * `projection/input/keyboard.ts` (ADR 0019 E5); кнопки читаются как подсказка к клавише, а не как её замена.
 */

/** Высота полоски, CSS px (handoff: 36px = класс `h-9`). Нужна `ConstructorSkin` для нижнего inset камеры. */
export const CANVAS_CONTROLS_HEIGHT = 36;
export const CanvasControls: React.FC = () => {
  const { zoom, zoomIn, zoomOut, fitToContent } = useZoomControl();

  return (
    <div
      role='group'
      aria-label='Контролы холста'
      className='flex h-9 items-center gap-0.5 rounded-xl bg-[var(--surface)] px-1 shadow-[0_2px_8px_rgb(0_0_0/0.10)]'
    >
      {/* Место под линейку A→B (шаг 8): иконка `Ruler` не импортируется, пока инструмента нет. */}
      <ReservedSlot />
      <Divider />

      <PanelTooltip title={ZOOM_OUT.title} hint={ZOOM_OUT.hint} placement='top'>
        <button
          type='button'
          aria-label={ZOOM_OUT.title}
          className={BUTTON_CLASS}
          // Правило «зум на пределе шкалы» в поставке не задано (аудит, «Что осталось» п. 4): `disabled` — прямое
          // следствие полей `canZoomIn`/`canZoomOut` из `ZoomState`, а не выдуманное визуальное состояние.
          disabled={!zoom.canZoomOut}
          onClick={zoomOut}
        >
          <Minus size={20} aria-hidden='true' />
        </button>
      </PanelTooltip>

      <PanelTooltip title={ZOOM_INDICATOR.title} hint={ZOOM_INDICATOR.hint} placement='top'>
        <span className='min-w-11 px-1 text-center text-xs tabular-nums text-[var(--foreground)]'>
          {Math.round(zoom.scale * 100)}%
        </span>
      </PanelTooltip>

      <PanelTooltip title={ZOOM_IN.title} hint={ZOOM_IN.hint} placement='top'>
        <button
          type='button'
          aria-label={ZOOM_IN.title}
          className={BUTTON_CLASS}
          disabled={!zoom.canZoomIn}
          onClick={zoomIn}
        >
          <Plus size={20} aria-hidden='true' />
        </button>
      </PanelTooltip>

      <Divider />

      {/*
        Иконка «в центр» — `Scan`, и это **объявленное отступление**: раздел «Иконки» handoff'а перечисляет
        заимствования из Lucide (`ChevronLeft`, `Undo2`, `Redo2`, `Ruler`, `Maximize2`, `Minus`, `Plus`,
        `Search`) и иконку под «в центр» не называет вовсе. Единственная подходящая из списка, `Maximize2`,
        занята полноэкранным режимом, чей слот зарезервирован в этой же полоске, — два одинаковых глифа рядом
        читались бы как дубль. Поэтому берём соседнюю по смыслу `Scan`; при следующей правке handoff'а её надо
        внести в список либо заменить на утверждённую там.
      */}
      <PanelTooltip title={FIT.title} hint={FIT.hint} placement='top'>
        <button type='button' aria-label={FIT.title} className={BUTTON_CLASS} onClick={fitToContent}>
          <Scan size={20} aria-hidden='true' />
        </button>
      </PanelTooltip>

      <Divider />
      <UnitsSegment />
      <Divider />

      {/* Место под полноэкранный режим: иконка `Maximize2` не импортируется, пока режима нет. */}
      <ReservedSlot />
    </div>
  );
};
