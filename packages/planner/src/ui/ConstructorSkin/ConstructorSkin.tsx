import type React from 'react';
import { useEffect } from 'react';

import { NO_INSETS, type ViewportInsets } from '../../projection/canvas2d/camera';
import { CANVAS_CONTROLS_HEIGHT, CanvasControls } from '../CanvasControls/CanvasControls';
import { KEY_HINTS_HEIGHT, KeyHints } from '../KeyHints/KeyHints';
import { usePlannerProjections } from '../PlannerContext';
import { STATS_SLOT_HEIGHT, StatsSlot } from '../StatsSlot/StatsSlot';
import { TOOL_PANEL_WIDTH, ToolPanel } from '../ToolPanel/ToolPanel';
import { usePlannerSelector } from '../usePlannerSelector';
import { VIEW_RAIL_WIDTH, ViewRail } from '../ViewRail/ViewRail';
import { FirstStepHint } from './FirstStepHint';

/** Отступ оверлеев от краёв холста — классы `left-3` / `right-3` / `bottom-3` ниже, шаг 12px шкалы отступов. */
const OVERLAY_GAP = 12;

/** Зазор между слотом сводки и полоской контролов в правой колонке — класс `gap-2`. */
const RIGHT_COLUMN_GAP = 8;

/**
 * Полосы кадра, закрытые непрозрачными оверлеями скина, — то, что скин сообщает камере конструктора
 * (`Canvas2dProjection.setViewportInsets`), чтобы «в центр» и сброс камеры вписывали план в **видимую** часть
 * холста, а не под панели. Числа не выдуманы: каждое — размер конкретного компонента, объявленный рядом с ним.
 *
 * Левая полоса берётся на всю высоту, хотя панель инструментов короче кадра: insets — прямоугольная рамка, и
 * запас здесь в пользу пользователя (геометрия гарантированно достижима мышью). Правой полосы нет вовсе —
 * колонка со сводкой и контролами целиком лежит внутри нижней. Верхней тоже нет: шапки редактора в этой
 * поставке не существует (см. «Что сознательно не делалось» в 0061); появится — добавится сюда.
 */
export const CONSTRUCTOR_SKIN_INSETS: Readonly<ViewportInsets> = Object.freeze({
  left: VIEW_RAIL_WIDTH + OVERLAY_GAP + TOOL_PANEL_WIDTH + OVERLAY_GAP,
  right: 0,
  top: 0,
  bottom: OVERLAY_GAP + Math.max(KEY_HINTS_HEIGHT, STATS_SLOT_HEIGHT + RIGHT_COLUMN_GAP + CANVAS_CONTROLS_HEIGHT),
});

/** На чужом виде оверлеи конструктора сняты — остаётся один рейл, он виден во всех видах. */
export const RAIL_ONLY_INSETS: Readonly<ViewportInsets> = Object.freeze({
  left: VIEW_RAIL_WIDTH,
  right: 0,
  top: 0,
  bottom: 0,
});

/**
 * Минимальный UI-скин шага 2 (задача 0061): рейл видов и снапа, панель инструментов, группа контролов холста,
 * место под сводку и полоса подсказки клавиш. Монтируется **детьми `<Planner />`** — то есть внутри
 * `PlannerContext` и внутри контейнера с канвасами (ADR 0020 P6): панели живут абсолютом поверх холста, холст
 * ширину не теряет (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Каркас»; решение 13 брифа).
 *
 * Все действия идут только через публичный API фасада и проекций (ADR 0015 A2): своего состояния документа
 * скин не держит, читает через `usePlannerSelector`.
 *
 * **Клавиатуру скин не слушает.** Единственный владелец клавиатуры — `projection/input/keyboard.ts` (ADR 0019 E5);
 * кнопки идут тем же маршрутом `tools.key`, а не своим. Ни одного `addEventListener('keydown')` во всём скине.
 *
 * Чего здесь нет и почему:
 * - **шапки редактора 48px и рамки холста** (отступ 8px, радиус 12px) — это каркас оболочки P1.1/P1.2 handoff'а,
 *   отдельный пакет работ; без шапки рамка холста повисла бы в воздухе;
 * - **кнопок 3D-обзора и walk** — шаги 4 и 9 (скоуп 0061);
 * - **линейки и полноэкранного режима** в группе контролов холста — их места зарезервированы пустыми (шаг 8 и
 *   позже), неработающих кнопок пользователю не показываем;
 * - **содержимого панели статистики** — угол под сводку зарезервирован пустым (решение 11).
 */
export interface ConstructorSkinProps {
  /**
   * Оверлеи холста, живущие в том же контейнере, — прежде всего DOM-слой полей ввода длины и подписей (0060).
   * Общий контекст скина (`PlannerOverlayProvider`) поднимает `<Planner />`, так что и панели, и оверлей читают
   * одни и те же тумблеры подписей и один и тот же фокус в поле длины.
   */
  children?: React.ReactNode;
}

export const ConstructorSkin: React.FC<ConstructorSkinProps> = ({ children }) => {
  const activeView = usePlannerSelector(manager => manager.view.get().activeView);
  const projections = usePlannerProjections();
  const isConstructor = activeView === 'constructor';

  /*
   * Скин — единственный, кто знает свои размеры, поэтому он и сообщает камере, какая часть холста закрыта
   * (находка критика 0061: рейл и панель съедали 308px слева, а `fitToContent` считал по всему кадру и клал
   * геометрию под глухую панель). Отдаём фактом раскладки, не пропсом: панели монтируются и снимаются вместе
   * с видом, а проекция живёт дольше React-дерева.
   */
  useEffect(() => {
    projections.canvas2d.setViewportInsets(isConstructor ? CONSTRUCTOR_SKIN_INSETS : RAIL_ONLY_INSETS);
    // Скин сняли — холст снова видно целиком: проекция переживает React-дерево и не должна остаться с
    // insets от размонтированных панелей.
    return () => projections.canvas2d.setViewportInsets(NO_INSETS);
  }, [projections, isConstructor]);

  return (
    <>
      {/*
       * Рейл — непрозрачная колонка 60px по левому краю контейнера. Канвасы лежат под ней во всю ширину
       * (их геометрию задаёт `<Planner />`), поэтому рейл виден во всех видах: без него из конструктора
       * некуда выйти (решение 8 брифа).
       */}
      {/*
       * `z-20` против `z-10` слоя оверлеев — не «на всякий случай»: рейл идёт в DOM раньше, и при равном
       * z-индексе его тултипы (`position: fixed` внутри стекового контекста рейла) уезжали бы **под**
       * непрозрачную панель инструментов. Иконка без подписи без читаемого тултипа бесполезна.
       */}
      <div className='absolute inset-y-0 left-0 z-20 flex'>
        <ViewRail />
      </div>

      {isConstructor && (
        // Слой оверлеев холста прозрачен для указателя: клик мимо панели уходит в канвас (handoff, «Каркас»).
        <div className='pointer-events-none absolute inset-y-0 left-[60px] right-0 z-10'>
          <FirstStepHint />

          <div className='pointer-events-auto absolute left-3 top-3 max-h-[calc(100%-1.5rem)]'>
            <ToolPanel />
          </div>

          {/*
           * Правая колонка: место под сводку (решение 11), под ним полоска контролов холста (решение 7).
           * Указатель возвращает себе только полоска: `StatsSlot` — декоративный пустой слот, и `pointer-events`
           * на всей колонке съедали бы клики по холсту прямоугольником 180×36.
           */}
          <div className='absolute bottom-3 right-3 flex flex-col items-end gap-2'>
            <StatsSlot />
            <div className='pointer-events-auto'>
              <CanvasControls />
            </div>
          </div>

          {/*
           * Полоса подсказки центрируется по холсту и ограничена 560px, поэтому с правой колонкой не
           * пересекается даже на 1024px (handoff, «Каркас», «Адаптив»).
           */}
          <div className='absolute inset-x-0 bottom-3 flex justify-center'>
            <KeyHints />
          </div>
        </div>
      )}

      {/* Оверлеи-потребители контекста (0060) позиционируют себя сами и указатель не теряют. */}
      {children}
    </>
  );
};
