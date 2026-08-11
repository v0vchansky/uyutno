import { Button } from '@heroui/react';
import type React from 'react';
import { Link } from 'react-router';

import { ProjectsEmptyIllustration } from './ProjectsEmptyIllustration';

interface Props {
  onCreate: () => void;
}

/**
 * Пустой список: белая карточка на всю ширину сетки, две кнопки
 * («Создать проект» — открывает модал, «Посмотреть пример» — ведёт на `/demo`).
 */
export const ProjectsEmptyState: React.FC<Props> = ({ onCreate }) => {
  return (
    <div className='flex flex-col items-center gap-6 rounded-3xl bg-[var(--surface)] px-8 py-16 text-center shadow-[var(--surface-shadow)]'>
      <ProjectsEmptyIllustration />
      <div className='flex max-w-[400px] flex-col gap-2'>
        <h2 className='m-0 text-[22px] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]'>
          Здесь пока пусто
        </h2>
        <p className='m-0 text-[14px] leading-[1.5] text-[color:var(--muted)]'>
          Соберите первую планировку — это займёт пять минут.
        </p>
      </div>
      <div className='flex flex-wrap items-center justify-center gap-2'>
        <Button onPress={onCreate} className='h-11'>
          Создать проект
        </Button>
        <Link
          to='/demo'
          className='inline-flex h-11 items-center rounded-xl bg-[var(--surface-secondary)] px-4 text-[14px] font-medium text-[color:var(--foreground)] no-underline transition-colors hover:bg-[var(--surface-tertiary)]'
        >
          Посмотреть пример
        </Link>
      </div>
    </div>
  );
};
