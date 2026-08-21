export { ProjectsPage } from './pages/ProjectsPage/ProjectsPage';

/**
 * Публичное для соседнего модуля `project`: редактор переименовывает проект **той же** модалкой, что
 * галерея (handoff `planner-editor-ui.md`, «Имя проекта»), а карточку открытого проекта держит под ключом
 * `projectQueryKey` — потомком `PROJECTS_QUERY_KEY`, чтобы инвалидация после переименования доставала и
 * галерею, и шапку одним вызовом (задача 0095, см. `api/projectsQueryKeys.ts`).
 */
export { getProjects } from './api/getProjects';
export { PROJECTS_QUERY_KEY, projectQueryKey } from './api/projectsQueryKeys';
export { RenameProjectModal } from './components/RenameProjectModal/RenameProjectModal';
