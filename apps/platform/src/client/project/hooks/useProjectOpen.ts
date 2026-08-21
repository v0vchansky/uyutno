import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { projectQueryKey } from '@app/projects';

import { getProject } from '../api/getProject';
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
 * 1. **карточка проекта** — `GET …/:id`, лёгкий запрос без документа и превью; он же отвечает,
 *    существует ли проект и ваш ли он;
 * 2. **документ** — `GET …/:id/document` плюс разбор формата.
 *
 * До задачи 0095 карточка добывалась из **списка всех проектов пользователя**: ручки «один проект» в API
 * не было, и клиент грузил галерею целиком, чтобы найти в ней одно имя, а признаком «проекта нет» служило
 * отсутствие строки в этом списке. Теперь «нет» — честный 404 от сервера про этот конкретный id, и
 * открытие одного проекта больше не зависит от размера библиотеки планов.
 *
 * Связь с галереей при этом сохранена ключом кеша: `projectQueryKey` — потомок `PROJECTS_QUERY_KEY`,
 * react-query сопоставляет по префиксу, поэтому переименование инвалидирует карточку заодно со списком
 * (см. `client/projects/api/projectsQueryKeys.ts`).
 *
 * Документ намеренно не протухает и не перезапрашивается сам: любой фоновый рефетч вернул бы индикатор
 * загрузки поверх работающего редактора и затёр бы несохранённые правки при `document.load`. Единственный
 * повторный запрос — явный `retry()`.
 */
export const useProjectOpen = (projectId: string): ProjectOpen => {
  /** `null` в `data` — 404 от сервера, `undefined` — ответа ещё нет; ветки разные (см. `projectOpenState`). */
  const card = useQuery({
    queryKey: projectQueryKey(projectId),
    queryFn: () => getProject(projectId),
    /**
     * Та же дисциплина, что у документа ниже, и по родственной причине. Карточка — часть открытия
     * проекта, а не живая подписка на имя: фоновый рефетч на возврате фокуса во вкладку ничего на экране
     * не меняет, зато тратит бюджет рейт-лимита, общий у неё с документом (`projectsRateLimit.ts`), —
     * одно открытие обязано стоить ровно два запроса.
     *
     * Переименование это не ломает: `invalidateQueries` перечитывает **активные** запросы независимо от
     * `staleTime`, поэтому имя в шапке обновляется сразу после `PATCH`.
     */
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const project = card.data ?? undefined;

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
