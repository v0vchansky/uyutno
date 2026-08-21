import { planDocumentFixture } from './projectDocumentFixture';
import { saveProjectDocument } from './saveProjectDocument';

const put = jest.fn();

jest.mock('@app/common', () => ({
  api: {
    put: (...args: unknown[]) => put(...args),
  },
}));

const UPDATED_AT = '2026-08-20T10:00:00.000Z';

beforeEach(() => {
  put.mockReset();
  put.mockResolvedValue({ data: { updatedAt: UPDATED_AT } });
});

describe('saveProjectDocument', () => {
  it('шлёт документ целиком по адресу из shared с признаком автосейва', async () => {
    const document = planDocumentFixture();

    await saveProjectDocument('p1', document, { autosave: true });

    expect(put).toHaveBeenCalledWith('/api/v1/projects/p1/document', { document, autosave: true }, { baseURL: '' });
  });

  it('возвращает метку серверного снимка', async () => {
    await expect(saveProjectDocument('p1', planDocumentFixture(), { autosave: false })).resolves.toEqual({
      updatedAt: UPDATED_AT,
    });
  });

  it('ответ не по схеме — отказ, а не выдуманный `updatedAt`', async () => {
    put.mockResolvedValue({ data: {} });

    await expect(saveProjectDocument('p1', planDocumentFixture(), { autosave: false })).rejects.toBeDefined();
  });
});
