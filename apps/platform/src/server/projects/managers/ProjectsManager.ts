import { documentSchema, migrateWith, MIGRATIONS, type JsonObject, type Migration } from '@uyutno/planner/format';

import { ConflictError, NotFoundError, ValidationError } from '@server/common';

import { ProjectNameSchema } from '../../../shared/projects';
import type { ProjectDocumentResponse, ProjectDto, SaveProjectDocumentResponse } from '../../../shared/projects';
import type { ProjectRow, ProjectsRepository } from '../repositories/projectsRepository';

const INVALID_NAME_MESSAGE = 'Неверный формат имени проекта';
const PROJECT_NOT_FOUND_MESSAGE = 'Проект не найден';
const INVALID_DOCUMENT_MESSAGE = 'Документ проекта не соответствует формату';
/** Текст пользователю: понятно, что делать (перезагрузить), а не «сервер сломался». */
const OUTDATED_DOCUMENT_MESSAGE =
  'Проект уже сохранён в более новом формате. Перезагрузите страницу, иначе изменения будут потеряны';

const toDto = (row: ProjectRow): ProjectDto => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const parseName = (rawName: string): string => {
  const parsed = ProjectNameSchema.safeParse(rawName);
  if (!parsed.success) {
    throw new ValidationError(INVALID_NAME_MESSAGE);
  }
  return parsed.data;
};

export class ProjectsManager {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly migrations: readonly Migration[] = MIGRATIONS,
  ) {}

  /**
   * Чтение документа — **пишущая операция** (ADR 0021, «Версии, парсер, миграции»): документ поднимается
   * из колонки, прогоняется через цепочку миграций, и если та что-то изменила — колонка перезаписывается
   * сразу, а клиенту уходит уже мигрированный документ. Клиент старых версий формата не видит вовсе.
   *
   * Гонка двух одновременных чтений безвредна: `migrate` детерминированная, оба чтения запишут одно и то
   * же. Транзакция и блокировка тут не нужны.
   */
  async getDocument(userId: string, id: string): Promise<ProjectDocumentResponse> {
    const row = await this.projectsRepository.findDocumentForUser(id, userId);
    if (!row) {
      throw new NotFoundError(PROJECT_NOT_FOUND_MESSAGE);
    }

    // Пустая колонка — проект создан, но ни разу не сохранён. Это не 404: пустой документ поднимет клиент.
    if (row.document === null) {
      return { document: null, updatedAt: row.updatedAt.toISOString() };
    }

    const migrated = migrateWith(row.document, this.migrations);
    if (!migrated.ok) {
      /**
       * Битый или записанный более новым бандлом документ сервер не чинит и не прячет за 500: он отдаёт
       * колонку как есть, а разбирается с ней `parse` на клиенте — это он показывает «Не удалось открыть
       * проект» и «перезагрузите страницу» (спека 10, ADR 0021).
       */
      console.error(`[projects] документ ${id} не мигрируется`, migrated.error);
      return { document: row.document, updatedAt: row.updatedAt.toISOString() };
    }

    if (migrated.value.changed) {
      await this.rewriteMigratedDocument(id, userId, migrated.value.document);
    }

    return { document: migrated.value.document, updatedAt: row.updatedAt.toISOString() };
  }

  /**
   * Служебная перезапись после миграции. Два отличия от настоящего сохранения, оба существенные:
   *
   * - **`updated_at` не двигается** — иначе после выката новой версии формата достаточно полистать старые
   *   проекты, чтобы галерея, отсортированная по дате изменения, перетасовалась сама собой;
   * - **ошибка не срывает ответ** — документ всё равно уходит клиенту мигрированным, а следующее чтение
   *   попробует записать снова: `migrate` детерминированная и повтор переживает.
   */
  private async rewriteMigratedDocument(id: string, userId: string, document: JsonObject): Promise<void> {
    try {
      await this.projectsRepository.updateDocumentForUser(id, userId, document, { touchUpdatedAt: false });
    } catch (error) {
      console.error(`[projects] не удалось перезаписать мигрированный документ ${id}`, error);
    }
  }

  /**
   * Сохранение документа целиком. Конкурентная запись из двух вкладок — last-write-wins без
   * предупреждения (спека 10); `revision`, ETag и optimistic locking не заводим.
   */
  async saveDocument(
    userId: string,
    id: string,
    rawDocument: unknown,
    options: { autosave: boolean },
  ): Promise<SaveProjectDocumentResponse> {
    const parsed = documentSchema.safeParse(rawDocument);
    if (!parsed.success) {
      throw new ValidationError(INVALID_DOCUMENT_MESSAGE);
    }

    const stored = await this.projectsRepository.findDocumentVersionForUser(id, userId);
    if (!stored) {
      throw new NotFoundError(PROJECT_NOT_FOUND_MESSAGE);
    }

    /**
     * **Единственная дыра, которую last-write-wins не закрывает сам** (ADR 0021): вкладка со старым
     * бандлом, досылая свой автосейв, вернула бы документ на предыдущую версию формата, затерев всё,
     * что записала вкладка с новым. Обычную потерю правок спека приняла осознанно, регресс формата — нет.
     */
    const incoming = parsed.data.version;
    if (stored.version !== null && incoming < stored.version) {
      throw new ConflictError(OUTDATED_DOCUMENT_MESSAGE, 'document_version_outdated');
    }

    console.info(`[projects] сохранение документа ${id} (autosave: ${String(options.autosave)})`);

    /**
     * Пишется **сырой** документ, а не выход схемы: сервер валидирует конверт и размер, но содержимое
     * не переписывает — иначе он молча правил бы данные пользователя дефолтами своей версии схемы.
     */
    const updatedAt = await this.projectsRepository.updateDocumentForUser(id, userId, rawDocument as JsonObject, {
      touchUpdatedAt: true,
    });

    return { updatedAt: updatedAt.toISOString() };
  }

  async list(userId: string): Promise<ProjectDto[]> {
    const rows = await this.projectsRepository.listByUser(userId);
    return rows.map(toDto);
  }

  async create(userId: string, rawName: string): Promise<ProjectDto> {
    const name = parseName(rawName);
    const row = await this.projectsRepository.create({ userId, name });
    return toDto(row);
  }

  async rename(userId: string, id: string, rawName: string): Promise<ProjectDto> {
    const name = parseName(rawName);
    const existing = await this.projectsRepository.findByIdForUser(id, userId);
    if (!existing) {
      throw new NotFoundError(PROJECT_NOT_FOUND_MESSAGE);
    }
    const row = await this.projectsRepository.renameForUser(id, userId, name);
    return toDto(row);
  }

  async duplicate(userId: string, id: string): Promise<ProjectDto> {
    const existing = await this.projectsRepository.findByIdForUser(id, userId);
    if (!existing) {
      throw new NotFoundError(PROJECT_NOT_FOUND_MESSAGE);
    }
    const row = await this.projectsRepository.create({ userId, name: `${existing.name} (копия)` });
    return toDto(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.projectsRepository.findByIdForUser(id, userId);
    if (!existing) {
      throw new NotFoundError(PROJECT_NOT_FOUND_MESSAGE);
    }
    await this.projectsRepository.deleteForUser(id, userId);
  }
}
