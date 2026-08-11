import { api } from '@app/common';

import type { ProjectDto, RenameProjectRequest } from '../../../shared/projects';

interface RenameProjectResponse {
  project: ProjectDto;
}

interface RenameProjectArgs {
  id: string;
  payload: RenameProjectRequest;
}

export const renameProject = async ({ id, payload }: RenameProjectArgs): Promise<ProjectDto> => {
  const { data } = await api.patch<RenameProjectResponse>(`/projects/${id}`, payload);
  return data.project;
};
