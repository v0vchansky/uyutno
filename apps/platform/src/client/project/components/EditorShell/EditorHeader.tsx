import { Avatar, Button, Separator, Spinner } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { Link } from 'react-router';

import { displayNameOrEmailFallback, initialsFromName, useRegistry } from '@app/common';
import { getProjects, PROJECTS_QUERY_KEY, RenameProjectModal } from '@app/projects';

import type { ProjectDto } from '../../../../shared/projects';
import { Route } from '../../../../shared/router/routes';
import { saveButtonView } from '../../hooks/saveIndicatorState';
import type { SaveButtonPhase } from '../../hooks/useSaveButtonFeedback';

interface Props {
  projectId: string;
  /**
   * Обработчик кнопки «Сохранить». Каркас сохранения не делает: пока обработчик не передан, кнопка `disabled`.
   * Приносит задача 0082, состояния индикатора — 0084.
   */
  onSave?: () => void;
  /**
   * Кадр обратной связи кнопки (задача 0090): спиннер с «Сохраняем…» на время записи, галочка «Сохранено»
   * после успеха, обычный вид в покое. Сроки считает `useSaveButtonFeedback` — шапка их не знает и знать не
   * должна, её дело нарисовать присланный кадр.
   *
   * Статус при этом **один на все запросы**: ручной Save и автосейв дают один и тот же спиннер — шапка знает
   * только состояние `persistence`, а не то, сколько запросов стоит в очереди.
   */
  savePhase?: SaveButtonPhase;
  /**
   * Есть ли что сохранять — `dirty` из `persistence` (задача 0090). Нет изменений — кнопка неактивна:
   * нажатие всё равно отбросил бы dirty-гейт внутри движка, а молчащая кнопка читается как сломанная.
   *
   * **Не передан — кнопка активна.** Это не «забыли», а рабочий режим демо-роута: там нажатие поднимает
   * гейт логина (`0065`), а не сохраняет, и гасить кнопку по `dirty` нельзя (спека 10).
   */
  hasChanges?: boolean;
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

/**
 * Гашение неактивных элементов шапки на экране открытия — числа из макета (40%), а не библиотечные 50%
 * недоступной кнопки: это гашение **всей шапки**, а не признак недоступности отдельного элемента.
 * Утилита лежит в слое `utilities` и перебивает `opacity` из `@layer components`, поэтому стоит рядом с
 * `isDisabled`, а не вместо него.
 */
const DIMMED = 'pointer-events-none opacity-40';

/**
 * Ширина кнопки «Сохранить» — по самому длинному кадру («Сохраняем…» со спиннером): подпись меняется трижды
 * за полторы секунды, и без фиксации кнопка дёргалась бы вместе с аватаром на каждом переходе. Внутри всё
 * центрируется, поэтому короткие кадры не выглядят прижатыми.
 *
 * Число измерено на живой странице, а не взято на глаз: 12 (padding `.button--sm`) + 16 (`Spinner size="sm"`)
 * + 8 (gap) + 91.2 («Сохраняем…» в Inter 14/500) + 12 = 139.2 → 140. Прежние 136px считались под шрифт 13px
 * самописной кнопки; с библиотечным 14px этот кадр в них уже не влезает.
 */
const SAVE_BUTTON_WIDTH = 'w-[140px]';

/**
 * Шапка редактора (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Оболочка редактора (P1)» →
 * «Шапка», «Имя проекта»; прототип `Planner Editor Shell.dc.html`, кадры `s1`/`s2`).
 *
 * Ровно 48px по внешнему габариту (`h-12` при `box-sizing: border-box` — на платформе он глобальный), внутри
 * контейнер на всю высоту с боковым padding 12px и gap 16px. Слева направо: возврат «Проекты» со стрелкой,
 * разделитель 1×20px, имя проекта, распор, справа группа с gap 12px — слот статуса, «Сохранить», аватар 32px.
 * Внутренний контейнер обязателен: на пороге в нём меняется gap.
 *
 * **Все интерактивные элементы — библиотечные** (задача 0097). Раньше шапка была написана сырой разметкой и
 * молча вышла из-под темы: `rounded-lg` = 8px против 12px, которые `theme-uyutno.css` задаёт всем кнопкам
 * «в шапке и формах». Заливка, радиус, кольцо фокуса, курсор и обе недоступности теперь приезжают из
 * `.button` / `.avatar` / `.separator`, а не воспроизводятся руками.
 *
 * **Порог.** Handoff называет одно число — 1024px, ниже которого редактора нет вовсе, и «комфортную ширину от
 * 1280px». Плотная раскладка шапки (слово «Проекты» снято, gap 8px, имя 150px) поэтому живёт на всём участке
 * между этими двумя числами: `xl` Tailwind — это и есть 1280px.
 *
 * Чего в шапке нет и не заводится: переключателя видов (он в рейле), отмены и повтора (они в панели
 * инструментов), «Поделиться», «Скриншот», «Настройки проекта».
 */
export const EditorHeader: React.FC<Props> = ({
  projectId,
  onSave,
  savePhase = 'idle',
  hasChanges,
  saveStatus,
  isDimmed = false,
}) => {
  const { authManager } = useRegistry();
  const [isRenameOpen, setIsRenameOpen] = useState(false);

  const saveButton = saveButtonView(savePhase, { canSave: !isDimmed && onSave !== undefined, hasChanges });

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
          {/*
           * Возврат — ссылка, а не кнопка с обработчиком: у неё должен быть href, средний клик и «открыть в
           * новой вкладке». Поэтому библиотечный вид приезжает BEM-классами `.button`, а не компонентом
           * `Button` с пропом `render` — тот же приём, что уже стоит в `common/NotFoundScreen.tsx`.
           */}
          <Link
            to={Route.Projects}
            aria-label='Проекты'
            className='button button--sm button--ghost shrink-0 no-underline'
          >
            <ChevronLeft size={18} aria-hidden='true' />
            {/* На пороге остаётся одна стрелка; `aria-label` выше держит имя ссылки в обоих состояниях. */}
            <span className='max-xl:hidden'>Проекты</span>
          </Link>

          <Separator orientation='vertical' className='h-5 shrink-0 self-center' />

          {project ? (
            <Button
              size='sm'
              variant='ghost'
              /*
               * Нативного `title` у кнопки больше нет: `ButtonRootProps` его не принимает, и это правильно —
               * подсказка по наведению мышью недоступна с клавиатуры, ровно та же болезнь, которую в этой
               * задаче лечили у иконки ошибки автосейва. Имя действия несёт `aria-label`, а подпись кнопки —
               * само имя проекта.
               */
              aria-label='Переименовать проект'
              onPress={() => setIsRenameOpen(true)}
              isDisabled={isDimmed}
              className={`max-w-[150px] xl:max-w-[280px] ${isDimmed ? DIMMED : ''}`}
            >
              {/* `min-w-0` — иначе флекс-ребёнок не сжимается и многоточие не появляется. */}
              <span className='min-w-0 truncate'>{project.name}</span>
            </Button>
          ) : (
            /* Список ещё едет — держим место именем-скелетоном; проект не нашёлся (чужой или несуществующий id) —
               имени в шапке просто нет, выдумывать его каркасу нечем. */
            query.isLoading && <span aria-hidden='true' className='uyutno-skeleton h-4 w-[160px] rounded-md' />
          )}

          <span className='flex-1' />

          <div className={`flex shrink-0 items-center gap-3 ${isDimmed ? DIMMED : ''}`}>
            {saveStatus}
            <Button
              size='sm'
              onPress={onSave}
              /*
               * Две причины «нажать нельзя» — два разных пропа, а не один `disabled` с таблицей приглушений.
               * `isPending` оставляет кнопку в таб-обходе и объявляет её занятой, `isDisabled` ставит настоящий
               * атрибут `disabled` (задача 0097; прежняя константа `SAVE_BUTTON_DIM` жила ровно на этой развилке).
               */
              isPending={saveButton.pending}
              isDisabled={saveButton.disabled}
              /*
               * Единственное отступление от библиотеки — приглушение во время записи. React Aria ставит занятой
               * кнопке `aria-disabled="true"`, а `.button[aria-disabled="true"]` гасит её до 50%; решение автора
               * по задаче 0090 прямо обратное: «идёт запись — не гасим», потому что приглушение съедает контраст
               * ровно у спиннера, единственного, что в этом кадре и нужно разглядеть. Возвращаем непрозрачность
               * одним правилом на состояние, а не тремя числами на три фазы.
               */
              className={`${SAVE_BUTTON_WIDTH} shrink-0 data-[pending=true]:opacity-100`}
            >
              {saveButton.icon === 'spinner' && (
                /*
                 * Спиннер — библиотечный (HeroUI v3), а не самописное кольцо из бордюра: `color="current"`
                 * наследует цвет подписи кнопки, то есть контраст на акценте получается по построению.
                 * Замирание при `prefers-reduced-motion: reduce` у компонента своё, штатное.
                 *
                 * `size="sm"` — 16px; заказанных макетом 14px в шкале компонента нет (sm 16 / md 24 /
                 * lg 32 / xl 40), 16px в кнопку 32px садится, ручной подгонки размера не заводим.
                 *
                 * Своя роль и своё имя у компонента снимаются: подпись «Сохраняем…» кнопка несёт сама, а
                 * `role="status"` в шапке ровно один — слот статуса слева от кнопки.
                 */
                <Spinner color='current' size='sm' role={undefined} aria-label={undefined} aria-hidden='true' />
              )}
              {saveButton.icon === 'check' && <Check size={16} aria-hidden='true' />}
              {saveButton.label}
            </Button>
            {/* Аватар рисуется, поведение не заводится: меню профиля в редакторе не заказывалось (задача 0088). */}
            <Avatar size='sm' aria-hidden='true' className='shrink-0'>
              <Avatar.Fallback>{user ? initialsFromName(displayNameOrEmailFallback(user)) : ''}</Avatar.Fallback>
            </Avatar>
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
