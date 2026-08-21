import { AxiosError, type AxiosResponse } from 'axios';

import { planDocumentFixture } from '../api/projectDocumentFixture';
import { ProjectDocumentError, projectStorage } from './projectStorage';

const getProjectDocument = jest.fn();
const saveProjectDocument = jest.fn();

jest.mock('../api/getProjectDocument', () => ({
  getProjectDocument: (...args: unknown[]) => getProjectDocument(...args),
}));
jest.mock('../api/saveProjectDocument', () => ({
  saveProjectDocument: (...args: unknown[]) => saveProjectDocument(...args),
}));

const UPDATED_AT = '2026-08-20T10:00:00.000Z';

beforeEach(() => {
  getProjectDocument.mockReset();
  saveProjectDocument.mockReset();
});

describe('projectStorage', () => {
  it('draft-методов не заводит: локальной копии у обычного проекта нет (спека 10)', () => {
    expect(projectStorage.loadDraft).toBeUndefined();
    expect(projectStorage.saveDraft).toBeUndefined();
    expect(projectStorage.clearDraft).toBeUndefined();
  });

  it('load отдаёт документ проекта', async () => {
    const document = planDocumentFixture();
    getProjectDocument.mockResolvedValue({ kind: 'loaded', document, updatedAt: UPDATED_AT });

    await expect(projectStorage.load('p1')).resolves.toBe(document);
    expect(getProjectDocument).toHaveBeenCalledWith('p1');
  });

  it('load отдаёт `null` на пустой колонке — это новый проект, а не ошибка', async () => {
    getProjectDocument.mockResolvedValue({ kind: 'empty', updatedAt: UPDATED_AT });

    await expect(projectStorage.load('p1')).resolves.toBeNull();
  });

  it.each(['not-found', 'corrupt', 'unsupported-version', 'failed'] as const)(
    'load на ветке «%s» отказывает типизированной ошибкой — молчаливого пустого документа не бывает',
    async kind => {
      getProjectDocument.mockResolvedValue({ kind, reason: 'schema', detail: '', version: 2, supported: 1 });

      await expect(projectStorage.load('p1')).rejects.toBeInstanceOf(ProjectDocumentError);
      await expect(projectStorage.load('p1')).rejects.toMatchObject({ result: { kind } });
    },
  );

  it('save отдаёт метку сервера и передаёт признак автосейва', async () => {
    const document = planDocumentFixture();
    saveProjectDocument.mockResolvedValue({ updatedAt: UPDATED_AT });

    await expect(projectStorage.save('p1', document, { autosave: true })).resolves.toEqual({ updatedAt: UPDATED_AT });
    expect(saveProjectDocument).toHaveBeenCalledWith('p1', document, { autosave: true });
  });

  describe('ветки отказа save (задача 0082): причину объявляет транспорт, планер её только читает', () => {
    const save = (): Promise<unknown> => projectStorage.save('p1', planDocumentFixture(), { autosave: false });

    /** Ответ сервера в формате `errorMiddleware`: `{ error, code? }`. */
    const responseError = (status: number, data: unknown): AxiosError =>
      new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, {}, {
        status,
        data,
        statusText: '',
        headers: {},
        config: {},
      } as AxiosResponse);

    it('ответа нет вовсе — «нет сети»: это офлайн спеки 10, а не отказ сервера', async () => {
      saveProjectDocument.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));

      await expect(save()).rejects.toMatchObject({ failure: 'offline', detail: null });
    });

    it('404 — «проект удалён во второй вкладке», с текстом сервера', async () => {
      saveProjectDocument.mockRejectedValue(responseError(404, { error: 'Проект не найден' }));

      await expect(save()).rejects.toMatchObject({ failure: 'not-found', detail: 'Проект не найден' });
    });

    it('409 отката версии — прочий отказ с текстом сервера: клиенту достаточно показать ошибку', async () => {
      saveProjectDocument.mockRejectedValue(
        responseError(409, { error: 'Документ устарел', code: 'document_version_outdated' }),
      );

      await expect(save()).rejects.toMatchObject({ failure: 'unknown', detail: 'Документ устарел' });
    });

    it('500 без разбираемого тела — прочий отказ без текста: сухую строку выдумывать нечем', async () => {
      saveProjectDocument.mockRejectedValue(responseError(500, '<html>502</html>'));

      await expect(save()).rejects.toMatchObject({ failure: 'unknown', detail: null });
    });

    it('исключение не от axios тоже доезжает объявленной причиной, а не голым Error', async () => {
      saveProjectDocument.mockRejectedValue(new Error('boom'));

      await expect(save()).rejects.toMatchObject({ failure: 'unknown', detail: null });
    });
  });
});
