import type React from 'react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';

import { projectRoute } from '../../../../shared/router/routes';
import type { ProjectDto } from '../../../../shared/projects';
import { formatUpdatedAt } from '../../lib/formatUpdatedAt';
import { ProjectCardMenu } from '../ProjectCardMenu/ProjectCardMenu';
import { ProjectPlaceholder } from '../ProjectPlaceholder/ProjectPlaceholder';

interface Props {
  project: ProjectDto;
  onRename: (project: ProjectDto) => void;
  onDuplicate: (project: ProjectDto) => void;
  onDelete: (project: ProjectDto) => void;
}

/**
 * Карточка проекта в сетке.
 *
 * Ссылки (превью и подпись) ведут на `/project/:id`. Кнопка «…» — отдельный
 * триггер меню действий, вне ссылок, чтобы `<a>` не оборачивал интерактив.
 * Меню (`ProjectCardMenu`) на десктопе — Popover справа под кнопкой,
 * на мобилке — bottom sheet.
 */
export const ProjectCard: React.FC<Props> = ({ project, onRename, onDuplicate, onDelete }) => {
  const updatedLabel = useMemo(() => formatUpdatedAt(project.updatedAt), [project.updatedAt]);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const handleMenuClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    // Никакой навигации по карточке — «…» отдельный интерактив, не должен всплывать
    // до ссылок-детей и не должен считаться кликом по карточке.
    event.preventDefault();
    event.stopPropagation();
    setIsMenuOpen(prev => !prev);
  };

  const closeMenu = (): void => setIsMenuOpen(false);

  const linkTo = projectRoute(project.id);

  return (
    <div className='group relative flex flex-col gap-3 rounded-3xl bg-[var(--surface)] p-3 shadow-[var(--surface-shadow)] transition-shadow hover:shadow-lg focus-within:shadow-lg'>
      <Link
        to={linkTo}
        aria-label={project.name}
        className='block overflow-hidden rounded-xl bg-[var(--background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]'
      >
        <div className='relative aspect-[4/3]'>
          <ProjectPlaceholder className='absolute inset-0 h-full w-full' />
        </div>
      </Link>

      <div className='flex items-center gap-2 pr-1 pl-2 pb-1'>
        <Link
          to={linkTo}
          className='flex min-w-0 flex-1 flex-col gap-0.5 no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] rounded-md'
        >
          <span className='truncate text-[15px] font-medium text-[color:var(--foreground)]'>{project.name}</span>
          <span className='text-[13px] text-[color:var(--muted)]'>{updatedLabel}</span>
        </Link>
        <div className='relative flex-shrink-0'>
          <button
            ref={triggerRef}
            type='button'
            onClick={handleMenuClick}
            aria-label='Действия с проектом'
            aria-haspopup='menu'
            aria-expanded={isMenuOpen}
            className='inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-secondary)] text-[color:var(--foreground)] transition-colors hover:bg-[var(--surface-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] max-lg:h-11 max-lg:w-11'
          >
            <svg width='16' height='16' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
              <circle cx='12' cy='5' r='1.6' />
              <circle cx='12' cy='12' r='1.6' />
              <circle cx='12' cy='19' r='1.6' />
            </svg>
          </button>

          <ProjectCardMenu
            project={project}
            triggerRef={triggerRef}
            isOpen={isMenuOpen}
            onClose={closeMenu}
            onRename={() => {
              closeMenu();
              onRename(project);
            }}
            onDuplicate={() => {
              closeMenu();
              onDuplicate(project);
            }}
            onDelete={() => {
              closeMenu();
              onDelete(project);
            }}
          />
        </div>
      </div>
    </div>
  );
};
