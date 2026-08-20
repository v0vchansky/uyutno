import type { JsonObject } from '@uyutno/planner/format';
import { sql, type Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import { NotFoundError } from '@server/common';
import type { Database } from '@server/postgres';

export interface ProjectRow {
  id: string;
  userId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectDocumentRow {
  /** `null` — проект создан, но ни разу не сохранён. Не «нет проекта» (ADR 0021). */
  document: JsonObject | null;
  updatedAt: Date;
}

/**
 * Явная проекция вместо `selectAll()`/`returningAll()` — обязательное условие ADR 0021:
 * рядом лежат тяжёлые `document` и `preview`, и любая выборка со звёздочкой начала бы таскать
 * документ (~118 КБ на строку) в список проектов и в ответ на переименование.
 * Документ читается своим методом, превью — шагом 9; `ProjectRow` остаётся лёгким.
 */
const PROJECT_COLUMNS = ['id', 'user_id', 'name', 'created_at', 'updated_at'] as const;

const mapRow = (row: {
  id: string;
  user_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}): ProjectRow => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class ProjectsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async listByUser(userId: string): Promise<ProjectRow[]> {
    const rows = await this.db
      .selectFrom('projects')
      .select(PROJECT_COLUMNS)
      .where('user_id', '=', userId)
      .orderBy('updated_at', 'desc')
      .execute();

    return rows.map(mapRow);
  }

  async findByIdForUser(id: string, userId: string): Promise<ProjectRow | null> {
    const row = await this.db
      .selectFrom('projects')
      .select(PROJECT_COLUMNS)
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return row ? mapRow(row) : null;
  }

  async create(params: { userId: string; name: string }): Promise<ProjectRow> {
    const row = await this.db
      .insertInto('projects')
      .values({
        id: uuidv7(),
        user_id: params.userId,
        name: params.name,
      })
      .returning(PROJECT_COLUMNS)
      .executeTakeFirstOrThrow();

    return mapRow(row);
  }

  async renameForUser(id: string, userId: string, name: string): Promise<ProjectRow> {
    const row = await this.db
      .updateTable('projects')
      .set({ name, updated_at: new Date() })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .returning(PROJECT_COLUMNS)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundError(`Project ${id} not found`);
    }

    return mapRow(row);
  }

  /**
   * Дублирование проекта — **одним `INSERT … SELECT`**, целиком внутри базы (ADR 0021, задача 0087):
   * новый `id`, тот же `user_id`, имя с суффиксом, `document` и `preview` из исходной строки, свежие
   * `created_at`/`updated_at` из дефолтов колонок. Читать документ в Node и писать его обратно значило бы
   * гонять сотню килобайт через процесс ради копии, которую база делает сама.
   *
   * Владение зашито в тот же запрос: не подошедший `where` не выбирает строку, вставлять становится
   * нечего, и наружу уходит `null` — чужой и несуществующий проект неотличимы, оба дают 404 у менеджера.
   */
  async duplicateForUser(id: string, userId: string, nameSuffix: string): Promise<ProjectRow | null> {
    const row = await this.db
      .insertInto('projects')
      .columns(['id', 'user_id', 'name', 'document', 'preview'])
      .expression(eb =>
        eb
          .selectFrom('projects')
          .select(source => [
            source.val(uuidv7()).as('id'),
            source.ref('user_id').as('user_id'),
            sql<string>`${source.ref('name')} || ${nameSuffix}`.as('name'),
            source.ref('document').as('document'),
            source.ref('preview').as('preview'),
          ])
          .where('id', '=', id)
          .where('user_id', '=', userId),
      )
      .returning(PROJECT_COLUMNS)
      .executeTakeFirst();

    return row ? mapRow(row) : null;
  }

  /**
   * Единственная выборка, которой документ и нужен, — чтение самого документа (ADR 0021). `updated_at`
   * едет тем же запросом: он нужен клиенту как метка серверного снимка и в ответе с пустой колонкой тоже.
   */
  async findDocumentForUser(id: string, userId: string): Promise<ProjectDocumentRow | null> {
    const row = await this.db
      .selectFrom('projects')
      .select(['document', 'updated_at'])
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!row) return null;

    return { document: (row.document ?? null) as JsonObject | null, updatedAt: row.updated_at };
  }

  /**
   * Версия сохранённого документа — без самого документа: `PUT` сверяет с ней пришедшую (ADR 0021,
   * «версия только растёт»), и тянуть ради одного числа сотню килобайт на каждом автосейве незачем.
   *
   * `null` наружу означает «строки нет» (чужой или несуществующий проект), `{ version: null }` —
   * «проект есть, документа ещё нет». Разница существенная: первое даёт 404, второе — обычную запись.
   * `->>` вместо `->` и разбор числа в JS вместо `::int` в SQL: непригодное значение в колонке должно
   * давать «версии нет», а не ошибку драйвера в 500.
   */
  async findDocumentVersionForUser(id: string, userId: string): Promise<{ version: number | null } | null> {
    const row = await this.db
      .selectFrom('projects')
      .select(sql<string | null>`"document" ->> 'version'`.as('version'))
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!row) return null;

    const version = row.version === null ? Number.NaN : Number.parseInt(row.version, 10);
    return { version: Number.isInteger(version) ? version : null };
  }

  /**
   * Запись документа. **`touchUpdatedAt` — несущий параметр, а не удобство.**
   *
   * Настоящее сохранение (`PUT`) дату меняет; служебная перезапись после миграции на чтении — нет,
   * иначе после выката новой версии формата достаточно полистать старые проекты, чтобы галерея,
   * отсортированная по дате изменения, перетасовалась сама собой (ADR 0021). Триггера на `updated_at`
   * в схеме нет (задача 0078), поэтому «не двигать» — это буквально «не передавать колонку в `set`».
   */
  async updateDocumentForUser(
    id: string,
    userId: string,
    document: JsonObject,
    options: { touchUpdatedAt: boolean },
  ): Promise<Date> {
    const row = await this.db
      .updateTable('projects')
      .set({ document, ...(options.touchUpdatedAt ? { updated_at: new Date() } : {}) })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .returning('updated_at')
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundError(`Project ${id} not found`);
    }

    return row.updated_at;
  }

  async deleteForUser(id: string, userId: string): Promise<void> {
    const result = await this.db
      .deleteFrom('projects')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (result.numDeletedRows === 0n) {
      throw new NotFoundError(`Project ${id} not found`);
    }
  }
}
