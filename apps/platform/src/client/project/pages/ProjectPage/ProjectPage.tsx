import type React from 'react';
import { useParams } from 'react-router';

import { ProjectEditor } from './ProjectEditor';

/**
 * Роут `/project/:id`. Вся работа — в `ProjectEditor`; страница только достаёт id из адреса и **пересоздаёт
 * редактор на смену проекта** (`key`): переход между двумя проектами оставляет компонент смонтированным, а
 * состояние открытия — фаза, поднятый планер, признак восстановленной сцены — принадлежит конкретному
 * проекту и обязано начинаться заново.
 */
export const ProjectPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  return <ProjectEditor key={id} projectId={id} />;
};
