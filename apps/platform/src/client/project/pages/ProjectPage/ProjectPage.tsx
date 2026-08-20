import type React from 'react';
import { useParams } from 'react-router';
import { ConstructorSkin, LengthInputsOverlay, Planner } from '@uyutno/planner';

import { plannerLogger } from '../../lib/plannerLogger';
import { announcePlannerReady } from '../../lib/plannerReadyEvent';

export const ProjectPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  return (
    <>
      <title>{`Проект ${id} — уютно`}</title>
      <meta name='description' content='Планировка квартиры: чертёж, расстановка мебели и просмотр в 3D.' />
      <main className='h-screen w-full bg-[var(--background)]'>
        {/* Скин — дети `<Planner />`: панели живут внутри `PlannerContext` и абсолютом поверх канвасов (ADR 0020 P6). */}
        <Planner projectId={id} logger={plannerLogger} className='block h-full w-full' onReady={announcePlannerReady}>
          {/* Оверлей размеров — ребёнок скина: ему нужен и контейнер с канвасами, и общий контекст скина (0060). */}
          <ConstructorSkin>
            <LengthInputsOverlay />
          </ConstructorSkin>
        </Planner>
      </main>
    </>
  );
};
