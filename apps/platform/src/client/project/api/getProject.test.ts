import { getProject } from './getProject';

const get = jest.fn();

jest.mock('@app/common', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
  },
}));

/** Ошибка axios узнаётся по флагу `isAxiosError` — так её и собираем, без поднятия настоящего клиента. */
const axiosError = (status: number): Error =>
  Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status } });

const PROJECT = {
  id: 'p1',
  name: 'Двушка на Кантемировской',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
};

beforeEach(() => {
  get.mockReset();
});

describe('getProject — карточка одного проекта (задача 0095)', () => {
  it('ходит в ручку одного проекта, а не в список', async () => {
    get.mockResolvedValueOnce({ data: { project: PROJECT } });

    await getProject('p1');

    expect(get).toHaveBeenCalledWith('/projects/p1');
  });

  it('отдаёт карточку из конверта `{ project }`', async () => {
    get.mockResolvedValueOnce({ data: { project: PROJECT } });

    await expect(getProject('p1')).resolves.toEqual(PROJECT);
  });

  /**
   * Ядро задачи: «проекта нет» — это ответ сервера, а не отсутствие строки в галерее. 404 обязан
   * приезжать значением `null`, иначе `useProjectOpen` не отличит его от отказа сети и показал бы
   * модалку «Не удалось открыть проект» вместо 404-страницы.
   */
  it('404 — `null`, а не исключение: чужой или несуществующий проект', async () => {
    get.mockRejectedValueOnce(axiosError(404));

    await expect(getProject('p1')).resolves.toBeNull();
  });

  it('прочие отказы летят исключением — их ретраит и показывает модалкой сам react-query', async () => {
    const cause = axiosError(500);
    get.mockRejectedValueOnce(cause);

    await expect(getProject('p1')).rejects.toBe(cause);
  });
});
