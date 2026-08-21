import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

import { TooManyRequestsError } from '@server/common';

/**
 * Рейт-лимиты проектов (ADR 0021, «Лимиты»: квоты на число проектов нет — вместо неё рейт-лимит).
 * Числа назначены задачей 0080:
 *
 * | Маршрут                       | Окно    | Лимит | Ключ         | Откуда число                                        |
 * | ----------------------------- | ------- | ----- | ------------ | --------------------------------------------------- |
 * | `PUT …/:id/document`          | 10 мин  | 60    | пользователь | автосейв даёт 10 за окно; запас ×6 на ручные Save   |
 * | `GET …/:id` + `GET …/document`| 10 мин  | 240   | пользователь | открытие проекта — единичное действие, но два запроса |
 * | `POST /projects`              | 1 час   | 60    | пользователь | создание проектов редкое; «Save As» укладывается    |
 * | `POST /projects`              | 1 час   | 120   | IP           | второй контур от массового создания с одного адреса |
 *
 * `POST /:id/duplicate` тоже создаёт проект и потому делит **тот же экземпляр** лимитера создания, а не
 * получает свой с теми же числами (задача 0087) — иначе разрешённое число созданий в час удваивалось бы.
 *
 * По той же причине `GET /:id` (карточка) и `GET /:id/document` висят на **одном** экземпляре лимитера
 * чтения (задача 0095): это две фазы одного действия «открыть проект», и считать их порознь значило бы
 * выдать за то же действие вдвое больший бюджет. Обратная сторона общего счётчика — одно открытие теперь
 * тратит из окна **два** запроса вместо одного, поэтому число поднято со 120 до 240: назначалось-то оно
 * как «120 открытий за 10 минут», и потолок самого действия обязан остаться прежним.
 *
 * **Фабрики, а не синглтоны** (в отличие от `auth/middleware/loginRateLimit.ts`): счётчики живут в
 * замыкании `rateLimit`, поэтому синглтон означал бы общий счётчик на все экземпляры роутера — включая
 * тестовые приложения, которые тогда протекали бы друг в друга. Роутер и так собирается фабрикой.
 */

const DOCUMENT_WINDOW_MS = 10 * 60 * 1000;
const CREATE_PROJECT_WINDOW_MS = 60 * 60 * 1000;

/** Общий бюджет чтения проекта: карточка + документ, два запроса на одно открытие. */
export const PROJECT_READ_LIMIT = 240;
export const DOCUMENT_WRITE_LIMIT = 60;
export const CREATE_PROJECT_USER_LIMIT = 60;
export const CREATE_PROJECT_IP_LIMIT = 120;

const RATE_LIMITED_MESSAGE = 'Слишком много запросов, попробуйте позже';

const denyHandler: RequestHandler = (_req, _res, next) => {
  next(new TooManyRequestsError(RATE_LIMITED_MESSAGE));
};

/**
 * Ключ — id пользователя (`requireAuth` его гарантирует), фолбэк на IP — как в `loginEmailRateLimit`.
 * `ipKeyGenerator` обязателен: он сворачивает IPv6 в /64, иначе лимит обходится сменой адреса внутри
 * одной подсети (и `express-rate-limit` про это ругается валидатором).
 */
const userKey = (req: Request): string => (req.user ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip ?? '')}`);

const ipKey = (req: Request): string => ipKeyGenerator(req.ip ?? '');

export const createProjectReadRateLimit = (): RequestHandler =>
  rateLimit({
    windowMs: DOCUMENT_WINDOW_MS,
    limit: PROJECT_READ_LIMIT,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: userKey,
    handler: denyHandler,
  });

export const createDocumentWriteRateLimit = (): RequestHandler =>
  rateLimit({
    windowMs: DOCUMENT_WINDOW_MS,
    limit: DOCUMENT_WRITE_LIMIT,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: userKey,
    handler: denyHandler,
  });

export const createCreateProjectUserRateLimit = (): RequestHandler =>
  rateLimit({
    windowMs: CREATE_PROJECT_WINDOW_MS,
    limit: CREATE_PROJECT_USER_LIMIT,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: userKey,
    handler: denyHandler,
  });

export const createCreateProjectIpRateLimit = (): RequestHandler =>
  rateLimit({
    windowMs: CREATE_PROJECT_WINDOW_MS,
    limit: CREATE_PROJECT_IP_LIMIT,
    // Заголовки ставит только первый контур — иначе второй перетирает чужие цифры (как в `loginRateLimit`).
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: ipKey,
    handler: denyHandler,
  });
