import express from 'express';
import type { RequestHandler } from 'express';
import type { IncomingMessage } from 'node:http';

/**
 * Глобальный парсер JSON-тела и **исключения из него** — единственный способ дать отдельному маршруту
 * свой лимит.
 *
 * Ловушка порядка middleware (ADR 0021, «Лимиты»; задача 0080): глобальный `express.json` стоит в
 * `server.ts` до всех роутеров и разбирает тело первым. Повесить на маршрут документа ещё один
 * `express.json({ limit: '2mb' })` **недостаточно** — body-parser не разбирает тело дважды (`req._body`),
 * и роут-локальный парсер молча пропустит уже разобранный запрос. Тело в 3 МБ прошло бы под глобальные
 * 10 МБ, а лимит документа существовал бы только на бумаге.
 *
 * Поэтому пути со своим лимитом исключаются здесь, по `req.url`: маршрут ещё не разобран, `req.params`
 * не существует, и путь — единственное, чем такой запрос можно опознать.
 *
 * Из двух разрешённых задачей способов (смонтировать маршрут до глобального парсера или исключить его
 * по `type`) выбран второй: первый утащил бы маршрут документа выше `cookieParser` и сессии, то есть
 * `requireAuth` на нём перестал бы работать, и роутер проектов пришлось бы разрезать на два монтирования.
 */

export const GLOBAL_JSON_BODY_LIMIT = '10mb';

const JSON_MEDIA_TYPE = 'application/json';

/** Тот же отбор, что у дефолтного `type: 'application/json'` body-parser: media type без параметров. */
const isJsonRequest = (req: IncomingMessage): boolean =>
  ((req.headers['content-type'] ?? '').split(';')[0] ?? '').trim().toLowerCase() === JSON_MEDIA_TYPE;

interface GlobalJsonParserOptions {
  /** Пути со своим лимитом тела: глобальный парсер их не трогает, разбирает роут-локальный. */
  except?: readonly RegExp[];
}

export const createGlobalJsonParser = ({ except = [] }: GlobalJsonParserOptions = {}): RequestHandler =>
  express.json({
    limit: GLOBAL_JSON_BODY_LIMIT,
    type: req => isJsonRequest(req) && !except.some(pattern => pattern.test(req.url ?? '')),
  });
