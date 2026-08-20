import type React from 'react';

import { useEditorViewportFit } from '../../hooks/useEditorViewportFit';
import { DesktopOnlyScreen } from './DesktopOnlyScreen';
import { EditorHeader } from './EditorHeader';

interface Props {
  projectId: string;
  /**
   * Планер со скином. Ниже порога 1024px **не рендерится вовсе**: элемент создан, но в дерево не попадает,
   * поэтому ни канвасов, ни WebGL-контекста на телефоне не появляется.
   */
  children: React.ReactNode;
  /** Прокидывается в кнопку «Сохранить»; пока не передан — кнопка `disabled` (логика — задачи 0082/0084). */
  onSave?: () => void;
  /** Слот индикатора сохранения в шапке; каркас держит место, содержимое приносит задача 0084. */
  saveStatus?: React.ReactNode;
}

/**
 * Каркас оболочки редактора (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Каркас» P0 и «Оболочка
 * редактора (P1)»; прототип `Planner Editor Shell.dc.html`, кадры `s0`–`s2`).
 *
 * Фон страницы `--background`, сверху шапка 48px, под ней строка с холстом: внешний отступ 8px, радиус 12px,
 * рамка 1px `--border`, внутри белая область. Оверлеи скина (панель инструментов, контролы холста, полоса
 * подсказки, место под сводку) позиционируются абсолютом **внутри контейнера планера**, поэтому их отступы 12px
 * по-прежнему считаются от края холста, а не окна: рамка их не сдвигает и не перекрывает.
 *
 * **Известное расхождение с макетом, требующее правки в пакете планера.** В макете рейл 60px стоит слева
 * **снаружи** рамки, а внутрь неё попадает только холст. Рейл рисует `ConstructorSkin` абсолютом внутри
 * контейнера `<Planner />` (`packages/planner/src/ui/ConstructorSkin/ConstructorSkin.tsx`), а канвасы занимают
 * этот контейнер целиком (`inset: 0`) — то есть отделить рейл от холста можно только внутри пакета. Пока рамка
 * охватывает контейнер целиком: числа (8/12/1px) и взаимное положение оверлеев верны, снаружи рамки остаётся
 * не рейл, а край окна. Вернуть рейл наружу — задача правки пакета, а не платформы.
 *
 * Логики сохранения здесь нет ни строки: каркас не читает `persistence`, не ходит в `…/document` и про формат
 * не знает (задачи 0081–0084).
 */
export const EditorShell: React.FC<Props> = ({ projectId, children, onSave, saveStatus }) => {
  const fit = useEditorViewportFit();

  if (fit === 'too-narrow') return <DesktopOnlyScreen />;

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden bg-[var(--background)] text-[color:var(--foreground)]'>
      <EditorHeader projectId={projectId} onSave={onSave} saveStatus={saveStatus} />

      <main className='flex min-h-0 flex-1'>
        <div className='relative m-2 min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]'>
          {fit === 'fits' ? children : null}
        </div>
      </main>
    </div>
  );
};
