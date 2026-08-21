import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { Link } from 'react-router';

import { displayNameOrEmailFallback, initialsFromName, useRegistry } from '@app/common';
import { getProjects, PROJECTS_QUERY_KEY, RenameProjectModal } from '@app/projects';

import type { ProjectDto } from '../../../../shared/projects';
import { Route } from '../../../../shared/router/routes';

/**
 * Кольцо фокуса — 2px акцентом вплотную к элементу (handoff, «Имя проекта»: «фокус с клавиатуры — кольцо 2px
 * `--accent`»; «Доступность»: «кольцо фокуса всюду акцентное»). Утилиты те же, что у карточек проектов, — на
 * платформе это `ring`, а не `outline` со смещением.
 */
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]';

/** То же кольцо, но со смещением: у кнопки, залитой акцентом, кольцо вплотную не видно — акцент по акценту. */
const FOCUS_RING_ON_ACCENT =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]';

interface Props {
  projectId: string;
  /**
   * Обработчик кнопки «Сохранить». Каркас сохранения не делает: пока обработчик не передан, кнопка `disabled`.
   * Приносит задача 0082, состояния «идёт запись» / «Сохранено, ЧЧ:ММ» — 0084.
   */
  onSave?: () => void;
  /**
   * Слот индикатора состояния сохранения — пустое место слева от кнопки с уже заданным порядком и gap 12px
   * (handoff, «Индикатор состояния сохранения»). Каркас про состояния индикатора не знает и `persistence` не
   * читает: содержимое слота вставляет задача 0084. Обёртки у слота нет намеренно — пустой элемент съел бы
   * лишние 12px gap'а и сдвинул кнопку с аватаром.
   */
  saveStatus?: React.ReactNode;
  /**
   * Проект ещё открывается или открыть его не удалось (задача 0085): всё, кроме возврата «Проекты»,
   * гасится до 40% и перестаёт принимать указатель (handoff, «Что перекрывает затемнение»). Погашенное
   * заодно уходит из таб-обхода — `pointer-events: none` клавиатуру не останавливает, а недоступное
   * действие не должно ловить фокус.
   */
  isDimmed?: boolean;
}

/** Гашение неактивных элементов шапки на экране открытия — числа из макета. */
const DIMMED = 'pointer-events-none opacity-40';

/**
 * Шапка редактора (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Оболочка редактора (P1)» →
 * «Шапка», «Имя проекта»; прототип `Planner Editor Shell.dc.html`, кадры `s1`/`s2`).
 *
 * Ровно 48px по внешнему габариту (`h-12` при `box-sizing: border-box` — на платформе он глобальный), внутри
 * контейнер на всю высоту с боковым padding 12px и gap 16px. Слева направо: возврат «Проекты» со стрелкой 18px,
 * разделитель 1×20px, имя проекта, распор, справа группа с gap 12px — слот статуса, «Сохранить», аватар 32px.
 * Внутренний контейнер обязателен: на пороге в нём меняется gap.
 *
 * **Порог.** Handoff называет одно число — 1024px, ниже которого редактора нет вовсе, и «комфортную ширину от
 * 1280px». Плотная раскладка шапки (слово «Проекты» снято, gap 8px, имя 150px) поэтому живёт на всём участке
 * между этими двумя числами: `xl` Tailwind — это и есть 1280px.
 *
 * Чего в шапке нет и не заводится: переключателя видов (он в рейле), отмены и повтора (они в панели
 * инструментов), «Поделиться», «Скриншот», «Настройки проекта».
 */
export const EditorHeader: React.FC<Props> = ({ projectId, onSave, saveStatus, isDimmed = false }) => {
  const { authManager } = useRegistry();
  const [isRenameOpen, setIsRenameOpen] = useState(false);

  /**
   * Имя приходит из карточки проекта — отдельной ручки «один проект» в API нет (`src/server/projects/router.ts`),
   * зато список уже лежит в кеше после `/projects`. Ключ тот же, что у списка, поэтому переименование,
   * инвалидирующее `PROJECTS_QUERY_KEY`, обновляет шапку без перезагрузки.
   */
  const query = useQuery<ProjectDto[]>({ queryKey: PROJECTS_QUERY_KEY, queryFn: getProjects });
  const project = query.data?.find(item => item.id === projectId) ?? null;

  const user = authManager.getCurrentUser();

  return (
    <>
      <header className='h-12 shrink-0 border-b border-[var(--separator)] bg-[var(--surface)]'>
        <div className='flex h-full items-center gap-2 px-3 xl:gap-4'>
          <Link
            to={Route.Projects}
            aria-label='Проекты'
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] text-[color:var(--foreground)] no-underline hover:bg-[var(--surface-secondary)] ${FOCUS_RING}`}
          >
            <ChevronLeft size={18} aria-hidden='true' />
            {/* На пороге остаётся одна стрелка; `aria-label` выше держит имя ссылки в обоих состояниях. */}
            <span className='max-xl:hidden'>Проекты</span>
          </Link>

          <span aria-hidden='true' className='h-5 w-px shrink-0 bg-[var(--border)]' />

          {project ? (
            <button
              type='button'
              aria-label='Переименовать проект'
              title='Переименовать проект'
              onClick={() => setIsRenameOpen(true)}
              disabled={isDimmed}
              className={`h-8 max-w-[150px] cursor-pointer truncate rounded-lg px-2 text-left text-[14px] font-medium text-[color:var(--foreground)] hover:bg-[var(--surface-secondary)] xl:max-w-[280px] ${FOCUS_RING} ${isDimmed ? DIMMED : ''}`}
            >
              {project.name}
            </button>
          ) : (
            /* Список ещё едет — держим место именем-скелетоном; проект не нашёлся (чужой или несуществующий id) —
               имени в шапке просто нет, выдумывать его каркасу нечем. */
            query.isLoading && <span aria-hidden='true' className='uyutno-skeleton h-4 w-[160px] rounded-md' />
          )}

          <span className='flex-1' />

          <div className={`flex shrink-0 items-center gap-3 ${isDimmed ? DIMMED : ''}`}>
            {saveStatus}
            <button
              type='button'
              onClick={onSave}
              disabled={isDimmed || !onSave}
              className={`inline-flex h-8 cursor-pointer items-center justify-center rounded-lg bg-[var(--accent)] px-3 text-[13px] font-medium text-[color:var(--accent-foreground)] disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING_ON_ACCENT}`}
            >
              Сохранить
            </button>
            {/* Аватар рисуется, поведение не заводится: меню профиля в редакторе не заказывалось (задача 0088). */}
            <span
              aria-hidden='true'
              className='inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-secondary)] text-[12px] font-semibold text-[color:var(--foreground)]'
            >
              {user ? initialsFromName(displayNameOrEmailFallback(user)) : ''}
            </span>
          </div>
        </div>
      </header>

      {/*
       * Модалка переименования — существующая, из списка проектов: своей редактор не заводит (handoff, «Имя
       * проекта»). Монтируется по требованию, а не висит закрытой: `Modal` HeroUI без триггера-ребёнка пишет в
       * консоль предупреждение «A PressResponder was rendered without a pressable child», а консоль страницы
       * проекта под гвардом — `e2e/planner-render-guard.spec.ts` не прощает ни одного warning'а. Содержимое
       * модалки и так монтируется только на открытии (`RenameForm` внутри неё), так что терять нечего.
       */}
      {isRenameOpen && (
        <RenameProjectModal project={project} isOpen onOpenChange={open => !open && setIsRenameOpen(false)} />
      )}
    </>
  );
};
