import express, { Router } from 'express';

import { requireAuth } from '@server/auth';

import { PROJECT_DOCUMENT_BODY_LIMIT } from '../../shared/projects';
import { createCreateProjectController } from './controllers/createProjectController';
import { createDeleteProjectController } from './controllers/deleteProjectController';
import { createDuplicateProjectController } from './controllers/duplicateProjectController';
import { createGetProjectDocumentController } from './controllers/getProjectDocumentController';
import { createListProjectsController } from './controllers/listProjectsController';
import { createRenameProjectController } from './controllers/renameProjectController';
import { createUpdateProjectDocumentController } from './controllers/updateProjectDocumentController';
import type { ProjectsManager } from './managers/ProjectsManager';
import {
  createCreateProjectIpRateLimit,
  createCreateProjectUserRateLimit,
  createDocumentReadRateLimit,
  createDocumentWriteRateLimit,
} from './middleware/projectsRateLimit';

interface ProjectsRouterDeps {
  projectsManager: ProjectsManager;
}

export const createProjectsRouter = ({ projectsManager }: ProjectsRouterDeps): Router => {
  const router = Router();

  router.get('/', requireAuth('api'), createListProjectsController(projectsManager));
  router.post(
    '/',
    requireAuth('api'),
    createCreateProjectIpRateLimit(),
    createCreateProjectUserRateLimit(),
    createCreateProjectController(projectsManager),
  );
  router.patch('/:id', requireAuth('api'), createRenameProjectController(projectsManager));
  router.post('/:id/duplicate', requireAuth('api'), createDuplicateProjectController(projectsManager));
  router.delete('/:id', requireAuth('api'), createDeleteProjectController(projectsManager));

  router.get(
    '/:id/document',
    requireAuth('api'),
    createDocumentReadRateLimit(),
    createGetProjectDocumentController(projectsManager),
  );
  /**
   * Свой парсер на 2 МБ вместо глобальных 10 МБ. Он срабатывает только потому, что глобальный
   * `express.json` этот путь пропускает (`createGlobalJsonParser({ except })` в `server.ts`): body-parser
   * не разбирает тело дважды, и без исключения роут-локальный лимит молча не действовал бы.
   *
   * Порядок «рейт-лимит → парсер» намеренный: превысившему лимит незачем вычитывать мегабайты тела.
   */
  router.put(
    '/:id/document',
    requireAuth('api'),
    createDocumentWriteRateLimit(),
    express.json({ limit: PROJECT_DOCUMENT_BODY_LIMIT }),
    createUpdateProjectDocumentController(projectsManager),
  );

  return router;
};
