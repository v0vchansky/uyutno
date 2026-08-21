import axios from 'axios';

import { api } from '@app/common';

import type { ProjectDto } from '../../../shared/projects';

interface GetProjectResponse {
  project: ProjectDto;
}

/**
 * Первая фаза открытия проекта (ADR 0021, «Хранилище и API»; спека 10, «Load проекта»): карточка проекта —
 * имя для шапки и он же ответ на вопрос «существует ли проект и ваш ли он».
 *
 * До задачи 0095 фаза ходила в `GET /api/v1/projects` и искала нужный id в списке всех проектов
 * пользователя: отдельной ручки в API не было. Отсюда две беды — открытие одного проекта тянуло с сервера
 * всю библиотеку планов ради одного имени, а «проекта нет» означало «не нашёлся в галерее», то есть
 * отсутствие строки в чужом ответе, а не ответ сервера про этот проект.
 *
 * **404 приезжает значением `null`, а не исключением**: чужой и несуществующий проект — это 404-страница,
 * а отказ сети — модалка «Не удалось открыть проект» с повтором (спека 10). Разделять их по типу
 * исключения означало бы разбирать `unknown` в хуке. Прочие отказы остаются исключением намеренно: их
 * ретраит и превращает в `isError` сам react-query.
 */
export const getProject = async (projectId: string): Promise<ProjectDto | null> => {
  try {
    const { data } = await api.get<GetProjectResponse>(`/projects/${projectId}`);
    return data.project;
  } catch (cause) {
    if (axios.isAxiosError(cause) && cause.response?.status === 404) return null;
    throw cause;
  }
};
