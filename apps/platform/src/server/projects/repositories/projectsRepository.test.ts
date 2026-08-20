import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';

import type { Database } from '@server/postgres';

import { ProjectsRepository } from './projectsRepository';

const USER_ID = '01900000-0000-7000-8000-000000000001';
const PROJECT_ID = '01900000-0000-7000-8000-0000000000aa';

/**
 * Колонки, которых не должно быть ни в одной выборке `projects`, кроме чтения самого документа:
 * документ весит сотню килобайт на строку (ADR 0021), и `selectAll()` в списке проектов
 * вытянул бы всю библиотеку планов пользователя ради сетки карточек.
 */
const HEAVY_COLUMNS = ['document', 'preview'];

const EXPECTED_COLUMNS = ['id', 'user_id', 'name', 'created_at', 'updated_at'];

/**
 * Kysely на `DummyDriver`: запросы компилируются, но никуда не идут.
 * `log`-хук отдаёт ту же `CompiledQuery`, что возвращает `.compile()`, — из неё берём `.sql`.
 */
const createCapturingDb = (): { db: Kysely<Database>; compiledSql: string[] } => {
  const compiledSql: string[] = [];

  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (kysely: Kysely<unknown>) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: event => {
      if (event.level === 'query') {
        compiledSql.push(event.query.sql);
      }
    },
  });

  return { db, compiledSql };
};

const singleCompiledSql = (compiledSql: string[]): string => {
  expect(compiledSql).toHaveLength(1);
  const [sql] = compiledSql;
  if (sql === undefined) {
    throw new Error('запрос не был скомпилирован');
  }
  return sql;
};

const expectLightProjection = (sql: string): void => {
  for (const column of HEAVY_COLUMNS) {
    expect(sql).not.toContain(column);
  }
  expect(sql).not.toContain('*');
  for (const column of EXPECTED_COLUMNS) {
    expect(sql).toContain(`"${column}"`);
  }
};

describe('ProjectsRepository — явная проекция колонок', () => {
  it('listByUser выбирает только метаданные и не тянет документ', async () => {
    const { db, compiledSql } = createCapturingDb();

    await new ProjectsRepository(db).listByUser(USER_ID);

    expectLightProjection(singleCompiledSql(compiledSql));
  });

  it('findByIdForUser выбирает только метаданные и не тянет документ', async () => {
    const { db, compiledSql } = createCapturingDb();

    await new ProjectsRepository(db).findByIdForUser(PROJECT_ID, USER_ID);

    expectLightProjection(singleCompiledSql(compiledSql));
  });

  it('create возвращает только метаданные', async () => {
    const { db, compiledSql } = createCapturingDb();

    // DummyDriver не отдаёт строк, поэтому executeTakeFirstOrThrow бросает — запрос при этом уже скомпилирован.
    await expect(new ProjectsRepository(db).create({ userId: USER_ID, name: 'Проект' })).rejects.toThrow();

    expectLightProjection(singleCompiledSql(compiledSql));
  });

  it('renameForUser возвращает только метаданные', async () => {
    const { db, compiledSql } = createCapturingDb();

    await expect(new ProjectsRepository(db).renameForUser(PROJECT_ID, USER_ID, 'Новое имя')).rejects.toThrow();

    expectLightProjection(singleCompiledSql(compiledSql));
  });
});
