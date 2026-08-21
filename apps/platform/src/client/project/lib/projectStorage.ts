import axios from 'axios';

import type { PlannerStorage, SaveAck, SaveFailureKind, StorageSaveFailure } from '@uyutno/planner';
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
 * Отказ записи с **объявленной причиной** (`StorageSaveFailure` из планера): различить «нет сети» и «проект
 * удалён» может только транспорт — он один видит axios и статус ответа (ADR 0015 A8). Планер эти ветки не
 * разбирает, а читает: `offline` держит постоянный статус шапки, `not-found` даёт «Проект удалён» (спека 10).
 *
 * `implements` вместо наследования от классов пакета намеренно: контракт планер проверяет структурно, и
 * value-импорт из `@uyutno/planner` тянул бы в этот файл весь движок вместе с Three.
 */
export class ProjectSaveError extends Error implements StorageSaveFailure {
  constructor(
    readonly failure: SaveFailureKind,
    readonly detail: string | null,
    options?: { cause?: unknown },
  ) {
    super(detail ?? `не удалось сохранить документ проекта: ${failure}`, options);
    this.name = 'ProjectSaveError';
  }
}

/** Тело ошибки от `errorMiddleware` — `{ error, code? }`; всё, что на него не похоже, текста не несёт. */
const serverMessage = (data: unknown): string | null => {
  if (typeof data !== 'object' || data === null) return null;
  const { error } = data as { error?: unknown };
  return typeof error === 'string' && error !== '' ? error : null;
};

/**
 * Разбор отказа записи по ответу.
 *
 * Ответа нет вовсе — это офлайн: запрос до сервера не доехал, и повторит его ближайший тик автосейва.
 * Тонкость, которую честно называем: в ту же ветку попадает недоступный сервер при живой сети — для
 * пользователя разница только в формулировке, а действие («подождать, вкладку не закрывать») одно и то же.
 */
const saveFailure = (cause: unknown): ProjectSaveError => {
  if (!axios.isAxiosError(cause)) return new ProjectSaveError('unknown', null, { cause });
  if (!cause.response) return new ProjectSaveError('offline', null, { cause });

  const detail = serverMessage(cause.response.data);
  // 409 «версия ниже сохранённой» (задача 0080) отдельной ветки не требует: клиенту достаточно текста сервера.
  const failure = cause.response.status === 404 ? 'not-found' : 'unknown';
  return new ProjectSaveError(failure, detail, { cause });
};

/**
 * Транспорт сохранения для `<Planner storage />` (ADR 0015 A8, ADR 0021): **платформа знает, куда и чем
 * писать, планер — когда**. Здесь нет ни таймеров, ни dirty-гейта, ни очереди — всё это политика
 * `persistence` внутри движка; отсюда наружу едут только результат запроса и названная причина отказа.
 *
 * Модульная константа, а не фабрика: реализация без состояния, а HTTP-клиент на платформе и так один
 * (`@app/common`). Ссылку можно передавать пропом как есть — планер от смены `storage` не пересоздаётся.
 *
 * **Draft-методов нет намеренно.** Локальной копии у обычного проекта не существует (спека 10,
 * «Storage backend»): черновик живёт только на демо-роуте, и его реализация — соседний
 * [`demoDraftStorage`](./demoDraftStorage.ts). Отсутствие методов здесь — это контракт: по нему
 * `persistence` отвечает `no-draft-storage`, а не пишет мимо сервера.
 */
export const projectStorage: PlannerStorage = {
  load: async (projectId: string): Promise<PlannerDocument | null> => {
    const result = await getProjectDocument(projectId);
    if (result.kind === 'loaded') return result.document;
    if (result.kind === 'empty') return null;
    throw new ProjectDocumentError(result);
  },

  save: async (projectId: string, document: PlannerDocument, options: { autosave: boolean }): Promise<SaveAck> => {
    try {
      return await saveProjectDocument(projectId, document, options);
    } catch (cause) {
      throw saveFailure(cause);
    }
  },
};
