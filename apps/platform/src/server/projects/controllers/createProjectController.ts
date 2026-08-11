import type { Request, RequestHandler, Response } from 'express';

import { UnauthorizedError, ValidationError } from '@server/common';

import { CreateProjectRequestSchema } from '../../../shared/projects';
import type { ProjectsManager } from '../managers/ProjectsManager';

export const createCreateProjectController =
  (projectsManager: ProjectsManager): RequestHandler =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const parsed = CreateProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Неверный формат запроса');
    }

    const project = await projectsManager.create(req.user.id, parsed.data.name);
    res.status(201).json({ project });
  };
