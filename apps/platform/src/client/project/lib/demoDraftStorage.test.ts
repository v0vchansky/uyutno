import { DOCUMENT_FORMAT, DOCUMENT_VERSION, serialize, type JsonObject, type Migration } from '@uyutno/planner/format';

import { emptyDocumentFixture, planDocumentFixture } from '../api/projectDocumentFixture';
import { createDemoDraftStorage, PLANNER_DEMO_DRAFT_KEY } from './demoDraftStorage';

interface FakeLocalStorage extends Storage {
  /** Все вызовы `setItem` по порядку — счётчик, на котором проверяется diff-guard (спека 10). */
  writes: { key: string; value: string }[];
  removals: string[];
  /** Чем отвечает следующая запись: `null` — успехом. Квота и приватный режим бросают синхронно. */
  failWith: unknown;
  keys(): string[];
}

const createFakeLocalStorage = (): FakeLocalStorage => {
  const items = new Map<string, string>();
  return {
    writes: [],
    removals: [],
    failWith: null,
    keys: () => [...items.keys()],
    get length(): number {
      return items.size;
    },
    key(index: number): string | null {
      return [...items.keys()][index] ?? null;
    },
    getItem(key: string): string | null {
      return items.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      this.writes.push({ key, value });
      if (this.failWith !== null) throw this.failWith;
      items.set(key, value);
    },
    removeItem(key: string): void {
      this.removals.push(key);
      items.delete(key);
    },
    clear(): void {
      items.clear();
    },
  };
};

/** Реальный отказ переполненного хранилища — им отвечает браузер, когда квота исчерпана. */
const quotaExceeded = (): DOMException => new DOMException('переполнено', 'QuotaExceededError');

const setup = (options: { migrations?: readonly Migration[] } = {}) => {
  const local = createFakeLocalStorage();
  const storage = createDemoDraftStorage({ getStorage: () => local, migrations: options.migrations });
  return { local, storage };
};

/** Значение ключа как его видит следующая сессия — запись целиком, вместе с меткой времени. */
const storedRecord = (local: FakeLocalStorage): { document: JsonObject; savedAt: number } =>
  JSON.parse(local.getItem(PLANNER_DEMO_DRAFT_KEY) ?? 'null') as { document: JsonObject; savedAt: number };

describe('черновик демо в localStorage (спека 10, ADR 0021)', () => {
  describe('ключ и формат записи', () => {
    it('пишет под ключом planner_demo_draft — идентификатора пользователя в ключе нет', async () => {
      const { local, storage } = setup();

      await storage.saveDraft(planDocumentFixture());

      expect(local.keys()).toEqual([PLANNER_DEMO_DRAFT_KEY]);
      expect(local.writes.map(write => write.key)).toEqual([PLANNER_DEMO_DRAFT_KEY]);
    });

    it('запись — документ в формате сейва плюс метка времени; версия не дублируется отдельным полем', async () => {
      const { local, storage } = setup();
      const document = planDocumentFixture();

      await storage.saveDraft(document);

      const record = storedRecord(local);
      expect(JSON.stringify(record.document)).toBe(serialize(document));
      expect(record.document['format']).toBe(DOCUMENT_FORMAT);
      expect(record.document['version']).toBe(DOCUMENT_VERSION);
      expect(typeof record.savedAt).toBe('number');
      expect(Object.keys(record).sort()).toEqual(['document', 'savedAt']);
    });
  });

  describe('diff-guard', () => {
    it('при неизменном документе setItem не вызывается вовсе', async () => {
      const { local, storage } = setup();
      const document = planDocumentFixture();

      await storage.saveDraft(document);
      await storage.saveDraft(document);
      await storage.saveDraft(planDocumentFixture());

      expect(local.writes).toHaveLength(1);
    });

    it('изменившийся документ пишется', async () => {
      const { local, storage } = setup();
      const document = planDocumentFixture();

      await storage.saveDraft(document);
      document.settings.wallHeight = 300;
      await storage.saveDraft(document);

      expect(local.writes).toHaveLength(2);
      expect(storedRecord(local).document['settings']).toMatchObject({ wallHeight: 300 });
    });

    it('после отказа записи guard не отравлен: следующий тик пробует тот же документ снова', async () => {
      const { local, storage } = setup();
      const document = planDocumentFixture();

      local.failWith = quotaExceeded();
      await expect(storage.saveDraft(document)).rejects.toBeInstanceOf(Error);

      local.failWith = null;
      await storage.saveDraft(document);
      expect(local.writes).toHaveLength(2);
      expect(storedRecord(local).document).toBeTruthy();
    });
  });

  describe('отказ хранилища — тот же тихий отказ, что у автосейва', () => {
    it('QuotaExceededError не роняет редактор: saveDraft объявляет причину unknown', async () => {
      const { local, storage } = setup();
      local.failWith = quotaExceeded();

      await expect(storage.saveDraft(planDocumentFixture())).rejects.toMatchObject({
        failure: 'unknown',
        detail: null,
      });
    });

    it('недоступное хранилище (обращение бросает синхронно) — та же ветка', async () => {
      const storage = createDemoDraftStorage({
        getStorage: () => {
          throw new DOMException('доступ запрещён', 'SecurityError');
        },
      });

      await expect(storage.saveDraft(planDocumentFixture())).rejects.toMatchObject({
        failure: 'unknown',
        detail: null,
      });
      await expect(storage.loadDraft()).resolves.toBeNull();
      await expect(storage.clearDraft()).resolves.toBeUndefined();
    });
  });

  describe('чтение', () => {
    it('возвращает записанный документ: возврат на демо-роут поднимает черновик молча', async () => {
      const { storage } = setup();
      const document = planDocumentFixture();

      await storage.saveDraft(document);
      await expect(storage.loadDraft()).resolves.toEqual(document);
    });

    it('пустой ключ — «черновика нет», а не ошибка', async () => {
      const { storage } = setup();

      await expect(storage.loadDraft()).resolves.toBeNull();
    });

    it.each([
      ['не JSON', 'не-json'],
      ['не запись черновика', '{"document":42}'],
      ['конверт без format', JSON.stringify({ document: { version: 1, floors: [] }, savedAt: 1 })],
      ['конверт без floors', JSON.stringify({ document: { format: DOCUMENT_FORMAT, version: 1 }, savedAt: 1 })],
    ])('битый черновик (%s) не роняет редактор и не остаётся источником вечной ошибки', async (_name, raw) => {
      const { local, storage } = setup();
      local.setItem(PLANNER_DEMO_DRAFT_KEY, raw);

      await expect(storage.loadDraft()).resolves.toBeNull();
      expect(local.getItem(PLANNER_DEMO_DRAFT_KEY)).toBeNull();
      expect(local.removals).toContain(PLANNER_DEMO_DRAFT_KEY);
    });

    it('черновик более новой версии формата не снимается: устаревшая вкладка не уничтожает работу свежей', async () => {
      const { local, storage } = setup();
      const raw = JSON.stringify({
        document: { ...planDocumentFixture(), version: DOCUMENT_VERSION + 1 },
        savedAt: 1,
      });
      local.setItem(PLANNER_DEMO_DRAFT_KEY, raw);

      await expect(storage.loadDraft()).resolves.toBeNull();
      expect(local.getItem(PLANNER_DEMO_DRAFT_KEY)).toBe(raw);
      expect(local.removals).toEqual([]);
    });
  });

  describe('клиентский migrate на чтении (ADR 0021: сервер до черновика не дотягивается)', () => {
    /** Фиктивный шаг 1 → 2: переименовывает поле и поднимает `version` — механика та же, что у сервера. */
    const step: Migration = raw => ({ ...raw, version: 2, migratedAt: 'шаг-1-2' });

    it('при changed: true кладёт мигрированный результат обратно в тот же ключ', async () => {
      const { local, storage } = setup({ migrations: [step] });
      local.setItem(PLANNER_DEMO_DRAFT_KEY, JSON.stringify({ document: emptyDocumentFixture(), savedAt: 111 }));
      local.writes.length = 0;

      /**
       * Проверяется перезапись ключа, а не возвращённый документ: фиктивный шаг поднимает конверт в
       * версию 2, которой продакшн-цепочка `parse` не знает, и такой черновик она читать отказывается —
       * это ровно ветка «черновик записан более новым бандлом». Документ проверяет соседний тест.
       */
      await storage.loadDraft();

      expect(local.writes.map(write => write.key)).toEqual([PLANNER_DEMO_DRAFT_KEY]);
      const record = storedRecord(local);
      expect(record.document['version']).toBe(2);
      expect(record.document['migratedAt']).toBe('шаг-1-2');
      // Перезапись служебная: метка времени черновика от неё не двигается (тот же приём, что `updated_at` у сервера).
      expect(record.savedAt).toBe(111);
    });

    it('при changed: false ключ не переписывается: чтение черновика — не запись', async () => {
      const { local, storage } = setup();
      local.setItem(PLANNER_DEMO_DRAFT_KEY, JSON.stringify({ document: planDocumentFixture(), savedAt: 111 }));
      local.writes.length = 0;

      await expect(storage.loadDraft()).resolves.toEqual(planDocumentFixture());
      expect(local.writes).toEqual([]);
    });
  });

  describe('очистка', () => {
    it('clearDraft снимает ключ', async () => {
      const { local, storage } = setup();
      await storage.saveDraft(planDocumentFixture());

      await storage.clearDraft();

      expect(local.getItem(PLANNER_DEMO_DRAFT_KEY)).toBeNull();
      expect(local.keys()).toEqual([]);
    });

    it('повторный вызов на пустом ключе безопасен', async () => {
      const { storage } = setup();

      await expect(storage.clearDraft()).resolves.toBeUndefined();
      await expect(storage.clearDraft()).resolves.toBeUndefined();
    });

    it('после очистки тот же документ пишется заново: guard не помнит снятый ключ', async () => {
      const { local, storage } = setup();
      const document = planDocumentFixture();

      await storage.saveDraft(document);
      await storage.clearDraft();
      await storage.saveDraft(document);

      expect(local.writes).toHaveLength(2);
      expect(local.getItem(PLANNER_DEMO_DRAFT_KEY)).not.toBeNull();
    });
  });
});
