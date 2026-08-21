import { ConstructorSkin, LengthInputsOverlay, Planner, type PlannerInstance } from '@uyutno/planner';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { NotFoundScreen } from '@app/common';

import { EditorShell, type EditorOpenStatus } from '../../components/EditorShell/EditorShell';
import { hasPlan } from '../../hooks/projectOpenState';
import { useProjectOpen } from '../../hooks/useProjectOpen';
import { plannerLogger } from '../../lib/plannerLogger';
import { announcePlannerReady } from '../../lib/plannerReadyEvent';
import { projectStorage } from '../../lib/projectStorage';

interface Props {
  projectId: string;
}

/**
 * Открытие проекта и сборка редактора (задача 0085; спека 10, «Load проекта»).
 *
 * **Порядок кадров держит обещание «полузагруженного редактора не бывает».** Планер монтируется не сразу,
 * а когда документ уже разобран, — и индикатор снимается не в этот момент, а после того, как сцена
 * восстановлена целиком:
 *
 * 1. фазы 1–2 — планера в дереве нет вовсе, значит нет ни канвасов, ни владельца клавиатуры: ввод
 *    физически некуда доставить, а не «выглядит неактивным»;
 * 2. документ разобран → монтируется `<Planner />` **сразу в конечную геометрию рамки** (иначе `fitToContent`
 *    считал бы по кадру на 16px шире), но индикатор всё ещё поверх — планер поднимается только в эффекте;
 * 3. `onReady` заменяет документ движка и отдаёт сюда экземпляр: следующий кадр — тот, где `<Planner />`
 *    впервые рисует скин, а индикатор уходит;
 * 4. эффект ниже относится к тому же кадру и идёт **после** эффекта скина, потому что React зовёт эффекты
 *    снизу вверх: к этому моменту скин уже сообщил камере полосы под панелями (`setViewportInsets`), и fit
 *    вписывает план до того, как кадр окажется на экране.
 *
 * Восстановление вида и камер отдельного кода не требует: `activeView` и камеры `plan`/`orbit`/`walk` лежат
 * в самом документе (ADR 0016 B7), и `document.load` поднимает их вместе с ним. Исключение — камера
 * конструктора: в документ она не пишется (ADR 0020), поэтому её и ставит авто-fit.
 */
export const ProjectEditor: React.FC<Props> = ({ projectId }) => {
  const { state, retry } = useProjectOpen(projectId);

  /**
   * Поднятый планер — он же признак «сцена восстановлена»: значение появляется в `onReady`, то есть уже
   * после `document.load`, а кадр, в котором оно доезжает до разметки, — тот самый, где `<Planner />`
   * впервые показывает скин. Отдельного флага «готово» не заводим: он был бы вторым состоянием об одном
   * и том же факте и стоил бы лишнего рендера.
   */
  const [planner, setPlanner] = useState<PlannerInstance | null>(null);

  const document = state.kind === 'open' ? state.document : null;

  /**
   * Документ заезжает в движок здесь, а не пропом: `<Planner />` поднимает планер сам и отдаёт результат
   * фабрики ровно один раз. Колбэк читается при монтировании, поэтому к этому моменту он уже замкнут на
   * разобранный документ.
   */
  const handleReady = useCallback(
    (instance: PlannerInstance): void => {
      announcePlannerReady?.(instance);
      if (document) {
        const loaded = instance.manager.document.load(document);
        // Формат уже проверен `parse`, поэтому отказ здесь — расхождение схемы с движком, а не битый проект.
        if (!loaded.ok) plannerLogger.error('не удалось поднять документ проекта в движок', loaded.error);
      }
      setPlanner(instance);
    },
    [document],
  );

  useEffect(() => {
    if (!planner) return;
    // Пустому плану вписывать нечего — он остаётся на дефолтном зуме (ADR 0021, «Камера при открытии»).
    if (hasPlan(document)) planner.projections.canvas2d.fitToContent();
  }, [planner, document]);

  if (state.kind === 'not-found') return <NotFoundScreen />;

  const openStatus: EditorOpenStatus =
    state.kind === 'loading'
      ? { kind: 'loading', phase: state.phase }
      : state.kind === 'failed'
        ? { kind: 'failed', onRetry: retry }
        : state.kind === 'unsupported-version'
          ? { kind: 'unsupported-version' }
          : // Документ есть, но планер ещё не поднят — вторая фаза не кончилась (спека 10).
            planner
            ? { kind: 'ready' }
            : { kind: 'loading', phase: 2 };

  return (
    <>
      <title>{`Проект ${projectId} — уютно`}</title>
      <meta name='description' content='Планировка квартиры: чертёж, расстановка мебели и просмотр в 3D.' />
      {/* Шапка, рамка холста, порог 1024px и экран открытия — у оболочки; страница только собирает планер. */}
      <EditorShell projectId={projectId} openStatus={openStatus}>
        {state.kind === 'open' && (
          /* Скин — дети `<Planner />`: панели живут внутри `PlannerContext` и абсолютом поверх канвасов (ADR 0020 P6). */
          <Planner
            projectId={projectId}
            logger={plannerLogger}
            storage={projectStorage}
            className='block h-full w-full'
            onReady={handleReady}
          >
            {/* Оверлей размеров — ребёнок скина: ему нужен и контейнер с канвасами, и общий контекст скина (0060). */}
            <ConstructorSkin>
              <LengthInputsOverlay />
            </ConstructorSkin>
          </Planner>
        )}
      </EditorShell>
    </>
  );
};
