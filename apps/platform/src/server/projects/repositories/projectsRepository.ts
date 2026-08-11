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
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('updated_at', 'desc')
      .execute();

    return rows.map(mapRow);
  }

  async findByIdForUser(id: string, userId: string): Promise<ProjectRow | null> {
    const row = await this.db
      .selectFrom('projects')
      .selectAll()
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
      .returningAll()
      .executeTakeFirstOrThrow();

    return mapRow(row);
  }

  async renameForUser(id: string, userId: string, name: string): Promise<ProjectRow> {
    const row = await this.db
      .updateTable('projects')
      .set({ name, updated_at: new Date() })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .returningAll()
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
