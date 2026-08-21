import type { PlannerDocument } from '../../document/PlannerDocument';
import type { PlannerStorage, SaveAck, SaveFailureKind, StorageSaveFailure } from '../PersistenceNamespace';

/**
 * Отказ транспорта с объявленной причиной — ровно то, чем отвечает реализация `storage` в платформе
 * (`ProjectSaveError`). Тесты движка бросают его же, чтобы ветки офлайна и «проект удалён» проверялись на
 * том контракте, который транспорт обязан выполнять, а не на удобной тесту выдумке.
 */
export class FakeSaveError extends Error implements StorageSaveFailure {
  constructor(
    readonly failure: SaveFailureKind,
    readonly detail: string | null = null,
  ) {
    super(`fake save failure: ${failure}`);
    this.name = 'FakeSaveError';
  }
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

export interface SaveCall {
  projectId: string;
  document: PlannerDocument;
  autosave: boolean;
}

export interface FakeStorage {
  storage: PlannerStorage;
  calls: SaveCall[];
  draftCalls: PlannerDocument[];
  /** Промисы запросов в порядке вызова: тест решает, когда запрос «долетел» и чем ответил. */
  pending: Deferred<SaveAck>[];
  /** Максимум одновременно летевших запросов — гарантия «один в полёте» (спека 10 «Крайние случаи»). */
  peak(): number;
}

/**
 * Фейковый транспорт с управляемым промисом: каждый `save` кладёт свой `Deferred` в `pending`, поэтому тест
 * решает, когда запрос «долетел», и видит, сколько запросов было в полёте одновременно. Общий для тестов
 * механики (`0081`) и политики автосейва (`0082`), чтобы обе стороны считали запросы одинаково.
 */
export const createFakeStorage = (options: { withDraft?: boolean } = {}): FakeStorage => {
  const calls: SaveCall[] = [];
  const draftCalls: PlannerDocument[] = [];
  const pending: Deferred<SaveAck>[] = [];
  let inFlight = 0;
  let peak = 0;

  const track = <T>(promise: Promise<T>): Promise<T> => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    return promise.finally(() => {
      inFlight -= 1;
    });
  };

  const storage: PlannerStorage = {
    load: () => Promise.resolve(null),
    save: (projectId, document, { autosave }) => {
      calls.push({ projectId, document, autosave });
      const slot = deferred<SaveAck>();
      pending.push(slot);
      return track(slot.promise);
    },
  };
  if (options.withDraft) {
    storage.loadDraft = () => Promise.resolve(null);
    storage.saveDraft = document => {
      draftCalls.push(document);
      return track(Promise.resolve());
    };
    storage.clearDraft = () => Promise.resolve();
  }

  return { storage, calls, draftCalls, pending, peak: () => peak };
};
