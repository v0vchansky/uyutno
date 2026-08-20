import type { Request, RequestHandler, Response } from 'express';

import { NotFoundError, UnauthorizedError, ValidationError } from '@server/common';

import { SaveProjectDocumentRequestSchema } from '../../../shared/projects';
import type { ProjectsManager } from '../managers/ProjectsManager';

/**
 * `PUT /api/v1/projects/:id/document` — документ целиком, last-write-wins без предупреждения (ADR 0021).
 * Сам конверт проверяет `ProjectsManager` схемой формата; здесь — только оболочка тела.
 */
export const createUpdateProjectDocumentController =
  (projectsManager: ProjectsManager): RequestHandler =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const id = req.params.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new NotFoundError('Проект не найден');
    }
    const parsed = SaveProjectDocumentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Неверный формат запроса');
    }

    const payload = await projectsManager.saveDocument(req.user.id, id, parsed.data.document, {
      autosave: parsed.data.autosave ?? false,
    });

    res.status(200).json(payload);
  };
