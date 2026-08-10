import type { Kysely } from 'kysely';

import type { Database } from '@server/postgres';

export interface SessionRow {
  id: string;
  userId: string;
  expiresAt: Date;
  lastActivityAt: Date;
  createdAt: Date;
}

const mapRow = (row: {
  id: string;
  user_id: string;
  expires_at: Date;
  last_activity_at: Date;
  created_at: Date;
}): SessionRow => ({
  id: row.id,
  userId: row.user_id,
  expiresAt: row.expires_at,
  lastActivityAt: row.last_activity_at,
  createdAt: row.created_at,
});

export class SessionsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(params: { id: string; userId: string; expiresAt: Date }): Promise<SessionRow> {
    const row = await this.db
      .insertInto('sessions')
      .values({
        id: params.id,
        user_id: params.userId,
        expires_at: params.expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return mapRow(row);
  }

  async findById(id: string): Promise<SessionRow | null> {
    const row = await this.db.selectFrom('sessions').selectAll().where('id', '=', id).executeTakeFirst();

    return row ? mapRow(row) : null;
  }

  async deleteById(id: string): Promise<void> {
    await this.db.deleteFrom('sessions').where('id', '=', id).execute();
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.db.deleteFrom('sessions').where('user_id', '=', userId).execute();
  }

  async touch(id: string, params: { lastActivityAt: Date; expiresAt: Date }): Promise<void> {
    await this.db
      .updateTable('sessions')
      .set({
        last_activity_at: params.lastActivityAt,
        expires_at: params.expiresAt,
      })
      .where('id', '=', id)
      .execute();
  }
}
