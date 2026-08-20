import type { JsonObject } from '@uyutno/planner/format';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { NotFoundError } from '@server/common';

import { PROJECTS_API_BASE, PROJECT_DOCUMENT_API_PATTERN, projectDocumentApiPath } from '../../shared/projects';
import { errorMiddleware } from '../application/middleware/error';
import { createGlobalJsonParser } from '../application/middleware/jsonBody';
import { ProjectsManager } from './managers/ProjectsManager';
import {
  CREATE_PROJECT_IP_LIMIT,
  CREATE_PROJECT_USER_LIMIT,
  DOCUMENT_READ_LIMIT,
  DOCUMENT_WRITE_LIMIT,
} from './middleware/projectsRateLimit';
import type { ProjectsRepository } from './repositories/projectsRepository';
import { createProjectsRouter } from './router';

/**
 * HTTP-контур REST проектов: пара эндпоинтов документа (задача 0080) и дублирование (задача 0087).
 * Приложение поднимается настоящее и **в том же порядке middleware, что `server.ts`**: половина задачи
 * 0080 — именно порядок (глобальный `express.json` стоит до роутеров, и без исключения по пути
 * роут-локальный лимит 2 МБ молча не сработал бы), проверить его моками контроллера нельзя. По той же
 * причине здесь живут и рейт-лимиты: они middleware, а не логика менеджера.
 */

const OWNER_ID = '01900000-0000-7000-8000-000000000001';
const STRANGER_ID = '01900000-0000-7000-8000-000000000002';
const PROJECT_ID = '01900000-0000-7000-8000-0000000000aa';
const EMPTY_PROJECT_ID = '01900000-0000-7000-8000-0000000000bb';
const MISSING_PROJECT_ID = '01900000-0000-7000-8000-0000000000cc';

const documentOfVersion = (version: number): JsonObject => ({
  format: 'uyutno.planner',
  version,
  floors: [{ id: 'floor-1' }],
});

interface FakeProject {
  id: string;
  userId: string;
  name: string;
  document: JsonObject | null;
  /** Колонка заведена задачей 0078 и в v0 всегда пуста; дублирование обязано переносить её вместе с документом. */
  preview: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Колонки `projects` в памяти. `updated_at` двигается **только** когда репозиторий передал её в `set`:
 * триггера в схеме нет (задача 0078), и фейк обязан повторять именно это, иначе «дата не сдвинулась»
 * проверялось бы против удобной заглушки.
 */
const createStore = (): { projects: FakeProject[]; repository: ProjectsRepository } => {
  const projects: FakeProject[] = [
    {
      id: PROJECT_ID,
      userId: OWNER_ID,
      name: 'Квартира',
      document: documentOfVersion(1),
      preview: 'data:image/png;base64,AAAA',
      createdAt: new Date('2026-08-11T20:00:00.000Z'),
      updatedAt: new Date('2026-08-11T20:00:00.000Z'),
    },
    {
      id: EMPTY_PROJECT_ID,
      userId: OWNER_ID,
      name: 'Ни разу не сохранён',
      document: null,
      preview: null,
      createdAt: new Date('2026-08-12T20:00:00.000Z'),
      updatedAt: new Date('2026-08-12T20:00:00.000Z'),
    },
  ];

  let clock = new Date('2026-09-01T00:00:00.000Z').getTime();
  const tick = (): Date => new Date((clock += 1000));

  const own = (id: string, userId: string): FakeProject | undefined =>
    projects.find(project => project.id === id && project.userId === userId);

  const repository = {
    listByUser: async (userId: string) => projects.filter(project => project.userId === userId),
    findByIdForUser: async (id: string, userId: string) => own(id, userId) ?? null,
    create: async ({ userId, name }: { userId: string; name: string }) => {
      const project: FakeProject = {
        id: `generated-${projects.length}`,
        userId,
        name,
        document: null,
        preview: null,
        createdAt: tick(),
        updatedAt: tick(),
      };
      projects.push(project);
      return project;
    },
    /**
     * Модель `INSERT … SELECT`: строка копируется целиком, меняются только `id`, имя и даты. Фейк обязан
     * повторять именно это — что копия несёт документ, доказывает не он, а SQL-тест репозитория.
     */
    duplicateForUser: async (id: string, userId: string, nameSuffix: string) => {
      const source = own(id, userId);
      if (!source) return null;
      const copy: FakeProject = {
        ...source,
        id: `generated-${projects.length}`,
        name: `${source.name}${nameSuffix}`,
        createdAt: tick(),
        updatedAt: tick(),
      };
      projects.push(copy);
      return copy;
    },
    renameForUser: async (id: string, userId: string, name: string) => {
      const project = own(id, userId);
      if (!project) throw new NotFoundError('Проект не найден');
      project.name = name;
      project.updatedAt = tick();
      return project;
    },
    deleteForUser: async (id: string, userId: string) => {
      const index = projects.findIndex(project => project.id === id && project.userId === userId);
      if (index < 0) throw new NotFoundError('Проект не найден');
      projects.splice(index, 1);
    },
    findDocumentForUser: async (id: string, userId: string) => {
      const project = own(id, userId);
      return project ? { document: project.document, updatedAt: project.updatedAt } : null;
    },
    findDocumentVersionForUser: async (id: string, userId: string) => {
      const project = own(id, userId);
      if (!project) return null;
      const version = project.document?.['version'];
      return { version: typeof version === 'number' ? version : null };
    },
    updateDocumentForUser: async (
      id: string,
      userId: string,
      document: JsonObject,
      options: { touchUpdatedAt: boolean },
    ) => {
      const project = own(id, userId);
      if (!project) throw new NotFoundError('Проект не найден');
      project.document = document;
      if (options.touchUpdatedAt) project.updatedAt = tick();
      return project.updatedAt;
    },
  };

  return { projects, repository: repository as unknown as ProjectsRepository };
};

interface TestServer {
  url: string;
  projects: FakeProject[];
  close: () => Promise<void>;
}

/** Порядок middleware — дословно как в `server.ts`; сессия подменена заголовком. */
const startApp = async (): Promise<TestServer> => {
  const { projects, repository } = createStore();
  const app = express();

  app.use(createGlobalJsonParser({ except: [PROJECT_DOCUMENT_API_PATTERN] }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const id = req.header('x-test-user');
    req.user = id ? { id, email: `${id}@example.test`, displayName: null } : null;
    next();
  });
  app.use(PROJECTS_API_BASE, createProjectsRouter({ projectsManager: new ProjectsManager(repository) }));
  app.use(errorMiddleware);

  const server: Server = await new Promise(resolve => {
    const created = app.listen(0, () => resolve(created));
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    projects,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      }),
  };
};

interface TestResponse {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

const call = async (
  server: TestServer,
  path: string,
  init: { method?: string; user?: string; body?: string } = {},
): Promise<TestResponse> => {
  const response = await fetch(`${server.url}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.user === undefined ? {} : { 'x-test-user': init.user }),
    },
    body: init.body,
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text };
  }
  return { status: response.status, headers: response.headers, body };
};

const putDocument = (
  server: TestServer,
  projectId: string,
  payload: unknown,
  user: string = OWNER_ID,
): Promise<TestResponse> =>
  call(server, projectDocumentApiPath(projectId), { method: 'PUT', user, body: JSON.stringify(payload) });

/** Каноническое имя эндпоинта — `/:id/duplicate` (ADR 0021, «Что важно знать»), а не `/:id/copy`. */
const duplicateProject = (server: TestServer, projectId: string, user: string = OWNER_ID): Promise<TestResponse> =>
  call(server, `${PROJECTS_API_BASE}/${projectId}/duplicate`, { method: 'POST', user });

const projectIdOf = (response: TestResponse): string => (response.body.project as { id: string }).id;

describe('GET /api/v1/projects/:id/document', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startApp();
  });
  afterAll(async () => {
    await server.close();
  });
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('отдаёт документ владельцу', async () => {
    const response = await call(server, projectDocumentApiPath(PROJECT_ID), { user: OWNER_ID });

    expect(response.status).toBe(200);
    expect(response.body.document).toEqual(documentOfVersion(1));
    expect(typeof response.body.updatedAt).toBe('string');
  });

  it('запрос пишущий, поэтому Cache-Control: no-store', async () => {
    const response = await call(server, projectDocumentApiPath(PROJECT_ID), { user: OWNER_ID });

    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('чужой и несуществующий проект — 404 без различия', async () => {
    const foreign = await call(server, projectDocumentApiPath(PROJECT_ID), { user: STRANGER_ID });
    const missing = await call(server, projectDocumentApiPath(MISSING_PROJECT_ID), { user: OWNER_ID });

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it('пустая колонка — { document: null } и 200, а не 404', async () => {
    const response = await call(server, projectDocumentApiPath(EMPTY_PROJECT_ID), { user: OWNER_ID });

    expect(response.status).toBe(200);
    expect(response.body.document).toBeNull();
    expect(typeof response.body.updatedAt).toBe('string');
  });

  it('без сессии — 401', async () => {
    const response = await call(server, projectDocumentApiPath(PROJECT_ID));

    expect(response.status).toBe(401);
  });
});

describe('PUT /api/v1/projects/:id/document', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startApp();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await server.close();
  });

  it('сохраняет документ владельцу, двигает updated_at и возвращает новый updatedAt', async () => {
    const before = server.projects[0]!.updatedAt;

    const response = await putDocument(server, PROJECT_ID, { document: documentOfVersion(1) });

    expect(response.status).toBe(200);
    expect(server.projects[0]!.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    expect(response.body.updatedAt).toBe(server.projects[0]!.updatedAt.toISOString());
  });

  it('флаг autosave принимается', async () => {
    const response = await putDocument(server, PROJECT_ID, { document: documentOfVersion(1), autosave: true });

    expect(response.status).toBe(200);
  });

  it('version ниже сохранённой — 409 с внятным сообщением', async () => {
    server.projects[0]!.document = documentOfVersion(3);

    const response = await putDocument(server, PROJECT_ID, { document: documentOfVersion(2) });

    expect(response.status).toBe(409);
    expect(typeof response.body.error).toBe('string');
    expect(response.body.error).not.toBe('');
    expect(server.projects[0]!.document).toEqual(documentOfVersion(3));
  });

  it.each([
    ['нет format', { version: 1, floors: [] }],
    ['нет floors', { format: 'uyutno.planner', version: 1 }],
    ['мусор вместо объекта', 'не документ'],
  ])('невалидный конверт (%s) — 400', async (_name, document) => {
    const response = await putDocument(server, PROJECT_ID, { document });

    expect(response.status).toBe(400);
  });

  it('чужой проект — 404', async () => {
    const response = await putDocument(server, PROJECT_ID, { document: documentOfVersion(1) }, STRANGER_ID);

    expect(response.status).toBe(404);
  });
});

describe('POST /api/v1/projects/:id/duplicate', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startApp();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await server.close();
  });

  /**
   * До задачи 0087 «Дублировать» давало пустой холст вместо копии плана: `duplicate` создавал новый
   * проект и ничего не копировал. С появлением колонки `document` это уже потеря данных.
   */
  it('копия несёт документ исходника — открытие копии показывает тот же план', async () => {
    const created = await duplicateProject(server, PROJECT_ID);

    expect(created.status).toBe(201);
    const copyDocument = await call(server, projectDocumentApiPath(projectIdOf(created)), { user: OWNER_ID });
    expect(copyDocument.status).toBe(200);
    expect(copyDocument.body.document).toEqual(documentOfVersion(1));
  });

  it('копия несёт превью исходника', async () => {
    const created = await duplicateProject(server, PROJECT_ID);

    const copy = server.projects.find(project => project.id === projectIdOf(created));
    expect(copy?.preview).toBe('data:image/png;base64,AAAA');
  });

  it('имя копии — «{название} (копия)», исходник не тронут', async () => {
    const created = await duplicateProject(server, PROJECT_ID);

    expect((created.body.project as { name: string }).name).toBe('Квартира (копия)');
    expect(server.projects[0]!.name).toBe('Квартира');
    expect(server.projects[0]!.document).toEqual(documentOfVersion(1));
  });

  it('проект без документа дублируется и даёт копию с пустым документом, а не падает', async () => {
    const created = await duplicateProject(server, EMPTY_PROJECT_ID);

    expect(created.status).toBe(201);
    const copyDocument = await call(server, projectDocumentApiPath(projectIdOf(created)), { user: OWNER_ID });
    expect(copyDocument.status).toBe(200);
    expect(copyDocument.body.document).toBeNull();
  });

  it('чужой и несуществующий проект — 404 без различия', async () => {
    const foreign = await duplicateProject(server, PROJECT_ID, STRANGER_ID);
    const missing = await duplicateProject(server, MISSING_PROJECT_ID);

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it('чужой проект копии не создаёт вовсе', async () => {
    const before = server.projects.length;

    await duplicateProject(server, PROJECT_ID, STRANGER_ID);

    expect(server.projects).toHaveLength(before);
  });

  it('без сессии — 401', async () => {
    const response = await call(server, `${PROJECTS_API_BASE}/${PROJECT_ID}/duplicate`, { method: 'POST' });

    expect(response.status).toBe(401);
  });
});

describe('лимит тела документа — 2 МБ по сырому телу', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startApp();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await server.close();
  });

  /** Незнакомое поле проносится схемой насквозь (`looseObject`, forward-compat) — им и набираем вес. */
  const documentOfSize = (bytes: number): JsonObject => ({ ...documentOfVersion(1), filler: 'x'.repeat(bytes) });

  it('тело 3 МБ — 413 нашим JSON, а не 200 и не 500', async () => {
    const response = await putDocument(server, PROJECT_ID, { document: documentOfSize(3 * 1024 * 1024) });

    expect(response.status).toBe(413);
    expect(typeof response.body.error).toBe('string');
    expect(response.body.error).not.toBe('');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('тело 1 МБ проходит', async () => {
    const response = await putDocument(server, PROJECT_ID, { document: documentOfSize(1024 * 1024) });

    expect(response.status).toBe(200);
  });

  it('глобальный лимит 10 МБ на прочих маршрутах не изменился', async () => {
    const response = await call(server, PROJECTS_API_BASE, {
      method: 'POST',
      user: OWNER_ID,
      body: JSON.stringify({ name: 'Большой', filler: 'x'.repeat(3 * 1024 * 1024) }),
    });

    expect(response.status).toBe(201);
  });
});

describe('рейт-лимиты (ADR 0021: квоты на число проектов нет, вместо неё лимит частоты)', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startApp();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await server.close();
  });

  const repeat = async (times: number, run: (index: number) => Promise<TestResponse>): Promise<TestResponse[]> =>
    Promise.all(Array.from({ length: times }, (_unused, index) => run(index)));

  it(`PUT документа: ${DOCUMENT_WRITE_LIMIT} за окно проходят, следующий — 429`, async () => {
    const inside = await repeat(DOCUMENT_WRITE_LIMIT, () =>
      putDocument(server, PROJECT_ID, { document: documentOfVersion(1) }),
    );
    const overflow = await putDocument(server, PROJECT_ID, { document: documentOfVersion(1) });

    expect(inside.every(response => response.status === 200)).toBe(true);
    expect(overflow.status).toBe(429);
    expect(typeof overflow.body.error).toBe('string');
  });

  it(`GET документа: ${DOCUMENT_READ_LIMIT} за окно проходят, следующий — 429`, async () => {
    const inside = await repeat(DOCUMENT_READ_LIMIT, () =>
      call(server, projectDocumentApiPath(PROJECT_ID), { user: OWNER_ID }),
    );
    const overflow = await call(server, projectDocumentApiPath(PROJECT_ID), { user: OWNER_ID });

    expect(inside.every(response => response.status === 200)).toBe(true);
    expect(overflow.status).toBe(429);
  });

  const createProject = (user: string): Promise<TestResponse> =>
    call(server, PROJECTS_API_BASE, { method: 'POST', user, body: JSON.stringify({ name: 'Проект' }) });

  it(`POST /projects: ${CREATE_PROJECT_USER_LIMIT} в час на пользователя, следующий — 429`, async () => {
    const inside = await repeat(CREATE_PROJECT_USER_LIMIT, () => createProject(OWNER_ID));
    const overflow = await createProject(OWNER_ID);

    expect(inside.every(response => response.status === 201)).toBe(true);
    expect(overflow.status).toBe(429);
  });

  /**
   * `POST /:id/duplicate` тоже создаёт проект, поэтому висит на **том же счётчике**, что и `POST /projects`
   * (задача 0087): отдельный экземпляр лимитера удваивал бы разрешённое число созданий в час.
   */
  it(`POST /:id/duplicate делит счётчик с POST /projects: после ${CREATE_PROJECT_USER_LIMIT} созданий дубликат — 429`, async () => {
    const inside = await repeat(CREATE_PROJECT_USER_LIMIT, () => createProject(OWNER_ID));
    const overflow = await duplicateProject(server, PROJECT_ID);

    expect(inside.every(response => response.status === 201)).toBe(true);
    expect(overflow.status).toBe(429);
    expect(typeof overflow.body.error).toBe('string');
  });

  it(`POST /:id/duplicate: ${CREATE_PROJECT_USER_LIMIT} за окно проходят, следующий — 429`, async () => {
    const inside = await repeat(CREATE_PROJECT_USER_LIMIT, () => duplicateProject(server, PROJECT_ID));
    const overflow = await duplicateProject(server, PROJECT_ID);

    expect(inside.every(response => response.status === 201)).toBe(true);
    expect(overflow.status).toBe(429);
  });

  it(`POST /projects: ${CREATE_PROJECT_IP_LIMIT} в час с одного адреса — второй контур`, async () => {
    // Пользователь у каждого запроса свой, иначе первым сработал бы контур по пользователю.
    const inside = await repeat(CREATE_PROJECT_IP_LIMIT, index => createProject(`user-${index}`));
    const overflow = await createProject('user-overflow');

    expect(inside.every(response => response.status === 201)).toBe(true);
    expect(overflow.status).toBe(429);
  });
});
