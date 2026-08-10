import { Router } from 'express';

import { getMeController } from './controllers/getMeController';
import { requireAuth } from './middleware/requireAuth';

export const createAuthRouter = (): Router => {
  const router = Router();

  router.get('/me', getMeController);
  router.get('/_check', requireAuth('api'), (_req, res) => {
    res.json({ ok: true });
  });

  return router;
};
