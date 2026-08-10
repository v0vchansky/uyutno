import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '@server/postgres';

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const mapRow = (row: {
  id: string;
  email: string;
  password_hash: string | null;
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): UserRow => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  emailVerifiedAt: row.email_verified_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class UsersRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    const row = await this.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', normalizeEmail(email))
      .executeTakeFirst();

    return row ? mapRow(row) : null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const row = await this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();

    return row ? mapRow(row) : null;
  }

  async create(params: { email: string; passwordHash: string | null }): Promise<UserRow> {
    const row = await this.db
      .insertInto('users')
      .values({
        id: uuidv7(),
        email: normalizeEmail(params.email),
        password_hash: params.passwordHash,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return mapRow(row);
  }
}
