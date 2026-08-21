export enum Route {
  Home = '/',
  /**
   * Демо. Публичный и без авторизации: лендинг обещает пример «без регистрации» в четырёх местах (кнопка в герое,
   * кнопка в пустой галерее, ссылка «Пример проекта» в подвале всех публичных страниц, ответ FAQ). Пока это
   * страница-заглушка (задача 0092) — на этом же пути её заменит настоящее демо (задача 0064), второго адреса
   * не будет: `/demo` зафиксирован продуктово в `docs/product/features/projects.md`.
   */
  Demo = '/demo',
  Login = '/login',
  Register = '/register',
  ForgotPassword = '/forgot-password',
  ResetPassword = '/reset-password',
  Projects = '/projects',
  Project = '/project/:id',
}

export const projectRoute = (id: string): string => `/project/${id}`;

const escapeRegex = (input: string): string => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildRoutePattern = (route: string): RegExp => {
  const parts = route.split('/').map(part => (part.startsWith(':') ? '[^/]+' : escapeRegex(part)));
  return new RegExp(`^${parts.join('/')}$`);
};

const KNOWN_PAGE_PATTERNS: readonly RegExp[] = Object.values(Route).map(buildRoutePattern);

export const isKnownPagePath = (pathname: string): boolean =>
  KNOWN_PAGE_PATTERNS.some(pattern => pattern.test(pathname));
