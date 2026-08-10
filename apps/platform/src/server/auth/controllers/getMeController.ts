import type { Request, Response } from 'express';

export const getMeController = (req: Request, res: Response): void => {
  res.json({ user: req.user });
};
