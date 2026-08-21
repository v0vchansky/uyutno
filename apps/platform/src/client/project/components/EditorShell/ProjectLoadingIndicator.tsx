import { Spinner } from '@heroui/react';
import type React from 'react';

import type { ProjectOpenPhase } from '../../hooks/projectOpenState';

/**
 * Тексты фаз — дословно из принятого макета (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`,
 * «Состояния экрана · оболочка»; прототип `Planner Editor Shell.dc.html`, кадры «загрузка · фаза 1/2»).
 * Обе фазы заказаны брифом и заведены сразу: вторая в v0 проходит мгновенно — каталога моделей и
 * материалов ещё нет (шаг 5), — но появится он без переделки экрана.
 */
const PHASE_LABEL: Record<ProjectOpenPhase, string> = {
  1: 'Загружаем проект',
  2: 'Подгружаем модели и материалы',
};

/** Заполнение полоски по фазам — числа прототипа; шкала условная, реального прогресса у запроса нет. */
const PHASE_PROGRESS: Record<ProjectOpenPhase, string> = { 1: '45%', 2: '85%' };

export const PROJECT_LOADING_PHASES = 2;

interface Props {
  phase: ProjectOpenPhase;
}

/**
 * Индикатор открытия проекта поверх холста (спека 10, «Load проекта» → «Индикация»).
 *
 * Кладётся абсолютом на всю область под шапкой и **непрозрачен**: пока сцена не восстановлена, показывать
 * нечего, а ввод не должен доходить до автомата инструментов. Затемнения здесь нет намеренно (handoff,
 * «Что перекрывает затемнение»): под индикатором пустой холст, гасить нечего.
 */
export const ProjectLoadingIndicator: React.FC<Props> = ({ phase }) => (
  <div className='absolute inset-0 z-10 flex items-center justify-center bg-[var(--surface)]'>
    {/* `role="status"` — смена фазы читается скринридером и не перебивает (handoff, «Доступность»). */}
    <div role='status' className='flex flex-col items-center gap-3'>
      {/*
       * Спиннер библиотечный (HeroUI v3), как и на кнопке «Сохранить». До задачи 0091 здесь стояло
       * самописное кольцо: индикатор попадает в SSR-разметку (сервер рендерит страницу проекта ровно в
       * фазе 1), а `Spinner` зовёт `useId`, который до сведения корней рендера расходился между сервером
       * и клиентом. Корни сведены — оговорка снята.
       *
       * `size="lg"` — 32px; заказанных макетом 28px в шкале компонента нет (sm 16 / md 24 / lg 32 /
       * xl 40), ручной подгонки размера не заводим (то же решение, что на кнопке в 0090). Скорость
       * вращения и замирание при `prefers-reduced-motion: reduce` — штатные, компонента.
       *
       * Своя роль и своё имя у компонента сняты: `role="status"` на экране ровно один — обёртка выше.
       */}
      <Spinner color='accent' size='lg' role={undefined} aria-label={undefined} aria-hidden='true' />
      <span className='text-[14px] font-medium text-[color:var(--foreground)]'>{PHASE_LABEL[phase]}</span>
      <span className='text-[12px] text-[color:var(--muted)]'>{`Шаг ${phase} из ${PROJECT_LOADING_PHASES}`}</span>
      <span
        aria-hidden='true'
        className='block h-1 w-[180px] overflow-hidden rounded-[2px] bg-[var(--surface-tertiary)]'
      >
        <span className='block h-full rounded-[2px] bg-[var(--accent)]' style={{ width: PHASE_PROGRESS[phase] }} />
      </span>
    </div>
  </div>
);
