import type { Request, RequestHandler, Response } from 'express';

import { UnauthorizedError } from '@server/common';

import type { ProjectsManager } from '../managers/ProjectsManager';

export const createListProjectsController =
  (projectsManager: ProjectsManager): RequestHandler =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const projects = await projectsManager.list(req.user.id);
    res.status(200).json({ projects });
  };
