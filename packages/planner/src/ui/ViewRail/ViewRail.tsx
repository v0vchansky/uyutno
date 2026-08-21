import type React from 'react';

import type { SnapFlags } from '../../document/geometry/snap/getSnapPoint';
import type { ViewKind } from '../../document/PlannerDocument';
import {
  BisectorAlignIcon,
  ConstructorViewIcon,
  OrthoAlignIcon,
  PlanViewIcon,
  PointsAlignIcon,
  PointsSnapIcon,
  type DraftIconProps,
} from '../icons/draftIcons';
import { usePlannerManager, usePlannerProjections } from '../PlannerContext';
import { usePlannerSelector } from '../usePlannerSelector';
import { SnapToggle } from './SnapToggle';
import { ViewButton } from './ViewButton';

/**
 * Виды, у которых в этом шаге есть кнопка. 3D-обзор и прогулка приезжают своими шагами
 * (`docs/product/architecture/planner-build-order.md`, шаги 4 и 9) — заглушек под них здесь нет.
 */
type RailView = Extract<ViewKind, 'constructor' | 'plan'>;

interface ViewButtonSpec {
  view: RailView;
  icon: React.FC<DraftIconProps>;
  title: string;
  hint: string;
}

/** Тексты = `aria-label` + вторая строка тултипа (handoff `planner-editor-ui.md`, «Тултипы»). */
const VIEW_BUTTONS: readonly ViewButtonSpec[] = [
  {
    view: 'constructor',
    icon: ConstructorViewIcon,
    title: 'Конструктор стен',
    hint: 'Чертёж стен: контуры, точки, размеры. Повторный клик — сбросить камеру',
  },
  {
    view: 'plan',
    icon: PlanViewIcon,
    title: '2D-план',
    hint: 'План сверху с текстурами и мебелью, без размеров и хендлов',
  },
];

interface SnapToggleSpec {
  flag: keyof SnapFlags;
  icon: React.FC<DraftIconProps>;
  title: string;
  hint: string;
}

/**
 * Порядок — как у флагов в `SnapFlags`. Тексты второго и третьего тумблеров в поставке перепутаны местами
 * (аудит `docs/ui/handoffs/planner/README-audit.md`, «Что осталось» п. 1): «оси через точки» — это `pointsAlign`,
 * а «ровно по горизонтали и вертикали» — орто-лок `orthoAlign`. Здесь — исправленные формулировки.
 * Тултип `pointsSnap` обязан сказать, что выключение не отключает притяжение совсем (handoff, «Тултипы»):
 * радиус сжимается до `POINT_SNAP_OFF_RADIUS` = 2 см.
 */
const SNAP_TOGGLES: readonly SnapToggleSpec[] = [
  {
    flag: 'pointsSnap',
    icon: PointsSnapIcon,
    title: 'Липнуть к углам',
    hint: 'Выключение сжимает радиус притяжения до 2 см, а не отключает его',
  },
  {
    flag: 'pointsAlign',
    icon: PointsAlignIcon,
    title: 'Оси через точки',
    hint: 'Вертикали и горизонтали через любые точки плана',
  },
  {
    flag: 'orthoAlign',
    icon: OrthoAlignIcon,
    title: 'Ровно по горизонтали и вертикали',
    hint: 'Относительно предыдущей и первой точки контура',
  },
  {
    flag: 'bisectorAlign',
    icon: BisectorAlignIcon,
    title: 'По центру угла',
    hint: 'Линия делит ближайший угол пополам',
  },
];

/**
 * Ширина рейла, CSS px (handoff, «Рейл»). Публичная, потому что колонку под рейл держит контейнер `<Planner />`
 * — и держит **с первого кадра**, до подъёма движка (задача 0089): иначе рамка холста сжималась бы уже после
 * того, как проекция его измерила. Камере эта полоса не сообщается: рейл стоит снаружи рамки и холст не
 * закрывает. Значение дублирует класс `w-[60px]` ниже — Tailwind JIT читает только литералы в разметке.
 */
export const VIEW_RAIL_WIDTH = 60;

/**
 * Рейл редактора (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Рейл»): ширина 60px, фон `--surface`,
 * граница `--separator` справа, padding 8px по вертикали, кнопки 44×44 с шагом 2px, между видами и тумблерами —
 * разделитель 28×1px `--border` с отступом 8px. Себя рейл не позиционирует — это делает родитель.
 *
 * Клик по неактивной кнопке вида меняет вид, по активной — сбрасывает камеру этого вида к дефолту
 * (спека `docs/product/features/planner/08-cameras-views.md`, «Смена вида»). У конструктора камеры в документе
 * нет — она локальна вьюверу (ADR 0020 P3), поэтому его сброс идёт в проекцию, а не в фасад.
 *
 * Клавиатуру рейл не слушает: единственный владелец клавиатуры — `projection/input/keyboard.ts` (ADR 0019),
 * а кнопки читаются как подсказка к действию, а не как единственный способ его выполнить.
 *
 * Корень — `role="group"`, а не `toolbar`: `toolbar` обещает roving tabindex и стрелки, которых у рейла нет
 * (клавиатурных слушателей здесь по ADR 0019 быть не может); `nav` тоже не подходит — это не навигация.
 */
export const ViewRail: React.FC = () => {
  const manager = usePlannerManager();
  const projections = usePlannerProjections();
  const activeView = usePlannerSelector(m => m.view.get().activeView);

  /**
   * Исключений наружу нет — команды `view.*` возвращают `Result`. Отказ пишется в тот же DI-логгер тем же уровнем
   * и префиксом, что и отказы движка (`engine/tools/*.ts`, `ctx.logger.debug('… rejected', result.error)`): без
   * этого отказ выглядит как «кнопка не работает». UI на отказ не показывается — это не пользовательская ошибка.
   */
  const select = (view: RailView): void => {
    if (view !== activeView) {
      const result = manager.view.setActive(view);
      if (!result.ok) manager.logger.debug('@uyutno/planner: view.setActive rejected', result.error);
      return;
    }
    if (view === 'constructor') {
      projections.canvas2d.resetCamera();
      return;
    }
    const result = manager.view.resetCamera(view);
    if (!result.ok) manager.logger.debug('@uyutno/planner: view.resetCamera rejected', result.error);
  };

  return (
    <div
      role='group'
      aria-label='Виды и снап'
      className='flex w-[60px] flex-col items-center border-r border-[var(--separator)] bg-[var(--surface)] py-2'
    >
      <div className='flex flex-col items-center gap-0.5'>
        {VIEW_BUTTONS.map(({ view, icon, title, hint }) => (
          <ViewButton
            key={view}
            icon={icon}
            title={title}
            hint={hint}
            active={view === activeView}
            onSelect={() => select(view)}
          />
        ))}
      </div>
      <div aria-hidden className='my-2 h-px w-7 bg-[var(--border)]' />
      <div className='flex flex-col items-center gap-0.5'>
        {SNAP_TOGGLES.map(({ flag, icon, title, hint }) => (
          <SnapToggle key={flag} flag={flag} icon={icon} title={title} hint={hint} />
        ))}
      </div>
    </div>
  );
};
