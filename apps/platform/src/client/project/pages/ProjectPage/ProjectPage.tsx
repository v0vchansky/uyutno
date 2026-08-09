import { useParams } from 'react-router';

export const ProjectPage = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <main className='flex min-h-screen items-center justify-center'>
      <h1 className='text-2xl font-semibold'>Проект {id}</h1>
    </main>
  );
};
