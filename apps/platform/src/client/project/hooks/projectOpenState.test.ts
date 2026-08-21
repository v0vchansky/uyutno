import type { ProjectDto } from '../../../shared/projects';
import { emptyDocumentFixture, planDocumentFixture } from '../api/projectDocumentFixture';
import { hasPlan, projectOpenState } from './projectOpenState';

const PROJECT: ProjectDto = {
  id: 'p1',
  name: 'Двушка на Кантемировской',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
};

const card = (patch: Partial<Parameters<typeof projectOpenState>[0]['card']> = {}) => ({
  isPending: false,
  isError: false,
  project: PROJECT,
  ...patch,
});

const documentInput = (patch: Partial<Parameters<typeof projectOpenState>[0]['document']> = {}) => ({
  isFetching: false,
  isError: false,
  result: { kind: 'empty', updatedAt: PROJECT.updatedAt } as const,
  ...patch,
});

describe('projectOpenState — две фазы открытия (ADR 0021, спека 10)', () => {
  it('карточка ещё едет — фаза 1', () => {
    expect(
      projectOpenState({ card: card({ isPending: true, project: undefined }), document: documentInput() }),
    ).toEqual({ kind: 'loading', phase: 1 });
  });

  it('карточка есть, документ ещё едет — фаза 2', () => {
    expect(
      projectOpenState({ card: card(), document: documentInput({ isFetching: true, result: undefined }) }),
    ).toEqual({ kind: 'loading', phase: 2 });
  });

  it('повторная загрузка возвращает индикатор фазы 2, даже когда прошлый результат уже есть', () => {
    expect(projectOpenState({ card: card(), document: documentInput({ isFetching: true }) })).toEqual({
      kind: 'loading',
      phase: 2,
    });
  });

  it('проекта нет в галерее пользователя — 404, а не модалка редактора', () => {
    expect(projectOpenState({ card: card({ project: undefined }), document: documentInput() })).toEqual({
      kind: 'not-found',
    });
  });

  it('404 от документа — тоже 404', () => {
    expect(projectOpenState({ card: card(), document: documentInput({ result: { kind: 'not-found' } }) })).toEqual({
      kind: 'not-found',
    });
  });

  it('битый документ — модалка «Не удалось открыть проект»', () => {
    expect(
      projectOpenState({
        card: card(),
        document: documentInput({ result: { kind: 'corrupt', reason: 'schema', detail: 'floors: обязательно' } }),
      }),
    ).toEqual({ kind: 'failed' });
  });

  it('отказ транспорта документа — та же модалка с повтором', () => {
    expect(
      projectOpenState({
        card: card(),
        document: documentInput({ result: { kind: 'failed', cause: new Error('x') } }),
      }),
    ).toEqual({ kind: 'failed' });
  });

  it('отказ запроса карточки — та же модалка', () => {
    expect(projectOpenState({ card: card({ isError: true, project: undefined }), document: documentInput() })).toEqual({
      kind: 'failed',
    });
  });

  it('версия новее поддерживаемой — своя ветка', () => {
    expect(
      projectOpenState({
        card: card(),
        document: documentInput({ result: { kind: 'unsupported-version', version: 2, supported: 1 } }),
      }),
    ).toEqual({ kind: 'unsupported-version' });
  });

  it('пустая колонка открывает пустой редактор, а не ошибку', () => {
    expect(projectOpenState({ card: card(), document: documentInput() })).toEqual({ kind: 'open', document: null });
  });

  it('сохранённый документ открывается своим содержимым', () => {
    const document = planDocumentFixture();
    expect(
      projectOpenState({
        card: card(),
        document: documentInput({ result: { kind: 'loaded', document, updatedAt: PROJECT.updatedAt } }),
      }),
    ).toEqual({ kind: 'open', document });
  });
});

describe('hasPlan — что получает авто-fit, а что дефолтный зум (ADR 0021, «Камера при открытии»)', () => {
  it('пустая колонка вписывать нечего', () => {
    expect(hasPlan(null)).toBe(false);
  });

  it('сохранённый, но пустой документ — тоже дефолтный зум', () => {
    expect(hasPlan(emptyDocumentFixture())).toBe(false);
  });

  it('непустой план получает fit', () => {
    expect(hasPlan(planDocumentFixture())).toBe(true);
  });
});
