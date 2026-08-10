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
