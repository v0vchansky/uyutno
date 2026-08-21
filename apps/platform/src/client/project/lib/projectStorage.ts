import type { PlannerStorage, SaveAck } from '@uyutno/planner';
import type { PlannerDocument } from '@uyutno/planner/format';

import { getProjectDocument, type ProjectDocumentResult } from '../api/getProjectDocument';
import { saveProjectDocument } from '../api/saveProjectDocument';

/**
 * Отказ пути открытия в форме исключения — этого требует `PlannerStorage.load`, у которого нет канала
 * ошибки: `null` там уже занят пустым проектом. Причина не теряется — она едет полем `result`, и по нему
 * вызывающий отличает 404 от битого документа.
 */
export class ProjectDocumentError extends Error {
  constructor(readonly result: ProjectDocumentResult) {
    super(`не удалось открыть документ проекта: ${result.kind}`);
    this.name = 'ProjectDocumentError';
  }
}

/**
 * Транспорт сохранения для `<Planner storage />` (ADR 0015 A8, ADR 0021): **платформа знает, куда и чем
 * писать, планер — когда**. Здесь нет ни таймеров, ни dirty-гейта, ни очереди — всё это политика
 * `persistence` внутри движка.
 *
 * Модульная константа, а не фабрика: реализация без состояния, а HTTP-клиент на платформе и так один
 * (`@app/common`). Ссылку можно передавать пропом как есть — планер от смены `storage` не пересоздаётся.
 *
 * **Draft-методов нет намеренно.** Локальной копии у обычного проекта не существует (спека 10,
 * «Storage backend»): черновик живёт только на демо-роуте и заводится задачей 0083. Отсутствие методов —
 * это контракт: по нему `persistence` отвечает `no-draft-storage`, а не пишет мимо сервера.
 */
export const projectStorage: PlannerStorage = {
  load: async (projectId: string): Promise<PlannerDocument | null> => {
    const result = await getProjectDocument(projectId);
    if (result.kind === 'loaded') return result.document;
    if (result.kind === 'empty') return null;
    throw new ProjectDocumentError(result);
  },

  save: (projectId: string, document: PlannerDocument, options: { autosave: boolean }): Promise<SaveAck> =>
    saveProjectDocument(projectId, document, options),
};
