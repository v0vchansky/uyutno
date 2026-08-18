import type React from 'react';
import { useParams } from 'react-router';
import { Planner } from '@uyutno/planner';

import { plannerLogger } from '../../lib/plannerLogger';
import { announcePlannerReady } from '../../lib/plannerReadyEvent';

export const ProjectPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  return (
    <>
      <title>{`Проект ${id} — уютно`}</title>
      <meta name='description' content='Планировка квартиры: чертёж, расстановка мебели и просмотр в 3D.' />
      <main className='h-screen w-full'>
        <Planner projectId={id} logger={plannerLogger} className='block h-full w-full' onReady={announcePlannerReady} />
      </main>
    </>
  );
};
