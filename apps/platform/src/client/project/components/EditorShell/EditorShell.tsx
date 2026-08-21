import type React from 'react';

import type { ProjectOpenPhase } from '../../hooks/projectOpenState';
import { useEditorViewportFit } from '../../hooks/useEditorViewportFit';
import type { SaveButtonPhase } from '../../hooks/useSaveButtonFeedback';
import { DesktopOnlyScreen } from './DesktopOnlyScreen';
import { EditorHeader } from './EditorHeader';
import { ProjectLoadingIndicator } from './ProjectLoadingIndicator';
import { ProjectOpenErrorModal } from './ProjectOpenErrorModal';

/**
 * Чем занята оболочка, пока проект открывается (задача 0085; handoff, «Состояния экрана · оболочка»).
 * Дефолт — `ready`: до 0085 экран открытия не существовал, и без пропа оболочка ведёт себя как раньше.
 */
export type EditorOpenStatus =
  | { kind: 'loading'; phase: ProjectOpenPhase }
  /** Битый документ или отказ транспорта: модалка с повтором, индикатора уже нет. */
  | { kind: 'failed'; onRetry: () => void }
  /** Документ записан более новым бандлом: своя модалка, повторять нечего. */
  | { kind: 'unsupported-version' }
  | { kind: 'ready' };

interface Props {
  projectId: string;
  /**
   * Планер со скином. Ниже порога 1024px **не рендерится вовсе**: элемент создан, но в дерево не попадает,
   * поэтому ни канвасов, ни WebGL-контекста на телефоне не появляется.
   *
   * Пока проект не открыт, страница не передаёт сюда ничего — и ни рейла, ни рамки холста тогда на экране нет:
   * обводить нечего, под шапкой чистый белый экран (handoff, «Состояния экрана · оболочка»).
   */
  children?: React.ReactNode;
  /** Прокидывается в кнопку «Сохранить»; пока не передан — кнопка `disabled` (логика — задачи 0082/0084). */
  onSave?: () => void;
  /** Кадр обратной связи кнопки: «Сохраняем…» со спиннером, «Сохранено» с галочкой, покой (задача 0090). */
  savePhase?: SaveButtonPhase;
  /** Есть ли что сохранять: без изменений кнопка «Сохранить» неактивна (задача 0090). */
  hasChanges?: boolean;
  /** Слот индикатора сохранения в шапке; каркас держит место, содержимое приносит задача 0084. */
  saveStatus?: React.ReactNode;
  /**
   * Модалка отказа ручного сохранения (задача 0084). Живёт в оболочке, а не на странице, по той же причине,
   * что и модалки открытия: ниже порога 1024px редактора нет вовсе, и диалог поверх заглушки был бы вторым
   * экраном на одном окне.
   */
  saveAlert?: React.ReactNode;
  openStatus?: EditorOpenStatus;
}

/**
 * Каркас оболочки редактора (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Каркас» P0 и «Оболочка
 * редактора (P1)»; прототип `Planner Editor Shell.dc.html`, кадры `s0`–`s2` и «загрузка · фаза 1/2»).
 *
 * Фон страницы `--background`, сверху шапка 48px, под ней — вся оставшаяся площадь под планер.
 *
 * **Строку под шапкой раскладывает пакет** (задача 0089): рейл 60px слева, затем рамка холста — отступ 8px,
 * радиус 12px, граница 1px `--border`. Платформа рамку не рисует намеренно: в макете рейл стоит **снаружи**
 * рамки, а рамка вокруг всего `<Planner />` неизбежно забирала бы рейл внутрь себя — рейл и канвасы принадлежат
 * пакету, и разделить их может только он.
 *
 * **Экран открытия — тоже оболочка** (задача 0085): индикатор фаз и модалки отказа живут здесь, а не на
 * странице, потому что оба обязаны оставаться под порогом 1024px — ниже него редактора нет вовсе, и модалка
 * поверх заглушки была бы вторым экраном на одном окне.
 *
 * Логики сохранения здесь по-прежнему нет ни строки: каркас не читает `persistence` и про формат не знает
 * (задачи 0082–0084).
 */
export const EditorShell: React.FC<Props> = ({
  projectId,
  children,
  onSave,
  savePhase,
  hasChanges,
  saveStatus,
  saveAlert,
  openStatus = { kind: 'ready' },
}) => {
  const fit = useEditorViewportFit();

  if (fit === 'too-narrow') return <DesktopOnlyScreen />;

  const isOpening = openStatus.kind !== 'ready';

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden bg-[var(--background)] text-[color:var(--foreground)]'>
      {/*
       * Во время открытия в шапке рабочей остаётся только ссылка «Проекты»: подгрузка может подвиснуть, и
       * единственным выходом не должна оказаться кнопка «назад» в браузере (handoff, «Что перекрывает
       * затемнение»). Уйти в этот момент безопасно — правок ещё нет, терять нечего.
       */}
      <EditorHeader
        projectId={projectId}
        onSave={onSave}
        savePhase={savePhase}
        hasChanges={hasChanges}
        saveStatus={saveStatus}
        isDimmed={isOpening}
      />

      <main className='relative flex min-h-0 flex-1'>
        {fit === 'fits' && children ? (
          children
        ) : (
          /* Планера в дереве нет — значит нет ни рейла, ни рамки: под шапкой чистый белый экран (handoff). */
          <div className='min-w-0 flex-1 bg-[var(--surface)]' />
        )}

        {openStatus.kind === 'loading' && <ProjectLoadingIndicator phase={openStatus.phase} />}
      </main>

      {/* Пока проект открывается, сохранять нечего — отказ ручного Save в этот момент физически не родится. */}
      {!isOpening && saveAlert}

      {openStatus.kind === 'failed' && <ProjectOpenErrorModal kind='failed' onRetry={openStatus.onRetry} />}
      {openStatus.kind === 'unsupported-version' && (
        <ProjectOpenErrorModal kind='unsupported-version' onRetry={() => undefined} />
      )}
    </div>
  );
};
