import { api } from '@app/common';

export const deleteProject = async (id: string): Promise<void> => {
  await api.delete(`/projects/${id}`);
};
