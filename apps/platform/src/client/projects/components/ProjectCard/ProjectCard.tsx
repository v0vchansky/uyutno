import { Button } from '@heroui/react';
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

  /**
   * Никакой навигации по карточке — «…» отдельный интерактив, не должен считаться кликом по карточке.
   * Раньше это держалось ручными `preventDefault`/`stopPropagation` на `onClick`; у `Button` HeroUI
   * событие приходит через `onPress`, а тот по умолчанию всплытие уже гасит — продолжить его можно
   * только явным `continuePropagation()` (задача 0097).
   */
  const toggleMenu = (): void => setIsMenuOpen(prev => !prev);

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
          {/*
           * Триггер меню — библиотечный `Button` (задача 0097): заливка, радиус, наведение и кольцо фокуса
           * приезжают из темы, а не воспроизводятся утилитами.
           *
           * **Сенсорная цель не отдаётся шкале.** У `.button--icon-only.button--sm` габарит 36px до 768px и
           * 32px выше, а до 1024px нам нужны 44px — минимальная цель нажатия по `docs/ui/layout.md`. Поэтому
           * `size="sm"` даёт десктопные 32px, а `max-lg:size-11` возвращает 44px ровно на том участке, где
           * карточку трогают пальцем. Утилита лежит в слое `utilities` и перебивает `w-9 md:w-8` из
           * `@layer components`, так что порядок классов роли не играет.
           *
           */}
          <Button
            ref={triggerRef}
            isIconOnly
            size='sm'
            variant='tertiary'
            onPress={toggleMenu}
            aria-label='Действия с проектом'
            aria-haspopup='menu'
            aria-expanded={isMenuOpen}
            className='max-lg:size-11'
          >
            <svg width='16' height='16' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
              <circle cx='12' cy='5' r='1.6' />
              <circle cx='12' cy='12' r='1.6' />
              <circle cx='12' cy='19' r='1.6' />
            </svg>
          </Button>

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
