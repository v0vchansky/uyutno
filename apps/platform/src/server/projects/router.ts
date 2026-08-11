import { Router } from 'express';

import { requireAuth } from '@server/auth';

import { createCreateProjectController } from './controllers/createProjectController';
import { createDeleteProjectController } from './controllers/deleteProjectController';
import { createDuplicateProjectController } from './controllers/duplicateProjectController';
import { createListProjectsController } from './controllers/listProjectsController';
import { createRenameProjectController } from './controllers/renameProjectController';
import type { ProjectsManager } from './managers/ProjectsManager';

interface ProjectsRouterDeps {
  projectsManager: ProjectsManager;
}

export const createProjectsRouter = ({ projectsManager }: ProjectsRouterDeps): Router => {
  const router = Router();

  router.get('/', requireAuth('api'), createListProjectsController(projectsManager));
  router.post('/', requireAuth('api'), createCreateProjectController(projectsManager));
  router.patch('/:id', requireAuth('api'), createRenameProjectController(projectsManager));
  router.post('/:id/duplicate', requireAuth('api'), createDuplicateProjectController(projectsManager));
  router.delete('/:id', requireAuth('api'), createDeleteProjectController(projectsManager));

  return router;
};
