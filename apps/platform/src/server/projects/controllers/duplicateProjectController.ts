import type { Request, RequestHandler, Response } from 'express';

import { NotFoundError, UnauthorizedError } from '@server/common';

import type { ProjectsManager } from '../managers/ProjectsManager';

export const createDuplicateProjectController =
  (projectsManager: ProjectsManager): RequestHandler =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const id = req.params.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new NotFoundError('Проект не найден');
    }
    const project = await projectsManager.duplicate(req.user.id, id);
    res.status(201).json({ project });
  };
