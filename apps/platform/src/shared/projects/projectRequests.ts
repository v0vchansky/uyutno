import { z } from 'zod';

export const PROJECT_NAME_MAX_LENGTH = 60;

export const ProjectNameSchema = z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH);

export const CreateProjectRequestSchema = z.object({
  name: ProjectNameSchema,
});

export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const RenameProjectRequestSchema = z.object({
  name: ProjectNameSchema,
});

export type RenameProjectRequest = z.infer<typeof RenameProjectRequestSchema>;
