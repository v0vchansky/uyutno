import { NotFoundError, ValidationError } from '@server/common';

import { ProjectNameSchema } from '../../../shared/projects';
import type { ProjectDto } from '../../../shared/projects';
import type { ProjectRow, ProjectsRepository } from '../repositories/projectsRepository';

const INVALID_NAME_MESSAGE = 'Неверный формат имени проекта';
const PROJECT_NOT_FOUND_MESSAGE = 'Проект не найден';

const toDto = (row: ProjectRow): ProjectDto => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const parseName = (rawName: string): string => {
  const parsed = ProjectNameSchema.safeParse(rawName);
  if (!parsed.success) {
    throw new ValidationError(INVALID_NAME_MESSAGE);
  }
  return parsed.data;
};

export class ProjectsManager {
  constructor(private readonly projectsRepository: ProjectsRepository) {}

  async list(userId: string): Promise<ProjectDto[]> {
    const rows = await this.projectsRepository.listByUser(userId);
    return rows.map(toDto);
  }

  async create(userId: string, rawName: string): Promise<ProjectDto> {
    const name = parseName(rawName);
    const row = await this.projectsRepository.create({ userId, name });
    return toDto(row);
  }

  async rename(userId: string, id: string, rawName: string): Promise<ProjectDto> {
    const name = parseName(rawName);
    const existing = await this.projectsRepository.findByIdForUser(id, userId);
    if (!existing) {
      throw new NotFoundError(PROJECT_NOT_FOUND_MESSAGE);
    }
    const row = await this.projectsRepository.renameForUser(id, userId, name);
    return toDto(row);
  }

  async duplicate(userId: string, id: string): Promise<ProjectDto> {
    const existing = await this.projectsRepository.findByIdForUser(id, userId);
    if (!existing) {
      throw new NotFoundError(PROJECT_NOT_FOUND_MESSAGE);
    }
    const row = await this.projectsRepository.create({ userId, name: `${existing.name} (копия)` });
    return toDto(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.projectsRepository.findByIdForUser(id, userId);
    if (!existing) {
      throw new NotFoundError(PROJECT_NOT_FOUND_MESSAGE);
    }
    await this.projectsRepository.deleteForUser(id, userId);
  }
}
