import type React from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router';

import { projectRoute } from '../../../../shared/router/routes';
import type { ProjectDto } from '../../../../shared/projects';
import { formatUpdatedAt } from '../../lib/formatUpdatedAt';
import { ProjectPlaceholder } from '../ProjectPlaceholder/ProjectPlaceholder';

interface Props {
  project: ProjectDto;
  onOpenMenu?: (projectId: string) => void;
}

/**
 * Карточка проекта в сетке. Внешняя обёртка — ссылка на редактор.
 * Кнопка «…» в этой итерации — заглушка: обработчик вызывается через
 * `preventDefault + stopPropagation`, чтобы не всплывало до ссылки.
 * Само меню появится в задаче 0039.
 */
export const ProjectCard: React.FC<Props> = ({ project, onOpenMenu }) => {
  const updatedLabel = useMemo(() => formatUpdatedAt(project.updatedAt), [project.updatedAt]);

  const handleMenuClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    onOpenMenu?.(project.id);
  };

  return (
    <Link
      to={projectRoute(project.id)}
      aria-label={project.name}
      className='group flex flex-col gap-3 rounded-3xl bg-[var(--surface)] p-3 no-underline shadow-[var(--surface-shadow)] transition-shadow hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]'
    >
      <div className='relative aspect-[4/3] overflow-hidden rounded-xl bg-[var(--background)]'>
        <ProjectPlaceholder className='absolute inset-0 h-full w-full' />
      </div>

      <div className='flex items-center gap-2 pr-1 pl-2 pb-1'>
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <span className='truncate text-[15px] font-medium text-[color:var(--foreground)]'>{project.name}</span>
          <span className='text-[13px] text-[color:var(--muted)]'>{updatedLabel}</span>
        </div>
        <button
          type='button'
          onClick={handleMenuClick}
          aria-label='Действия с проектом'
          disabled={!onOpenMenu}
          className='inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--surface-secondary)] text-[color:var(--foreground)] transition-colors hover:bg-[var(--surface-tertiary)] disabled:cursor-not-allowed disabled:opacity-60 lg:h-8 lg:w-8 max-lg:h-11 max-lg:w-11'
        >
          <svg width='16' height='16' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
            <circle cx='12' cy='5' r='1.6' />
            <circle cx='12' cy='12' r='1.6' />
            <circle cx='12' cy='19' r='1.6' />
          </svg>
        </button>
      </div>
    </Link>
  );
};
