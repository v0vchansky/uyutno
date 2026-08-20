export { ProjectsPage } from './pages/ProjectsPage/ProjectsPage';

/**
 * Публичное для соседнего модуля `project`: шапка редактора показывает имя проекта из того же списка и
 * переименовывает его **той же** модалкой, что галерея (handoff `planner-editor-ui.md`, «Имя проекта»).
 * Ключ запроса общий, поэтому переименование в редакторе обновляет и галерею.
 */
export { getProjects } from './api/getProjects';
export { PROJECTS_QUERY_KEY } from './api/projectsQueryKeys';
export { RenameProjectModal } from './components/RenameProjectModal/RenameProjectModal';
