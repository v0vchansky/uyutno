import type { Request, RequestHandler, Response } from 'express';

import { NotFoundError, UnauthorizedError } from '@server/common';

import type { ProjectsManager } from '../managers/ProjectsManager';

/**
 * `GET /api/v1/projects/:id` — метаданные одного проекта владельца (задача 0095). Конверт `{ project }` —
 * тот же, что у `POST /` и `PATCH /:id`: это одна и та же карточка, и клиент разбирает её одним типом.
 *
 * В отличие от `GET …/:id/document` запрос **читающий**: ничего не мигрирует и не переписывает, поэтому
 * `Cache-Control: no-store` ему не нужен.
 */
export const createGetProjectController =
  (projectsManager: ProjectsManager): RequestHandler =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const id = req.params.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new NotFoundError('Проект не найден');
    }

    const project = await projectsManager.get(req.user.id, id);

    res.status(200).json({ project });
  };
