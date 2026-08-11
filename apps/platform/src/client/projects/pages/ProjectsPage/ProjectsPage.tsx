import { Button } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useState } from 'react';

import { PublicLayout } from '@app/common';

import type { ProjectDto } from '../../../../shared/projects';
import { duplicateProject } from '../../api/duplicateProject';
import { getProjects } from '../../api/getProjects';
import { PROJECTS_QUERY_KEY } from '../../api/projectsQueryKeys';
import { DeleteProjectModal } from '../../components/DeleteProjectModal/DeleteProjectModal';
import { NewProjectModal } from '../../components/NewProjectModal/NewProjectModal';
import { NewProjectTile } from '../../components/NewProjectTile/NewProjectTile';
import { ProjectCard } from '../../components/ProjectCard/ProjectCard';
import { ProjectsEmptyState } from '../../components/ProjectsEmptyState/ProjectsEmptyState';
import { ProjectsErrorState } from '../../components/ProjectsErrorState/ProjectsErrorState';
import { ProjectsGrid } from '../../components/ProjectsGrid/ProjectsGrid';
import { ProjectsSkeleton } from '../../components/ProjectsSkeleton/ProjectsSkeleton';
import { RenameProjectModal } from '../../components/RenameProjectModal/RenameProjectModal';
import { pluralizeProjects } from '../../lib/pluralizeProjects';

const PlusIcon: React.FC = () => (
  <svg
    width='16'
    height='16'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.5'
    strokeLinecap='round'
    aria-hidden='true'
  >
    <path d='M12 5v14M5 12h14' />
  </svg>
);

export const ProjectsPage: React.FC = () => {
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ProjectDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectDto | null>(null);

  const query = useQuery<ProjectDto[]>({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: getProjects,
  });

  // «Дублировать» — сразу шлём POST и инвалидируем список. Модалов и подтверждений нет.
  // Ошибка — `console.error` и no-op: в v0 достаточно (см. спеку 0039).
  const duplicateMutation = useMutation({
    mutationFn: duplicateProject,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
    },
    onError: error => {
      console.error('[projects] duplicate failed', error);
    },
  });

  const projects = query.data ?? [];
  const isEmpty = query.isSuccess && projects.length === 0;
  const isLoading = query.isLoading;
  const isError = query.isError;

  const openCreate = (): void => setIsCreateOpen(true);
  const handleRename = (project: ProjectDto): void => setRenameTarget(project);
  const handleDelete = (project: ProjectDto): void => setDeleteTarget(project);
  const handleDuplicate = (project: ProjectDto): void => {
    duplicateMutation.mutate(project.id);
  };

  return (
    <>
      <title>Проекты — уютно</title>
      <meta name='description' content='Ваши планировки в одном месте.' />
      <PublicLayout mode='app'>
        <div className='mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 py-8 max-lg:max-w-[560px] lg:px-8'>
          <header className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
            <div className='flex flex-col gap-1'>
              <h1 className='m-0 text-[28px] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]'>
                Проекты
              </h1>
              {isLoading ? (
                <div className='uyutno-skeleton h-3 w-24 rounded-md' />
              ) : (
                <p className='m-0 text-[13px] text-[color:var(--muted)]'>{pluralizeProjects(projects.length)}</p>
              )}
            </div>

            {isLoading ? (
              <div className='uyutno-skeleton h-10 w-[140px] rounded-xl max-lg:h-11 max-lg:w-full' />
            ) : (
              <Button
                type='button'
                onPress={openCreate}
                className='h-10 gap-2 self-start max-lg:h-11 max-lg:w-full max-lg:self-stretch'
              >
                <PlusIcon />
                Создать проект
              </Button>
            )}
          </header>

          {isLoading ? <ProjectsSkeleton /> : null}

          {isError ? <ProjectsErrorState onRetry={() => void query.refetch()} /> : null}

          {isEmpty ? <ProjectsEmptyState onCreate={openCreate} /> : null}

          {!isLoading && !isError && !isEmpty ? (
            <ProjectsGrid>
              {projects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onRename={handleRename}
                  onDuplicate={handleDuplicate}
                  onDelete={handleDelete}
                />
              ))}
              <NewProjectTile onClick={openCreate} />
            </ProjectsGrid>
          ) : null}
        </div>

        <NewProjectModal isOpen={isCreateOpen} onOpenChange={setIsCreateOpen} />
        <RenameProjectModal
          project={renameTarget}
          isOpen={renameTarget !== null}
          onOpenChange={open => {
            if (!open) setRenameTarget(null);
          }}
        />
        <DeleteProjectModal
          project={deleteTarget}
          isOpen={deleteTarget !== null}
          onOpenChange={open => {
            if (!open) setDeleteTarget(null);
          }}
        />
      </PublicLayout>
    </>
  );
};
