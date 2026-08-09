import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { DB } from './db.generated.js';

export type Database = DB;

const DEV_DATABASE_URL = 'postgres://uyutno:uyutno@localhost:5432/uyutno';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? DEV_DATABASE_URL,
});

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});
