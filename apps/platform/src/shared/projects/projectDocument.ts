import { z } from 'zod';

/**
 * Форма запроса и ответа пары эндпоинтов документа (ADR 0021, «Хранилище и API»).
 *
 * **Самого конверта здесь нет и быть не может**: формат принадлежит движку, его zod-схема живёт в
 * `@uyutno/planner/format` и остаётся единственным источником правды (ADR 0021, «Почему»). Здесь
 * описана только оболочка транспорта — то, что снаружи документа.
 */

/**
 * Тело `PUT …/document`. `document` намеренно `unknown`: его проверяет `documentSchema` формата уже в
 * `ProjectsManager`, а переписывать конверт в `shared` значило бы завести второй источник правды.
 *
 * `autosave` в v0 на поведение сервера не влияет — он нужен логам и будущему разведению лимитов
 * (ADR 0021); принимаем и не теряем.
 */
export const SaveProjectDocumentRequestSchema = z.object({
  document: z.unknown(),
  autosave: z.boolean().optional(),
});

export type SaveProjectDocumentRequest = z.infer<typeof SaveProjectDocumentRequestSchema>;

/**
 * Ответ `GET …/document`.
 *
 * `document: null` — **не ошибка**: проект создан, но ни разу не сохранён, и клиент поднимает пустой
 * документ сам (`createEmptyDocument`). Ради этой развилки форма и зафиксирована схемой, чтобы клиенту
 * не приходилось гадать, отличается ли «пустой проект» от «проекта нет».
 *
 * Содержимое непустого документа разбирает `parse` из формата, а не эта схема: сервер отдаёт битый
 * документ как есть, чтобы модалку «Не удалось открыть проект» показал клиент (спека 10).
 *
 * `updatedAt` — метка серверного снимка; клиент кладёт её рядом с состоянием.
 */
export const ProjectDocumentResponseSchema = z.object({
  document: z.record(z.string(), z.unknown()).nullable(),
  updatedAt: z.string(),
});

export type ProjectDocumentResponse = z.infer<typeof ProjectDocumentResponseSchema>;

/** Ответ `PUT …/document`: на `updatedAt` стоит будущее предупреждение о конкурентной записи. */
export const SaveProjectDocumentResponseSchema = z.object({
  updatedAt: z.string(),
});

export type SaveProjectDocumentResponse = z.infer<typeof SaveProjectDocumentResponseSchema>;
