export enum Route {
  Home = '/',
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
