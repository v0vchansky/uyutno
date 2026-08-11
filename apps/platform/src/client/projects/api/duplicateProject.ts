import { api } from '@app/common';

import type { ProjectDto } from '../../../shared/projects';

interface DuplicateProjectResponse {
  project: ProjectDto;
}

export const duplicateProject = async (id: string): Promise<ProjectDto> => {
  const { data } = await api.post<DuplicateProjectResponse>(`/projects/${id}/duplicate`);
  return data.project;
};
