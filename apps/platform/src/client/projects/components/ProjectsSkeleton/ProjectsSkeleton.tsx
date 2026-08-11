import type React from 'react';

import { ProjectsGrid } from '../ProjectsGrid/ProjectsGrid';

const SKELETON_COUNT = 4;

const SkeletonCard: React.FC = () => (
  <div className='flex flex-col gap-3 rounded-3xl bg-[var(--surface)] p-3 shadow-[var(--surface-shadow)]'>
    <div className='uyutno-skeleton aspect-[4/3] w-full rounded-xl' />
    <div className='flex flex-col gap-1.5 px-1 pb-1'>
      <div className='uyutno-skeleton h-3 w-3/5 rounded-md' />
      <div className='uyutno-skeleton h-2.5 w-2/5 rounded-md' />
    </div>
  </div>
);

/**
 * Состояние «Загрузка». 4 скелетон-карточки в сетке с той же геометрией,
 * что реальные карточки. Заголовок и шапка контента отрисованы страницей
 * сразу, здесь только сетка.
 */
export const ProjectsSkeleton: React.FC = () => {
  return (
    <ProjectsGrid>
      {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </ProjectsGrid>
  );
};
