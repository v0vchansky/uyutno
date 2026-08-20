import type { PlannerDocument } from '../document/PlannerDocument';
import type { PersistenceState, PlannerStorage, SaveAck } from './PersistenceNamespace';
import { PlannerManager } from './PlannerManager';
import { ringDocument, silentLogger } from './testing/testManager';
import { DRAG_THRESHOLD } from './tools/editHit';
import type { PointerInput } from './tools/ToolState';

const NO_MODS = { ctrl: false, meta: false, shift: false, alt: false };
const input = (x: number, y: number, mods: Partial<PointerInput['mods']> = {}): PointerInput => ({
  x,
  y,
  mods: { ...NO_MODS, ...mods },
  button: 0,
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Ожидание микротасков: очередь `persistence` дренится через `await`, шага таймеров здесь нет. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

interface SaveCall {
  projectId: string;
  document: PlannerDocument;
  autosave: boolean;
}

/**
 * Фейковый транспорт с управляемым промисом: каждый `save` кладёт свой `Deferred` в `pending`, поэтому тест
 * решает, когда запрос «долетел», и видит, сколько запросов было в полёте одновременно.
 */
const createFakeStorage = (options: { withDraft?: boolean } = {}) => {
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

const setup = (storage?: PlannerStorage, document: PlannerDocument = ringDocument()) => {
  const manager = new PlannerManager({ projectId: 'p-1', logger: silentLogger, document, storage });
  const states: PersistenceState[] = [];
  manager.on('persistence:changed', ({ state }) => states.push(state));
  /** Правка содержимого: `settings` вне истории, но dirty ставит (ADR 0018 D7). */
  const edit = (wallHeight = 300): void => {
    manager.document.setSettings({ wallHeight });
  };
  /** Драг вершины `p1` кольца за порог — `dragging-point` без коммита в документ (ADR 0019 E4). */
  const startDrag = (): void => {
    manager.tools.pointerDown(input(0, 0));
    manager.tools.pointerMove(input(DRAG_THRESHOLD + 0.001, 0, { ctrl: true }));
    manager.tools.pointerMove(input(-50, -40, { ctrl: true }));
  };
  const endDrag = (): void => manager.tools.pointerUp(input(-50, -40, { ctrl: true }));
  return { manager, states, edit, startDrag, endDrag };
};

describe('persistence', () => {
  describe('состояние и событие', () => {
    it('стартует в idle без ошибок и меток; снимок заморожен и стабилен', () => {
      const { manager } = setup(createFakeStorage().storage);
      expect(manager.persistence.getState()).toEqual({
        status: 'idle',
        savedAt: null,
        updatedAt: null,
        lastError: null,
        dirty: false,
      });
      expect(manager.persistence.getState()).toBe(manager.persistence.getState());
      expect(Object.isFrozen(manager.persistence.getState())).toBe(true);
    });

    it('правка содержимого даёт ровно одно persistence:changed с поднятым dirty', () => {
      const { manager, states, edit } = setup(createFakeStorage().storage);
      edit();
      expect(states).toHaveLength(1);
      expect(states[0]!.dirty).toBe(true);
      expect(manager.persistence.getState().dirty).toBe(true);
      // Повторная правка тем же значением — no-op транзакция: dirty уже поднят, второго события нет.
      edit();
      expect(states).toHaveLength(1);
    });

    it('успешное сохранение даёт saving → saved и ни одного лишнего события', async () => {
      const fake = createFakeStorage();
      const { manager, states, edit } = setup(fake.storage);
      edit();
      states.length = 0;

      const result = manager.persistence.save('manual');
      expect(states.map(s => s.status)).toEqual(['saving']);
      fake.pending[0]!.resolve({ updatedAt: '2026-08-21T10:00:00.000Z' });
      await result;

      expect(states.map(s => s.status)).toEqual(['saving', 'saved']);
      expect(states[1]!.dirty).toBe(false);
    });
  });

  describe('dirty-гейт', () => {
    it('view.setCamera dirty не поднимает — сохранение не уходит', async () => {
      const fake = createFakeStorage();
      const { manager, states } = setup(fake.storage);

      expect(manager.view.setCamera('plan', { x: 120, y: -40, zoom: 0.5 }).ok).toBe(true);

      expect(manager.document.isDirty()).toBe(false);
      expect(manager.persistence.getState().dirty).toBe(false);
      expect(states).toEqual([]);
      await expect(manager.persistence.save('autosave')).resolves.toEqual({
        ok: true,
        value: { kind: 'skipped', gate: 'not-dirty' },
      });
      expect(fake.calls).toEqual([]);
    });

    it('view.setActive dirty не поднимает — сохранение не уходит', async () => {
      const fake = createFakeStorage();
      const { manager, states } = setup(fake.storage);

      expect(manager.view.setActive('plan').ok).toBe(true);

      expect(manager.document.isDirty()).toBe(false);
      expect(states).toEqual([]);
      await expect(manager.persistence.save('manual')).resolves.toEqual({
        ok: true,
        value: { kind: 'skipped', gate: 'not-dirty' },
      });
      expect(fake.calls).toEqual([]);
    });

    it('document.setSettings dirty поднимает — сохранение уходит', async () => {
      const fake = createFakeStorage();
      const { manager } = setup(fake.storage);

      expect(manager.document.setSettings({ wallHeight: 300 }).ok).toBe(true);

      expect(manager.document.isDirty()).toBe(true);
      const result = manager.persistence.save('manual');
      expect(fake.calls).toHaveLength(1);
      fake.pending[0]!.resolve({ updatedAt: 'u1' });
      await result;
    });

    it('команда планировки dirty поднимает — сохранение уходит', async () => {
      const fake = createFakeStorage();
      const { manager } = setup(fake.storage);
      const floorId = manager.document.get().floors[0]!.id;

      expect(manager.document.movePoints(floorId, [{ id: 'p1', x: -20, y: -20 }]).ok).toBe(true);

      expect(manager.document.isDirty()).toBe(true);
      const result = manager.persistence.save('autosave');
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]!.autosave).toBe(true);
      fake.pending[0]!.resolve({ updatedAt: 'u1' });
      await result;
    });

    it('камера, доехавшая до документа, уезжает на сервер попутно с содержательной правкой', async () => {
      const fake = createFakeStorage();
      const { manager, edit } = setup(fake.storage);
      manager.view.setCamera('plan', { x: 7, y: 8, zoom: 0.5 });
      edit();

      const result = manager.persistence.save('autosave');
      fake.pending[0]!.resolve({ updatedAt: 'u1' });
      await result;

      expect(fake.calls[0]!.document.view.cameras.plan).toEqual({ x: 7, y: 8, zoom: 0.5 });
    });
  });

  describe('без пропа storage', () => {
    it('планер поднимается и работает; ручной Save отвечает типизированной ошибкой', async () => {
      const { manager, edit } = setup(undefined);
      edit();
      expect(manager.document.get().settings.wallHeight).toBe(300);
      await expect(manager.persistence.save('manual')).resolves.toEqual({
        ok: false,
        error: { kind: 'no-storage' },
      });
      expect(manager.persistence.getState().status).toBe('idle');
    });

    it('режим черновика без draft-методов — своя ошибка, серверный save не зовётся', async () => {
      const fake = createFakeStorage();
      const { manager, edit } = setup(fake.storage);
      edit();
      await expect(manager.persistence.save('draft')).resolves.toEqual({
        ok: false,
        error: { kind: 'no-draft-storage' },
      });
      expect(fake.calls).toEqual([]);
    });

    it('draft-методы задействует только режим черновика: saveDraft вместо save', async () => {
      const fake = createFakeStorage({ withDraft: true });
      const { manager, edit } = setup(fake.storage);
      edit();

      await expect(manager.persistence.save('draft')).resolves.toEqual({
        ok: true,
        value: { kind: 'saved', updatedAt: null },
      });
      expect(fake.draftCalls).toHaveLength(1);
      expect(fake.calls).toEqual([]);
      expect(manager.document.isDirty()).toBe(false);
    });
  });

  describe('очередь запросов', () => {
    it('два сохранения подряд — один запрос в полёте, второй уходит после ответа первого', async () => {
      const fake = createFakeStorage();
      const { manager, edit } = setup(fake.storage);
      edit();

      const first = manager.persistence.save('manual');
      const second = manager.persistence.save('autosave');
      expect(fake.calls).toHaveLength(1);

      fake.pending[0]!.resolve({ updatedAt: 'u1' });
      await first;
      await flush();
      expect(fake.calls).toHaveLength(2);

      fake.pending[1]!.resolve({ updatedAt: 'u2' });
      await second;
      expect(fake.peak()).toBe(1);
    });

    it('схлопывание: третий запрос не появляется — ждущие получают результат одного запроса', async () => {
      const fake = createFakeStorage();
      const { manager, edit } = setup(fake.storage);
      edit();

      const first = manager.persistence.save('autosave');
      const second = manager.persistence.save('autosave');
      const third = manager.persistence.save('manual');

      fake.pending[0]!.resolve({ updatedAt: 'u1' });
      await first;
      await flush();
      expect(fake.calls).toHaveLength(2);
      fake.pending[1]!.resolve({ updatedAt: 'u2' });

      expect(await second).toEqual(await third);
      expect(fake.calls).toHaveLength(2);
      // Явный ручной Save побеждает автосейв в схлопнутом слоте: запрос уходит с `autosave: false`.
      expect(fake.calls[1]!.autosave).toBe(false);
      expect(fake.peak()).toBe(1);
    });
  });

  describe('откладывание на drag', () => {
    it('ручной Save в drag откладывается: запрос не уходит до отпускания', async () => {
      const fake = createFakeStorage();
      const { manager, edit, startDrag } = setup(fake.storage);
      edit();
      startDrag();
      expect(manager.tools.get().kind).toBe('dragging-point');

      await expect(manager.persistence.save('manual')).resolves.toEqual({ ok: true, value: { kind: 'deferred' } });
      expect(fake.calls).toEqual([]);
    });

    it('тик таймера в drag пропускается тихо и в очередь не копится', async () => {
      const fake = createFakeStorage();
      const { manager, edit, startDrag } = setup(fake.storage);
      edit();
      startDrag();

      await expect(manager.persistence.save('autosave')).resolves.toEqual({
        ok: true,
        value: { kind: 'skipped', gate: 'gesture' },
      });
      await expect(manager.persistence.save('autosave')).resolves.toEqual({
        ok: true,
        value: { kind: 'skipped', gate: 'gesture' },
      });
      expect(fake.calls).toEqual([]);
      expect(manager.persistence.getState().status).toBe('idle');
    });

    it('после отпускания отложенный Save уходит на ближайшем тике, а не сразу', async () => {
      const fake = createFakeStorage();
      const { manager, edit, startDrag, endDrag } = setup(fake.storage);
      edit();
      startDrag();
      await manager.persistence.save('manual');

      endDrag();
      await flush();
      expect(fake.calls).toEqual([]);

      const tick = manager.persistence.save('autosave');
      expect(fake.calls).toHaveLength(1);
      // Отложен был ручной Save — уходит он, с `autosave: false`.
      expect(fake.calls[0]!.autosave).toBe(false);
      fake.pending[0]!.resolve({ updatedAt: 'u1' });
      await tick;
    });

    it('рисование гасит тик так же, как драг (спека 10 «активный drag/трансформация»)', async () => {
      const fake = createFakeStorage();
      const { manager, edit } = setup(fake.storage);
      edit();
      expect(manager.tools.start('walls').ok).toBe(true);

      await expect(manager.persistence.save('autosave')).resolves.toEqual({
        ok: true,
        value: { kind: 'skipped', gate: 'gesture' },
      });
      expect(fake.calls).toEqual([]);
    });
  });

  describe('успех и ошибка', () => {
    it('markSaved и updatedAt — только по успеху; метка читается наружу', async () => {
      const fake = createFakeStorage();
      const { manager, edit } = setup(fake.storage);
      edit();

      const result = manager.persistence.save('manual');
      expect(manager.persistence.getState().status).toBe('saving');
      fake.pending[0]!.resolve({ updatedAt: '2026-08-21T10:00:00.000Z' });

      expect(await result).toEqual({ ok: true, value: { kind: 'saved', updatedAt: '2026-08-21T10:00:00.000Z' } });
      const state = manager.persistence.getState();
      expect(state.status).toBe('saved');
      expect(state.updatedAt).toBe('2026-08-21T10:00:00.000Z');
      expect(state.dirty).toBe(false);
      expect(typeof state.savedAt).toBe('number');
      expect(manager.document.isDirty()).toBe(false);
    });

    it('при ошибке транспорта dirty остаётся поднятым, markSaved не зовётся, исключения наружу нет', async () => {
      const fake = createFakeStorage();
      const { manager, edit } = setup(fake.storage);
      edit();

      const result = manager.persistence.save('manual');
      const cause = new Error('network down');
      fake.pending[0]!.reject(cause);
      const resolved = await result;

      expect(resolved).toEqual({ ok: false, error: { kind: 'save-failed', reason: 'manual', cause } });
      const state = manager.persistence.getState();
      expect(state.status).toBe('error');
      expect(state.lastError).toEqual({ kind: 'save-failed', reason: 'manual', cause });
      expect(state.dirty).toBe(true);
      expect(manager.document.isDirty()).toBe(true);
      expect(state.updatedAt).toBeNull();
    });

    it('синхронное исключение реализации storage не выходит наружу', async () => {
      const storage: PlannerStorage = {
        load: () => Promise.resolve(null),
        save: () => {
          throw new Error('boom');
        },
      };
      const { manager, edit } = setup(storage);
      edit();
      const result = await manager.persistence.save('manual');
      expect(result.ok).toBe(false);
      expect(manager.persistence.getState().status).toBe('error');
    });

    it('успешное сохранение снимает прежнюю ошибку', async () => {
      const fake = createFakeStorage();
      const { manager, edit } = setup(fake.storage);
      edit();
      const failed = manager.persistence.save('manual');
      fake.pending[0]!.reject(new Error('offline'));
      await failed;
      expect(manager.persistence.getState().lastError).not.toBeNull();

      edit(320);
      const ok = manager.persistence.save('manual');
      fake.pending[1]!.resolve({ updatedAt: 'u2' });
      await ok;
      expect(manager.persistence.getState().lastError).toBeNull();
      expect(manager.persistence.getState().status).toBe('saved');
    });
  });

  describe('DI', () => {
    it('projectId и снимок документа доезжают до транспорта как есть', async () => {
      const fake = createFakeStorage();
      const { manager, edit } = setup(fake.storage);
      edit();
      const snapshot = manager.document.get();

      const result = manager.persistence.save('manual');
      fake.pending[0]!.resolve({ updatedAt: 'u1' });
      await result;

      expect(fake.calls[0]!.projectId).toBe('p-1');
      expect(fake.calls[0]!.document).toBe(snapshot);
      expect(Object.isFrozen(fake.calls[0]!.document)).toBe(true);
    });
  });
});
