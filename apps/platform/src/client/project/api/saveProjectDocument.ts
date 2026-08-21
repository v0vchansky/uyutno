import { api } from '@app/common';
import type { PlannerDocument } from '@uyutno/planner/format';

import {
  projectDocumentApiPath,
  SaveProjectDocumentResponseSchema,
  type SaveProjectDocumentRequest,
  type SaveProjectDocumentResponse,
} from '../../../shared/projects';

/**
 * Запись документа целиком (ADR 0021, «Хранилище и API»): `PUT /api/v1/projects/:id/document`,
 * last-write-wins без revision. Тело — форма из `shared/projects`, поэтому вторая копия контракта
 * на клиенте не заводится.
 *
 * Документ уходит **объектом, а не строкой**: канонизирующий `serialize` формата нужен там, где важна
 * побайтовая стабильность (diff-guard черновика демо), а на проводе тело всё равно сериализует axios,
 * и сервер валидирует его `documentSchema`.
 *
 * В отличие от чтения, здесь ошибки летят исключением: ветку отказа называет `projectStorage` (только он
 * видит axios и статус ответа), а превращает её в состояние шапки `persistence` планера — политика
 * сохранения принадлежит движку (ADR 0021).
 */
export const saveProjectDocument = async (
  projectId: string,
  document: PlannerDocument,
  { autosave }: { autosave: boolean },
): Promise<SaveProjectDocumentResponse> => {
  const body: SaveProjectDocumentRequest = { document, autosave };
  const { data } = await api.put<unknown>(projectDocumentApiPath(projectId), body, { baseURL: '' });
  // Метка снимка — не украшение: на ней стоит будущее предупреждение о конкурентной записи, выдумывать её нельзя.
  return SaveProjectDocumentResponseSchema.parse(data);
};
