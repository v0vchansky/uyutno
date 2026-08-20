import type React from 'react';
import { useId } from 'react';

import type { DrawingTool, ToolKind } from '../../engine/tools/ToolState';
import { type DraftIconProps, PolyRoomToolIcon, RectRoomToolIcon, WallsToolIcon } from '../icons/draftIcons';
import { usePlannerManager } from '../PlannerContext';
import { PanelTooltip } from '../Tooltip/PanelTooltip';
import { usePlannerSelector } from '../usePlannerSelector';
import { HistoryRow } from './HistoryRow';
import { LabelToggles } from './LabelToggles';

/**
 * Панель инструментов конструктора (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Каркас» и «Панель
 * инструментов»): плавающий блок 224px поверх холста — строка истории и список инструментов рисования.
 * Себя не позиционирует: абсолют слева сверху с отступом 12px задаёт родитель, панель отдаёт только ширину и
 * внутреннюю раскладку.
 *
 * Строки — «иконка + название», а не голые иконки (решение 6 брифа `docs/ui/briefs/planner-editor.md`): подписи в
 * рейл 60px не встают, поэтому список и лежит оверлеем.
 *
 * Вторая группа — «Подписи» (`LabelToggles`): три переключателя видимости. Их состояние живёт не в документе
 * (`DocumentSettings` = `{ units, wallHeight }`, команды под них в фасаде нет), а в скине — контекст
 * `ui/PlannerOverlayContext.tsx`, общий с оверлеем размеров, который эти подписи и рисует.
 *
 * Клавиатуру панель не слушает: единственный владелец клавиатуры — `projection/input/keyboard.ts` (ADR 0019 E5).
 * Кнопки читаются как подсказка к клавише, а не как единственный способ действия.
 */

/**
 * Ширина панели, CSS px (handoff, «Панель инструментов»). Публичная по той же причине, что и ширина рейла:
 * панель — непрозрачный оверлей, и камера конструктора обязана знать, какую полосу холста он закрывает
 * (`ConstructorSkin`, `setViewportInsets`). Дублирует класс `w-56` ниже: 56 × 0.25rem = 224px.
 */
export const TOOL_PANEL_WIDTH = 224;

/** Строка инструмента: чем стартует, чем помечено активное состояние автомата и что показывает тултип. */
interface ToolRow {
  /** Аргумент `tools.start`. */
  tool: DrawingTool;
  /** Состояние автомата, в котором строка активна (`aria-pressed="true"`). */
  activeKind: ToolKind;
  /** Название = видимая подпись = `aria-label` (handoff, «Тултипы»). */
  title: string;
  /** Вторая строка тултипа. */
  hint: string;
  Icon: React.FC<DraftIconProps>;
}

/** Группа строк с заголовком. Панель обязана расти новыми группами (handoff), поэтому список групп — данные, а не вёрстка. */
interface ToolGroup {
  title: string;
  rows: readonly ToolRow[];
}

/**
 * Состав панели. Четвёртая строка («Зона», «Линейка A→B», «Импортировать план», …) — это новый элемент массива,
 * новая группа — новый элемент `TOOL_GROUPS`; вёрстка не правится.
 */
const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    title: 'Инструменты',
    rows: [
      {
        tool: 'walls',
        activeKind: 'making-walls',
        title: 'Стены',
        hint: 'Ломаная с толщиной. Esc — выйти из режима',
        Icon: WallsToolIcon,
      },
      {
        tool: 'rect',
        activeKind: 'making-rect',
        title: 'Прямоугольная комната',
        hint: 'Два клика по углам, стены сразу с толщиной',
        Icon: RectRoomToolIcon,
      },
      {
        tool: 'room',
        activeKind: 'making-room',
        title: 'Комната по точкам',
        hint: 'Полигон без толщины, минимум четыре вершины',
        Icon: PolyRoomToolIcon,
      },
    ],
  },
];

/** Заголовок группы — 11px/600, uppercase, трекинг 0.06em, `--muted`, padding 4px 8px (handoff). Один на все группы. */
const GROUP_TITLE_CLASS = 'px-2 py-1 text-[11px] font-semibold tracking-[0.06em] text-[var(--muted)] uppercase';

/**
 * Группа контролов панели: подпись сверху, строки внутри. Подпись — `<div>`, а не `<h3>`: на странице редактора
 * нет ни `h1`, ни `h2` (холст — оверлеи поверх графики, а не документ с разделами), и заголовок третьего уровня
 * рвал бы уровни в дереве заголовков. Смысл «подпись этой группы» отдаётся ассистивным технологиям тем, ради чего
 * заголовок и ставился, — `role="group"` + `aria-labelledby` (handoff `planner-editor-ui.md`, «Доступность»).
 * Визуально — ровно та же вёрстка, что была.
 */
const PanelGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const titleId = useId();
  return (
    <div role='group' aria-labelledby={titleId} className='flex flex-col gap-0.5'>
      <div id={titleId} className={GROUP_TITLE_CLASS}>
        {title}
      </div>
      {children}
    </div>
  );
};

/**
 * Строка 36px, радиус 8px, иконка 20px и название через 8px (handoff). Кольцо фокуса — акцентное, как всюду в
 * редакторе. `cursor-pointer` — явно: preflight Tailwind v4 ставит `button { cursor: default }`, поэтому курсор
 * над кликабельным задаётся руками, как всюду на платформе (`apps/platform/src/client/**`).
 */
const ROW_CLASS =
  'flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]';

/**
 * Активная строка — заливка `--accent`, текст белый. Начертание **полужирное**: контраст терракоты с белым 4.1:1,
 * гайдлайн (`docs/ui/guidelines.md`) даёт порог «от 15px, либо полужирный от 14px», а handoff сам себе противоречит —
 * «название 14px» в разделе «Панель инструментов» против «мелких надписей на акцентном фоне нет» в «Доступности»
 * (аудит `docs/ui/handoffs/planner/README-audit.md`, «Что осталось» п. 6). Берём 14px/600.
 *
 * «Наведение» у неактивных строк в поставке не задано (аудит, п. 4) — добор за дизайн существующей ролью темы
 * `--surface-secondary`, а не новым цветом.
 */
const ROW_ACTIVE_CLASS = 'bg-[var(--accent)] font-semibold text-white';
const ROW_IDLE_CLASS = 'text-[var(--surface-foreground)] hover:bg-[var(--surface-secondary)]';

export const ToolPanel: React.FC = () => {
  const manager = usePlannerManager();
  // Примитив, а не снимок: `tools:changed` летит на каждый `pointerMove`, ре-рендер нужен только на смену режима.
  const kind = usePlannerSelector(planner => planner.tools.get().kind);

  /**
   * Исключений наружу нет — `tools.start` возвращает `Result` и вправду отказывает: `view-not-constructor`
   * (активен 2D-план) и `no-active-floor`. Отказ пишется в тот же DI-логгер тем же уровнем и префиксом, что и
   * отказы движка (`engine/tools/*.ts`, `ctx.logger.debug('… rejected', result.error)`), иначе кнопка молча
   * ничего не делает. UI на отказ не показывается: инструмент недоступен по состоянию редактора, а не по ошибке.
   */
  const startTool = (tool: DrawingTool): void => {
    const result = manager.tools.start(tool);
    if (!result.ok) manager.logger.debug('@uyutno/planner: tools.start rejected', result.error);
  };

  return (
    <div
      role='group'
      aria-label='Инструменты конструктора'
      // Не влезли в высоту холста — скроллимся внутри себя; заголовки групп при скролле не липнут (handoff).
      className='flex max-h-full w-56 flex-col gap-0.5 overflow-y-auto rounded-xl bg-[var(--surface)] p-2 shadow-[0_2px_8px_rgb(0_0_0/0.10)]'
    >
      <HistoryRow />
      {TOOL_GROUPS.map(group => (
        <PanelGroup key={group.title} title={group.title}>
          {group.rows.map(row => {
            const active = kind === row.activeKind;
            return (
              <PanelTooltip key={row.tool} title={row.title} hint={row.hint} placement='right'>
                <button
                  type='button'
                  aria-label={row.title}
                  aria-pressed={active}
                  onClick={() => startTool(row.tool)}
                  className={`${ROW_CLASS} ${active ? ROW_ACTIVE_CLASS : ROW_IDLE_CLASS}`}
                >
                  <row.Icon size={20} className='shrink-0' />
                  <span className='truncate'>{row.title}</span>
                </button>
              </PanelTooltip>
            );
          })}
        </PanelGroup>
      ))}
      <PanelGroup title='Подписи'>
        <LabelToggles />
      </PanelGroup>
    </div>
  );
};
