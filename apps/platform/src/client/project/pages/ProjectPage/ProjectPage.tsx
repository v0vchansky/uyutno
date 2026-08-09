import type React from 'react';
import { useParams } from 'react-router';

export const ProjectPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <>
      <title>{`Проект ${id ?? ''} — уютно`}</title>
      <meta name='description' content='Планировка квартиры: чертёж, расстановка мебели и просмотр в 3D.' />
      <main className='flex min-h-screen items-center justify-center'>
        <h1 className='text-2xl font-semibold'>Проект {id}</h1>
      </main>
    </>
  );
};
