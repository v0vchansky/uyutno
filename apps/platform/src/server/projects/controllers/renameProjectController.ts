import type { Request, RequestHandler, Response } from 'express';

import { NotFoundError, UnauthorizedError, ValidationError } from '@server/common';

import { RenameProjectRequestSchema } from '../../../shared/projects';
import type { ProjectsManager } from '../managers/ProjectsManager';

export const createRenameProjectController =
  (projectsManager: ProjectsManager): RequestHandler =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const id = req.params.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new NotFoundError('Проект не найден');
    }
    const parsed = RenameProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Неверный формат запроса');
    }

    const project = await projectsManager.rename(req.user.id, id, parsed.data.name);
    res.status(200).json({ project });
  };
