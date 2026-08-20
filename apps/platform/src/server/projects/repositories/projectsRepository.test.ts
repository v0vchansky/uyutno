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

describe('ProjectsRepository — чтение и запись документа', () => {
  it('findDocumentForUser берёт документ и метку снимка — единственная выборка, которой документ нужен', async () => {
    const { db, compiledSql } = createCapturingDb();

    await new ProjectsRepository(db).findDocumentForUser(PROJECT_ID, USER_ID);

    const sql = singleCompiledSql(compiledSql);
    expect(sql).toContain('"document"');
    expect(sql).toContain('"updated_at"');
    expect(sql).not.toContain('preview');
    expect(sql).not.toContain('*');
  });

  it('findDocumentVersionForUser не тянет весь документ ради одного числа', async () => {
    const { db, compiledSql } = createCapturingDb();

    await new ProjectsRepository(db).findDocumentVersionForUser(PROJECT_ID, USER_ID);

    // Точное сравнение: «не тянет документ» здесь означает, что колонка вообще не попадает в проекцию
    // сама по себе — только выражение над ней.
    expect(singleCompiledSql(compiledSql)).toBe(
      `select "document" ->> 'version' as "version" from "projects" where "id" = $1 and "user_id" = $2`,
    );
  });

  /**
   * Ядро задачи 0080: служебная перезапись после миграции не двигает `updated_at`. Триггера в схеме нет
   * (задача 0078), поэтому «не двигать» = «колонки нет в `set`» — и проверяется это по компилированному SQL,
   * а не по значению в фейке: значение в фейке доказывало бы только сам фейк.
   */
  it('updateDocumentForUser с touchUpdatedAt: false не пишет updated_at в set', async () => {
    const { db, compiledSql } = createCapturingDb();

    await expect(
      new ProjectsRepository(db).updateDocumentForUser(
        PROJECT_ID,
        USER_ID,
        { format: 'uyutno.planner' },
        {
          touchUpdatedAt: false,
        },
      ),
    ).rejects.toThrow();

    const sql = singleCompiledSql(compiledSql);
    expect(sql).toContain('set "document"');
    expect(sql).not.toContain('set "document" = $1, "updated_at"');
    expect(sql.slice(0, sql.indexOf(' where '))).not.toContain('updated_at');
  });

  it('updateDocumentForUser с touchUpdatedAt: true двигает updated_at — настоящее сохранение дату меняет', async () => {
    const { db, compiledSql } = createCapturingDb();

    await expect(
      new ProjectsRepository(db).updateDocumentForUser(
        PROJECT_ID,
        USER_ID,
        { format: 'uyutno.planner' },
        {
          touchUpdatedAt: true,
        },
      ),
    ).rejects.toThrow();

    const sql = singleCompiledSql(compiledSql);
    expect(sql.slice(0, sql.indexOf(' where '))).toContain('updated_at');
  });
});
