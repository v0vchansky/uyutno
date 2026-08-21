import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { getProjects, PROJECTS_QUERY_KEY } from '@app/projects';

import type { ProjectDto } from '../../../shared/projects';
import { getProjectDocument, projectDocumentQueryKey } from '../api/getProjectDocument';
import { projectOpenState, type ProjectOpenState } from './projectOpenState';

export interface ProjectOpen {
  state: ProjectOpenState;
  /** «Попробовать ещё раз» из модалки отказа: повторяет ту фазу, на которой всё встало. */
  retry: () => void;
}

/**
 * Две фазы открытия проекта (ADR 0021, «Хранилище и API»; спека 10, «Load проекта»):
 *
 * 1. **карточка проекта** — лёгкий запрос, он же отвечает, существует ли проект и ваш ли он;
 * 2. **документ** — `GET …/:id/document` плюс разбор формата.
 *
 * Карточка берётся из списка проектов тем же ключом кеша, что и шапка редактора: ручки «один проект» в
 * API нет (`src/server/projects/router.ts`), а общий ключ означает **один** запрос на обе цели и имя
 * проекта в шапке без второго похода на сервер. Побочный эффект — вместо 404 от сервера признаком
 * «проекта нет» служит его отсутствие в галерее пользователя; для v0 это то же множество: чужие проекты
 * в список не попадают.
 *
 * Документ намеренно не протухает и не перезапрашивается сам: любой фоновый рефетч вернул бы индикатор
 * загрузки поверх работающего редактора и затёр бы несохранённые правки при `document.load`. Единственный
 * повторный запрос — явный `retry()`.
 */
export const useProjectOpen = (projectId: string): ProjectOpen => {
  const card = useQuery<ProjectDto[]>({ queryKey: PROJECTS_QUERY_KEY, queryFn: getProjects });
  const project = card.data?.find(item => item.id === projectId);

  const document = useQuery({
    queryKey: projectDocumentQueryKey(projectId),
    queryFn: () => getProjectDocument(projectId),
    enabled: project !== undefined,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Ветки отказа `getProjectDocument` возвращает значением, а не исключением: ретраить нечего.
    retry: false,
  });

  const cardRefetch = card.refetch;
  const documentRefetch = document.refetch;
  const isCardBroken = card.isError && card.data === undefined;

  const retry = useCallback((): void => {
    // Отвалилась карточка — повторяем её: документ включится сам, как только проект найдётся.
    void (isCardBroken ? cardRefetch() : documentRefetch());
  }, [isCardBroken, cardRefetch, documentRefetch]);

  return {
    state: projectOpenState({
      card: { isPending: card.isPending, isError: isCardBroken, project },
      document: { isFetching: document.isFetching, isError: document.isError, result: document.data },
    }),
    retry,
  };
};
