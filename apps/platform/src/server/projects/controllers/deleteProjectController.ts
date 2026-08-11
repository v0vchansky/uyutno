import type { Request, RequestHandler, Response } from 'express';

import { NotFoundError, UnauthorizedError } from '@server/common';

import type { ProjectsManager } from '../managers/ProjectsManager';

export const createDeleteProjectController =
  (projectsManager: ProjectsManager): RequestHandler =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const id = req.params.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new NotFoundError('Проект не найден');
    }
    await projectsManager.delete(req.user.id, id);
    res.status(204).end();
  };
