import { api } from '@app/common';

import type { ProjectDto } from '../../../shared/projects';

interface ListProjectsResponse {
  projects: ProjectDto[];
}

export const getProjects = async (): Promise<ProjectDto[]> => {
  const { data } = await api.get<ListProjectsResponse>('/projects');
  return data.projects;
};
