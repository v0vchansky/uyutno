import type { Kysely } from 'kysely';
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
