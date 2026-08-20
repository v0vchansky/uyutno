import type { JsonObject, Migration } from '@uyutno/planner/format';

import { ConflictError, NotFoundError, ValidationError } from '@server/common';

import type { ProjectRow, ProjectsRepository } from '../repositories/projectsRepository';
import { ProjectsManager } from './ProjectsManager';

const OWNER_ID = '01900000-0000-7000-8000-000000000001';
const STRANGER_ID = '01900000-0000-7000-8000-000000000002';
const PROJECT_ID = '01900000-0000-7000-8000-0000000000aa';

const buildRow = (overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  id: PROJECT_ID,
  userId: OWNER_ID,
  name: 'Мой проект',
  createdAt: new Date('2026-08-11T20:00:00.000Z'),
  updatedAt: new Date('2026-08-11T20:00:00.000Z'),
  ...overrides,
});

interface RepoStub {
  listByUser: jest.Mock;
  findByIdForUser: jest.Mock;
  create: jest.Mock;
  renameForUser: jest.Mock;
  deleteForUser: jest.Mock;
  findDocumentForUser: jest.Mock;
  findDocumentVersionForUser: jest.Mock;
  updateDocumentForUser: jest.Mock;
}

const buildRepository = (overrides: Partial<RepoStub> = {}): { repo: ProjectsRepository; stub: RepoStub } => {
  const stub: RepoStub = {
    listByUser: jest.fn(async () => []),
    findByIdForUser: jest.fn(async () => null),
    create: jest.fn(async ({ userId, name }: { userId: string; name: string }) => buildRow({ userId, name })),
    renameForUser: jest.fn(async (id: string, userId: string, name: string) => buildRow({ id, userId, name })),
    deleteForUser: jest.fn(async () => undefined),
    findDocumentForUser: jest.fn(async () => null),
    findDocumentVersionForUser: jest.fn(async () => null),
    updateDocumentForUser: jest.fn(async () => new Date()),
    ...overrides,
  };
  return { repo: stub as unknown as ProjectsRepository, stub };
};

const SAVED_AT = new Date('2026-08-11T20:00:00.000Z');

/** Минимальный документ, проходящий `documentSchema`: остальное схема дефолтит. */
const documentOfVersion = (version: number): JsonObject => ({
  format: 'uyutno.planner',
  version,
  floors: [{ id: 'floor-1' }],
});

/**
 * Фиктивный шаг цепочки: в v0 боевая цепочка пуста, и на ней `migrate` — тождество с `changed: false`.
 * Проверить перезапись на чтении можно только цепочкой-параметром — ровно ради этого `migrateWith`
 * и принимает её отдельным аргументом (задача 0079), а менеджер — конструктором.
 */
const BUMP_TO_V2: Migration = raw => ({ ...raw, version: 2, migratedBy: 'test-step' });

/**
 * Колонка `projects.document` как она есть в БД: **триггера на `updated_at` нет** (задача 0078),
 * поэтому дата двигается ровно тогда, когда репозиторий передал её в `set`. Фейк моделирует именно это,
 * иначе «дата не сдвинулась» проверялось бы против заглушки, которая её и не умеет двигать.
 */
const buildDocumentColumn = (
  initial: JsonObject | null,
  updatedAt: Date = SAVED_AT,
): { column: { document: JsonObject | null; updatedAt: Date }; overrides: Partial<RepoStub> } => {
  const column = { document: initial, updatedAt };
  const overrides: Partial<RepoStub> = {
    findDocumentForUser: jest.fn(async (_id: string, userId: string) =>
      userId === OWNER_ID ? { document: column.document, updatedAt: column.updatedAt } : null,
    ),
    findDocumentVersionForUser: jest.fn(async (_id: string, userId: string) => {
      if (userId !== OWNER_ID) return null;
      const version = column.document?.['version'];
      return { version: typeof version === 'number' ? version : null };
    }),
    updateDocumentForUser: jest.fn(
      async (_id: string, _userId: string, document: JsonObject, options: { touchUpdatedAt: boolean }) => {
        column.document = document;
        if (options.touchUpdatedAt) column.updatedAt = new Date('2027-03-04T05:06:07.000Z');
        return column.updatedAt;
      },
    ),
  };
  return { column, overrides };
};

describe('ProjectsManager.create', () => {
  it('создаёт проект с валидным именем (trim) и возвращает DTO с ISO-датами', async () => {
    const { repo, stub } = buildRepository();
    const manager = new ProjectsManager(repo);

    const dto = await manager.create(OWNER_ID, '  Новый проект  ');

    expect(stub.create).toHaveBeenCalledWith({ userId: OWNER_ID, name: 'Новый проект' });
    expect(dto.name).toBe('Новый проект');
    expect(typeof dto.createdAt).toBe('string');
    expect(typeof dto.updatedAt).toBe('string');
    expect(dto.createdAt).toBe('2026-08-11T20:00:00.000Z');
  });

  it('бросает ValidationError, если после trim имя пустое', async () => {
    const { repo, stub } = buildRepository();
    const manager = new ProjectsManager(repo);

    await expect(manager.create(OWNER_ID, '   ')).rejects.toBeInstanceOf(ValidationError);
    expect(stub.create).not.toHaveBeenCalled();
  });

  it('бросает ValidationError, если имя длиннее 60 символов', async () => {
    const { repo, stub } = buildRepository();
    const manager = new ProjectsManager(repo);

    await expect(manager.create(OWNER_ID, 'x'.repeat(61))).rejects.toBeInstanceOf(ValidationError);
    expect(stub.create).not.toHaveBeenCalled();
  });
});

describe('ProjectsManager.rename', () => {
  it('переименовывает свой проект', async () => {
    const { repo, stub } = buildRepository({
      findByIdForUser: jest.fn(async () => buildRow()),
    });
    const manager = new ProjectsManager(repo);

    const dto = await manager.rename(OWNER_ID, PROJECT_ID, '  Другое имя ');

    expect(stub.findByIdForUser).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID);
    expect(stub.renameForUser).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID, 'Другое имя');
    expect(dto.name).toBe('Другое имя');
  });

  it('бросает NotFoundError, если проект чужой (не палит факт существования)', async () => {
    const { repo, stub } = buildRepository({
      findByIdForUser: jest.fn(async (_id: string, userId: string) => (userId === OWNER_ID ? buildRow() : null)),
    });
    const manager = new ProjectsManager(repo);

    await expect(manager.rename(STRANGER_ID, PROJECT_ID, 'Хакер')).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.renameForUser).not.toHaveBeenCalled();
  });

  it('бросает ValidationError, если новое имя невалидное — до похода в БД', async () => {
    const findByIdForUser = jest.fn(async () => buildRow());
    const { repo, stub } = buildRepository({ findByIdForUser });
    const manager = new ProjectsManager(repo);

    await expect(manager.rename(OWNER_ID, PROJECT_ID, '')).rejects.toBeInstanceOf(ValidationError);
    expect(findByIdForUser).not.toHaveBeenCalled();
    expect(stub.renameForUser).not.toHaveBeenCalled();
  });
});

describe('ProjectsManager.duplicate', () => {
  it('копирует свой проект с суффиксом «(копия)»', async () => {
    const original = buildRow({ name: 'Гостиная' });
    const { repo, stub } = buildRepository({
      findByIdForUser: jest.fn(async () => original),
    });
    const manager = new ProjectsManager(repo);

    const dto = await manager.duplicate(OWNER_ID, PROJECT_ID);

    expect(stub.create).toHaveBeenCalledWith({ userId: OWNER_ID, name: 'Гостиная (копия)' });
    expect(dto.name).toBe('Гостиная (копия)');
  });

  it('бросает NotFoundError на чужом проекте', async () => {
    const { repo, stub } = buildRepository({
      findByIdForUser: jest.fn(async () => null),
    });
    const manager = new ProjectsManager(repo);

    await expect(manager.duplicate(STRANGER_ID, PROJECT_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.create).not.toHaveBeenCalled();
  });
});

describe('ProjectsManager.delete', () => {
  it('удаляет свой проект', async () => {
    const { repo, stub } = buildRepository({
      findByIdForUser: jest.fn(async () => buildRow()),
    });
    const manager = new ProjectsManager(repo);

    await manager.delete(OWNER_ID, PROJECT_ID);

    expect(stub.deleteForUser).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID);
  });

  it('бросает NotFoundError на чужом проекте', async () => {
    const { repo, stub } = buildRepository({
      findByIdForUser: jest.fn(async () => null),
    });
    const manager = new ProjectsManager(repo);

    await expect(manager.delete(STRANGER_ID, PROJECT_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.deleteForUser).not.toHaveBeenCalled();
  });
});

describe('ProjectsManager.list', () => {
  it('возвращает список проектов пользователя как DTO', async () => {
    const rowA = buildRow({ id: 'a', name: 'A' });
    const rowB = buildRow({ id: 'b', name: 'B', updatedAt: new Date('2026-08-10T10:00:00.000Z') });
    const listByUser = jest.fn(async () => [rowA, rowB]);
    const { repo } = buildRepository({ listByUser });
    const manager = new ProjectsManager(repo);

    const dtos = await manager.list(OWNER_ID);

    expect(listByUser).toHaveBeenCalledWith(OWNER_ID);
    expect(dtos).toHaveLength(2);
    expect(dtos[0]).toEqual({
      id: 'a',
      name: 'A',
      createdAt: rowA.createdAt.toISOString(),
      updatedAt: rowA.updatedAt.toISOString(),
    });
  });
});

describe('ProjectsManager.getDocument — миграция на чтении (ADR 0021)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('migrate что-то изменил — колонка перезаписана сразу, клиент получает уже мигрированный документ', async () => {
    const { column, overrides } = buildDocumentColumn(documentOfVersion(1));
    const { repo, stub } = buildRepository(overrides);
    const manager = new ProjectsManager(repo, [BUMP_TO_V2]);

    const result = await manager.getDocument(OWNER_ID, PROJECT_ID);

    expect(result.document).toEqual({ ...documentOfVersion(1), version: 2, migratedBy: 'test-step' });
    expect(stub.updateDocumentForUser).toHaveBeenCalledTimes(1);
    expect(stub.updateDocumentForUser).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID, result.document, {
      touchUpdatedAt: false,
    });
    expect(column.document).toEqual(result.document);
  });

  it('служебная перезапись НЕ двигает updated_at: значение до и после совпадает', async () => {
    const { column, overrides } = buildDocumentColumn(documentOfVersion(1));
    const { repo, stub } = buildRepository(overrides);
    const manager = new ProjectsManager(repo, [BUMP_TO_V2]);
    const before = column.updatedAt;

    const result = await manager.getDocument(OWNER_ID, PROJECT_ID);

    // Запись обязана была произойти — иначе «дата не сдвинулась» ничего не значит.
    expect(stub.updateDocumentForUser).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID, expect.anything(), {
      touchUpdatedAt: false,
    });
    expect(column.updatedAt).toBe(before);
    expect(result.updatedAt).toBe(before.toISOString());
  });

  it('migrate ничего не изменил — колонка не переписывается вовсе', async () => {
    const { overrides } = buildDocumentColumn(documentOfVersion(1));
    const { repo, stub } = buildRepository(overrides);
    const manager = new ProjectsManager(repo);

    const result = await manager.getDocument(OWNER_ID, PROJECT_ID);

    expect(result.document).toEqual(documentOfVersion(1));
    expect(stub.updateDocumentForUser).not.toHaveBeenCalled();
  });

  it('не удалась перезапись — документ всё равно отдаётся мигрированным, ошибка уходит в логгер', async () => {
    const { overrides } = buildDocumentColumn(documentOfVersion(1));
    const { repo } = buildRepository({
      ...overrides,
      updateDocumentForUser: jest.fn(async () => {
        throw new Error('deadlock detected');
      }),
    });
    const manager = new ProjectsManager(repo, [BUMP_TO_V2]);

    const result = await manager.getDocument(OWNER_ID, PROJECT_ID);

    expect(result.document).toEqual({ ...documentOfVersion(1), version: 2, migratedBy: 'test-step' });
    expect(result.updatedAt).toBe(SAVED_AT.toISOString());
    expect(console.error).toHaveBeenCalled();
  });

  it('битый документ в колонке отдаётся как есть — модалку показывает клиент', async () => {
    const broken = { format: 'uyutno.planner', floors: [] } as unknown as JsonObject;
    const { overrides } = buildDocumentColumn(broken);
    const { repo, stub } = buildRepository(overrides);
    const manager = new ProjectsManager(repo);

    const result = await manager.getDocument(OWNER_ID, PROJECT_ID);

    expect(result.document).toEqual(broken);
    expect(stub.updateDocumentForUser).not.toHaveBeenCalled();
  });

  it('пустая колонка — { document: null } и метка снимка, а не 404', async () => {
    const { overrides } = buildDocumentColumn(null);
    const { repo } = buildRepository(overrides);
    const manager = new ProjectsManager(repo);

    const result = await manager.getDocument(OWNER_ID, PROJECT_ID);

    expect(result.document).toBeNull();
    expect(result.updatedAt).toBe(SAVED_AT.toISOString());
  });

  it('чужой проект — NotFoundError, без различия с несуществующим', async () => {
    const { overrides } = buildDocumentColumn(documentOfVersion(1));
    const { repo, stub } = buildRepository(overrides);
    const manager = new ProjectsManager(repo);

    await expect(manager.getDocument(STRANGER_ID, PROJECT_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.updateDocumentForUser).not.toHaveBeenCalled();
  });
});

describe('ProjectsManager.saveDocument', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('сохраняет документ владельцу и двигает updated_at', async () => {
    const { column, overrides } = buildDocumentColumn(documentOfVersion(1));
    const { repo, stub } = buildRepository(overrides);
    const manager = new ProjectsManager(repo);
    const before = column.updatedAt;

    const result = await manager.saveDocument(OWNER_ID, PROJECT_ID, documentOfVersion(1), { autosave: false });

    expect(stub.updateDocumentForUser).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID, documentOfVersion(1), {
      touchUpdatedAt: true,
    });
    expect(column.updatedAt).not.toBe(before);
    expect(result.updatedAt).toBe(column.updatedAt.toISOString());
  });

  it('version ниже сохранённой — ConflictError, документ не тронут', async () => {
    const { column, overrides } = buildDocumentColumn(documentOfVersion(3));
    const { repo, stub } = buildRepository(overrides);
    const manager = new ProjectsManager(repo);

    await expect(
      manager.saveDocument(OWNER_ID, PROJECT_ID, documentOfVersion(2), { autosave: true }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(stub.updateDocumentForUser).not.toHaveBeenCalled();
    expect(column.document).toEqual(documentOfVersion(3));
  });

  it('version равная сохранённой проходит', async () => {
    const { overrides } = buildDocumentColumn(documentOfVersion(3));
    const { repo, stub } = buildRepository(overrides);
    const manager = new ProjectsManager(repo);

    await manager.saveDocument(OWNER_ID, PROJECT_ID, documentOfVersion(3), { autosave: false });

    expect(stub.updateDocumentForUser).toHaveBeenCalled();
  });

  it('version выше сохранённой проходит', async () => {
    const { overrides } = buildDocumentColumn(documentOfVersion(3));
    const { repo, stub } = buildRepository(overrides);
    const manager = new ProjectsManager(repo);

    await manager.saveDocument(OWNER_ID, PROJECT_ID, documentOfVersion(4), { autosave: false });

    expect(stub.updateDocumentForUser).toHaveBeenCalled();
  });

  it.each([
    ['нет format', { version: 1, floors: [] }],
    ['нет floors', { format: 'uyutno.planner', version: 1 }],
    ['мусор вместо объекта', 'не документ'],
    ['ничего не прислали', undefined],
  ])('невалидный конверт (%s) — ValidationError до похода в БД', async (_name, payload) => {
    const { overrides } = buildDocumentColumn(null);
    const { repo, stub } = buildRepository(overrides);
    const manager = new ProjectsManager(repo);

    await expect(manager.saveDocument(OWNER_ID, PROJECT_ID, payload, { autosave: false })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(stub.updateDocumentForUser).not.toHaveBeenCalled();
  });

  it('чужой проект — NotFoundError, запись не идёт', async () => {
    const { overrides } = buildDocumentColumn(documentOfVersion(1));
    const { repo, stub } = buildRepository(overrides);
    const manager = new ProjectsManager(repo);

    await expect(
      manager.saveDocument(STRANGER_ID, PROJECT_ID, documentOfVersion(1), { autosave: false }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.updateDocumentForUser).not.toHaveBeenCalled();
  });

  it('первое сохранение в пустую колонку проходит — сравнивать не с чем', async () => {
    const { column, overrides } = buildDocumentColumn(null);
    const { repo } = buildRepository(overrides);
    const manager = new ProjectsManager(repo);

    await manager.saveDocument(OWNER_ID, PROJECT_ID, documentOfVersion(1), { autosave: false });

    expect(column.document).toEqual(documentOfVersion(1));
  });

  it('флаг autosave принимается и попадает в лог, на поведение не влияя', async () => {
    const { overrides } = buildDocumentColumn(documentOfVersion(1));
    const { repo, stub } = buildRepository(overrides);
    const manager = new ProjectsManager(repo);

    await manager.saveDocument(OWNER_ID, PROJECT_ID, documentOfVersion(1), { autosave: true });

    expect(stub.updateDocumentForUser).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID, documentOfVersion(1), {
      touchUpdatedAt: true,
    });
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('autosave'));
  });
});
