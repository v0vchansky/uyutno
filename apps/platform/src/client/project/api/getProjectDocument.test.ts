import { DOCUMENT_VERSION } from '@uyutno/planner/format';

import { getProjectDocument } from './getProjectDocument';
import { emptyDocumentFixture, planDocumentFixture } from './projectDocumentFixture';

const get = jest.fn();

jest.mock('@app/common', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
  },
}));

/** Ошибка axios узнаётся по флагу `isAxiosError` — так её и собираем, без поднятия настоящего клиента. */
const axiosError = (status: number): Error =>
  Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status } });

const respond = (data: unknown): void => {
  get.mockResolvedValueOnce({ data });
};

const UPDATED_AT = '2026-08-20T10:00:00.000Z';

beforeEach(() => {
  get.mockReset();
});

describe('getProjectDocument', () => {
  it('ходит по адресу документа из shared, минуя baseURL клиента', async () => {
    respond({ document: null, updatedAt: UPDATED_AT });

    await getProjectDocument('p1');

    expect(get).toHaveBeenCalledWith('/api/v1/projects/p1/document', { baseURL: '' });
  });

  it('пустая колонка — не ошибка: новый проект отдаётся как `empty`', async () => {
    respond({ document: null, updatedAt: UPDATED_AT });

    await expect(getProjectDocument('p1')).resolves.toEqual({ kind: 'empty', updatedAt: UPDATED_AT });
  });

  it('целый документ разбирается формата ради и отдаётся как `loaded`', async () => {
    const document = planDocumentFixture();
    respond({ document, updatedAt: UPDATED_AT });

    const result = await getProjectDocument('p1');

    expect(result).toMatchObject({ kind: 'loaded', updatedAt: UPDATED_AT });
    expect(result.kind === 'loaded' && result.document.floors[0]!.layout.contours).toHaveLength(1);
  });

  it('битый документ (нет обязательной секции) — `corrupt`, а не исключение', async () => {
    const document = emptyDocumentFixture() as unknown as Record<string, unknown>;
    delete document['floors'];
    respond({ document, updatedAt: UPDATED_AT });

    const result = await getProjectDocument('p1');

    expect(result.kind).toBe('corrupt');
  });

  it('версия новее поддерживаемой — своя ветка `unsupported-version`', async () => {
    const document = { ...emptyDocumentFixture(), version: DOCUMENT_VERSION + 1 };
    respond({ document, updatedAt: UPDATED_AT });

    await expect(getProjectDocument('p1')).resolves.toEqual({
      kind: 'unsupported-version',
      version: DOCUMENT_VERSION + 1,
      supported: DOCUMENT_VERSION,
    });
  });

  it('битые ссылки внутри документа битым проектом не считаются: план грузится без дефектной записи', async () => {
    const document = planDocumentFixture();
    document.floors[0]!.layout.contours.push({ id: 'contour-2', kind: 'outer', points: ['a', 'b', 'missing'] });
    respond({ document, updatedAt: UPDATED_AT });

    const result = await getProjectDocument('p1');

    expect(result.kind).toBe('loaded');
    expect(result.kind === 'loaded' && result.document.floors[0]!.layout.contours.map(c => c.id)).toEqual([
      'contour-1',
    ]);
  });

  it('404 — своя ветка: чужой или несуществующий проект, а не битый документ', async () => {
    get.mockRejectedValueOnce(axiosError(404));

    await expect(getProjectDocument('p1')).resolves.toEqual({ kind: 'not-found' });
  });

  it('отказ транспорта — `failed` с причиной, исключение наружу не летит', async () => {
    const cause = axiosError(500);
    get.mockRejectedValueOnce(cause);

    await expect(getProjectDocument('p1')).resolves.toEqual({ kind: 'failed', cause });
  });

  it('оболочка ответа не по схеме — `failed`, а не «битый проект»', async () => {
    respond({ document: {}, updatedAt: 42 });

    const result = await getProjectDocument('p1');

    expect(result.kind).toBe('failed');
  });
});
