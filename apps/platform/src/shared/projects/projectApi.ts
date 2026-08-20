/**
 * Адреса REST проектов. Живут в `shared/`, потому что их одинаково знают три места: монтирование роутера
 * на сервере, глобальный парсер тела (ему нужен путь-исключение, см. ниже) и клиентские вызовы.
 */

export const PROJECTS_API_BASE = '/api/v1/projects';

export const projectDocumentApiPath = (projectId: string): string => `${PROJECTS_API_BASE}/${projectId}/document`;

/**
 * Тот же путь регуляркой — для middleware, которому маршрут ещё не разобран и доступен только `req.url`.
 * Собирается из той же константы, чтобы база не разъехалась с монтированием.
 */
export const PROJECT_DOCUMENT_API_PATTERN = new RegExp(`^${PROJECTS_API_BASE}/[^/]+/document(?:[/?#]|$)`);

/**
 * Лимит документа — 2 МБ по **сырому телу запроса**, а не по разобранному объекту (ADR 0021, «Лимиты»).
 * Замер живого плана конкурента — ~118 КБ минифицированного JSON на полноценную квартиру, так что запас
 * больше чем на порядок.
 */
export const PROJECT_DOCUMENT_BODY_LIMIT = '2mb';
