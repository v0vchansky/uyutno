import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../common';

export const errorMiddleware = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof AppError) {
    console.info(`[${err.status}] ${req.method} ${req.originalUrl} — ${err.message}`);
    const body: { error: string; code?: string } = { error: err.message };
    if (err.code) body.code = err.code;
    res.status(err.status).json(body);
    return;
  }

  console.error(`[500] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Internal server error' });
};
