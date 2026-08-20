import type { Request, RequestHandler, Response } from 'express';

import { NotFoundError, UnauthorizedError } from '@server/common';

import type { ProjectsManager } from '../managers/ProjectsManager';

/**
 * `GET /api/v1/projects/:id/document` — **пишущий запрос**: он мигрирует документ и перезаписывает
 * колонку (ADR 0021). Отсюда `Cache-Control: no-store` — кешировать его нельзя ни на одном уровне.
 */
export const createGetProjectDocumentController =
  (projectsManager: ProjectsManager): RequestHandler =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const id = req.params.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new NotFoundError('Проект не найден');
    }

    const payload = await projectsManager.getDocument(req.user.id, id);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(payload);
  };
