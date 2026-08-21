import axios from 'axios';

import { api } from '@app/common';
import { parse, type CorruptReason, type PlannerDocument } from '@uyutno/planner/format';

import { ProjectDocumentResponseSchema, projectDocumentApiPath } from '../../../shared/projects';

/**
 * Вторая фаза открытия проекта (ADR 0021, «Хранилище и API»): `GET /api/v1/projects/:id/document`
 * плюс разбор конверта формата.
 *
 * **Ошибок наружу не бросает** — все ветки спеки 10 («Ошибочные сценарии») приезжают значением, потому
 * что каждая из них ведёт к своему экрану: 404 — страница «не найдено», `corrupt` — модалка «Не удалось
 * открыть проект», `unsupported-version` — предложение перезагрузить страницу, `empty` — пустой редактор.
 * Разделять их по типу исключения означало бы разбирать `unknown` в компоненте.
 *
 * Битые ссылки между элементами сюда не попадают вовсе: их молча срезает `parse` (задача 0079), и проект
 * остаётся `loaded` — как требует спека 10.
 */
export type ProjectDocumentResult =
  /** Документ прочитан и разобран; `updatedAt` — метка серверного снимка. */
  | { kind: 'loaded'; document: PlannerDocument; updatedAt: string }
  /** Колонка пуста: проект создан, но ни разу не сохранён. Не ошибка — открывается пустой редактор. */
  | { kind: 'empty'; updatedAt: string }
  /** Чужой, удалённый или несуществующий проект. */
  | { kind: 'not-found' }
  /** Нечитаемый JSON или отсутствие обязательных секций формата — «битый проект» спеки 10. */
  | { kind: 'corrupt'; reason: CorruptReason; detail: string }
  /** Документ записан более новым бандлом: у вкладки устаревший клиент (ADR 0021). */
  | { kind: 'unsupported-version'; version: number; supported: number }
  /** Сеть, статус ответа, оболочка не по схеме — открыть проект не удалось, но повтор имеет смысл. */
  | { kind: 'failed'; cause: unknown };

/** Ключ кеша документа: свой на проект, чтобы переход между проектами не показывал чужой план. */
export const projectDocumentQueryKey = (projectId: string): readonly string[] => ['project-document', projectId];

export const getProjectDocument = async (projectId: string): Promise<ProjectDocumentResult> => {
  let payload: unknown;
  try {
    /**
     * `baseURL: ''` — потому что адрес берётся из `shared/projects` целиком, вместе с `/api/v1`: его знают
     * ещё монтирование роутера и глобальный парсер тела, и второй копии без префикса заводить нельзя.
     * Клиентский `api` свой префикс добавил бы сверху и получил бы `/api/v1/api/v1/...`.
     */
    const response = await api.get<unknown>(projectDocumentApiPath(projectId), { baseURL: '' });
    payload = response.data;
  } catch (cause) {
    if (axios.isAxiosError(cause) && cause.response?.status === 404) return { kind: 'not-found' };
    return { kind: 'failed', cause };
  }

  const envelope = ProjectDocumentResponseSchema.safeParse(payload);
  // Сломанная **оболочка** транспорта — не «битый проект»: документ мы даже не видели, повтор осмыслен.
  if (!envelope.success) return { kind: 'failed', cause: envelope.error };

  const { document, updatedAt } = envelope.data;
  if (document === null) return { kind: 'empty', updatedAt };

  const parsed = parse(document);
  if (parsed.ok) return { kind: 'loaded', document: parsed.value, updatedAt };

  return parsed.error.kind === 'corrupt'
    ? { kind: 'corrupt', reason: parsed.error.reason, detail: parsed.error.detail }
    : { kind: 'unsupported-version', version: parsed.error.version, supported: parsed.error.supported };
};
