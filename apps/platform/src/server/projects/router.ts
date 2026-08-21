import express, { Router } from 'express';

import { requireAuth } from '@server/auth';

import { PROJECT_DOCUMENT_BODY_LIMIT } from '../../shared/projects';
import { createCreateProjectController } from './controllers/createProjectController';
import { createDeleteProjectController } from './controllers/deleteProjectController';
import { createDuplicateProjectController } from './controllers/duplicateProjectController';
import { createGetProjectController } from './controllers/getProjectController';
import { createGetProjectDocumentController } from './controllers/getProjectDocumentController';
import { createListProjectsController } from './controllers/listProjectsController';
import { createRenameProjectController } from './controllers/renameProjectController';
import { createUpdateProjectDocumentController } from './controllers/updateProjectDocumentController';
import type { ProjectsManager } from './managers/ProjectsManager';
import {
  createCreateProjectIpRateLimit,
  createCreateProjectUserRateLimit,
  createDocumentWriteRateLimit,
  createProjectReadRateLimit,
} from './middleware/projectsRateLimit';

interface ProjectsRouterDeps {
  projectsManager: ProjectsManager;
}

export const createProjectsRouter = ({ projectsManager }: ProjectsRouterDeps): Router => {
  const router = Router();

  /**
   * Оба маршрута создают проект, поэтому висят на **одних и тех же экземплярах** лимитеров, а не на двух
   * парах с одинаковыми числами (задача 0087): счётчик живёт в замыкании `rateLimit`, и отдельный
   * экземпляр под `duplicate` удваивал бы разрешённое число созданий в час.
   */
  const createProjectIpRateLimit = createCreateProjectIpRateLimit();
  const createProjectUserRateLimit = createCreateProjectUserRateLimit();

  /**
   * Карточка и документ — две фазы одного действия «открыть проект» (задача 0095), поэтому счётчик у них
   * **один экземпляр** ровно по той же причине, что у создания выше.
   */
  const projectReadRateLimit = createProjectReadRateLimit();

  router.get('/', requireAuth('api'), createListProjectsController(projectsManager));
  router.post(
    '/',
    requireAuth('api'),
    createProjectIpRateLimit,
    createProjectUserRateLimit,
    createCreateProjectController(projectsManager),
  );
  /** Лёгкая карточка одного проекта: без документа и превью (ADR 0021, «Хранилище и API»). */
  router.get('/:id', requireAuth('api'), projectReadRateLimit, createGetProjectController(projectsManager));
  router.patch('/:id', requireAuth('api'), createRenameProjectController(projectsManager));
  router.post(
    '/:id/duplicate',
    requireAuth('api'),
    createProjectIpRateLimit,
    createProjectUserRateLimit,
    createDuplicateProjectController(projectsManager),
  );
  router.delete('/:id', requireAuth('api'), createDeleteProjectController(projectsManager));

  router.get(
    '/:id/document',
    requireAuth('api'),
    projectReadRateLimit,
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
