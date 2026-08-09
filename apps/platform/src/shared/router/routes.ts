export enum Route {
  Home = '/',
  Project = '/project/:id',
}

export const projectRoute = (id: string): string => `/project/${id}`;
