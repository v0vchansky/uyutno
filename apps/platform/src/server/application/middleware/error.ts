import type { NextFunction, Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';

import { AppError } from '../../common';

const INTERNAL_ERROR_MESSAGE = 'Internal server error';

interface ErrorBody {
  error: string;
  code?: string;
}

/**
 * Статус ошибки, которую породил не наш код, а Express и его обвязка: `express.json` бросает объекты
 * `http-errors` (`entity.too.large` → 413, `entity.parse.failed` → 400) со статусом в `status`/`statusCode`.
 * Без этого разбора такая ошибка сводилась к 500, и клиент не мог отличить «прислал слишком много»
 * от «упал сервер».
 */
const resolveHttpStatus = (err: unknown): number | undefined => {
  if (typeof err !== 'object' || err === null) return undefined;

  const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
  const value = typeof status === 'number' ? status : statusCode;

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 400 || value > 599) return undefined;

  return value;
};

/**
 * Сообщение отдаём наружу только когда ошибка сама себя объявила безопасной: у `http-errors` это `expose`,
 * и он true ровно для 4xx (это текст про запрос клиента). Для 5xx и для всего сомнительного — сухая строка
 * по статусу, детали уходят только в лог.
 */
const resolveHttpMessage = (err: unknown, status: number): string => {
  const { expose, message } = err as { expose?: unknown; message?: unknown };

  if (expose === true && typeof message === 'string' && message !== '') return message;

  return STATUS_CODES[status] ?? INTERNAL_ERROR_MESSAGE;
};

export const errorMiddleware = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  const status = err instanceof AppError ? err.status : resolveHttpStatus(err);

  if (status === undefined) {
    console.error(`[500] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
    return;
  }

  const body: ErrorBody = { error: err instanceof AppError ? err.message : resolveHttpMessage(err, status) };
  if (err instanceof AppError && err.code) body.code = err.code;

  if (status >= 500) {
    console.error(`[${status}] ${req.method} ${req.originalUrl}`, err);
  } else {
    console.info(`[${status}] ${req.method} ${req.originalUrl} — ${body.error}`);
  }

  res.status(status).json(body);
};
