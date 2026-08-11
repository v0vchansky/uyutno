import { api } from '@app/common';

import type { CreateProjectRequest, ProjectDto } from '../../../shared/projects';

interface CreateProjectResponse {
  project: ProjectDto;
}

export const createProject = async (payload: CreateProjectRequest): Promise<ProjectDto> => {
  const { data } = await api.post<CreateProjectResponse>('/projects', payload);
  return data.project;
};
