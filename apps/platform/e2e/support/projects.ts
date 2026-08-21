import { request as apiRequest, type APIRequestContext } from '@playwright/test';

import { PROJECTS_API_BASE, projectDocumentApiPath, type ProjectDto } from '../../src/shared/projects';
import { STORAGE_STATE_PATH } from './testUser';

/**
 * Проекты для планерных спек.
 *
 * С задачи 0085 `/project/:id` **действительно открывает проект**: страница спрашивает карточку и документ,
 * а чужой или несуществующий id даёт 404-страницу вместо редактора. Выдуманные адреса вида
 * `/project/e2e-toolbar`, на которых спеки жили раньше, с этого момента редактор не открывают — id обязан
 * быть настоящим.
 *
 * Проект ищется **по имени** и создаётся только если его ещё нет: прогоны переиспользуют один и тот же
 * проект, поэтому `POST /projects` (60 в час на пользователя) срабатывает один раз за всю жизнь базы, а не
 * на каждый запуск. Внутри прогона результат ещё и запоминается — список запрашивается один раз на имя.
 */
const cache = new Map<string, string>();

const listProjects = async (request: APIRequestContext): Promise<ProjectDto[]> => {
  const response = await request.get(PROJECTS_API_BASE);
  if (!response.ok()) throw new Error(`GET ${PROJECTS_API_BASE} вернул ${response.status()}: ${await response.text()}`);
  return ((await response.json()) as { projects: ProjectDto[] }).projects;
};

/** Id проекта e2e-пользователя с таким именем; заводится при первом обращении. */
export const ensureProject = async (request: APIRequestContext, name: string): Promise<string> => {
  const cached = cache.get(name);
  if (cached) return cached;

  const existing = (await listProjects(request)).find(project => project.name === name);
  if (existing) {
    cache.set(name, existing.id);
    return existing.id;
  }

  const created = await request.post(PROJECTS_API_BASE, { data: { name } });
  if (!created.ok()) throw new Error(`POST ${PROJECTS_API_BASE} вернул ${created.status()}: ${await created.text()}`);
  const { project } = (await created.json()) as { project: ProjectDto };
  cache.set(name, project.id);
  return project.id;
};

/** Адрес редактора существующего проекта — то, что раньше было константой `PROJECT_URL` в каждой спеке. */
export const ensureProjectUrl = async (request: APIRequestContext, name: string): Promise<string> =>
  `/project/${await ensureProject(request, name)}`;

/**
 * То же, но со своим контекстом под сессией e2e-пользователя: нужен спекам, которые сами ходят гостем
 * (`test.use({ storageState: GUEST_STORAGE_STATE })`) — их фикстура `request` проекта завести не может.
 */
export const ensureProjectUrlAsUser = async (baseURL: string, name: string): Promise<string> => {
  const context = await apiRequest.newContext({ baseURL, storageState: STORAGE_STATE_PATH });
  try {
    return await ensureProjectUrl(context, name);
  } finally {
    await context.dispose();
  }
};

/**
 * Кладёт документ в проект в обход UI. Кнопка «Сохранить» ещё не подключена (задачи 0082/0084), а путь
 * открытия проверять надо уже сейчас — сохранённое состояние приезжает прямо в `PUT …/document`.
 *
 * `document: null` не поддерживается сервером (схема формата), поэтому «вернуть проект в пустое состояние»
 * означает записать в него пустой документ.
 */
export const putProjectDocument = async (
  request: APIRequestContext,
  projectId: string,
  document: unknown,
): Promise<void> => {
  const response = await request.put(projectDocumentApiPath(projectId), { data: { document } });
  if (!response.ok()) {
    throw new Error(`PUT документа вернул ${response.status()}: ${await response.text()}`);
  }
};
