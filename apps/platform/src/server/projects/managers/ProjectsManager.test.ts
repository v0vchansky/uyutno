import { NotFoundError, ValidationError } from '@server/common';

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
}

const buildRepository = (overrides: Partial<RepoStub> = {}): { repo: ProjectsRepository; stub: RepoStub } => {
  const stub: RepoStub = {
    listByUser: jest.fn(async () => []),
    findByIdForUser: jest.fn(async () => null),
    create: jest.fn(async ({ userId, name }: { userId: string; name: string }) => buildRow({ userId, name })),
    renameForUser: jest.fn(async (id: string, userId: string, name: string) => buildRow({ id, userId, name })),
    deleteForUser: jest.fn(async () => undefined),
    ...overrides,
  };
  return { repo: stub as unknown as ProjectsRepository, stub };
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
