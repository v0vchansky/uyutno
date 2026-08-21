import type { PlannerDocument } from '../document/PlannerDocument';
import type { PersistenceState, PlannerStorage } from './PersistenceNamespace';
import { PlannerManager } from './PlannerManager';
import { createFakeStorage, FakeSaveError } from './testing/fakeStorage';
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

/** Ожидание микротасков: очередь `persistence` дренится через `await`, шага таймеров здесь нет. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/** Поднятые в тесте планеры: `dispose` снимает подписки и таймер автосейва (`0082`), чтобы он не пережил тест. */
const managers: PlannerManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose();
});

const setup = (storage?: PlannerStorage, document: PlannerDocument = ringDocument()) => {
  const manager = new PlannerManager({ projectId: 'p-1', logger: silentLogger, document, storage });
  managers.push(manager);
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
        savedReason: null,
        updatedAt: null,
        lastError: null,
        failedAt: null,
        alert: null,
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

      const error = { kind: 'save-failed', reason: 'manual', failure: 'unknown', detail: null, cause };
      expect(resolved).toEqual({ ok: false, error });
      const state = manager.persistence.getState();
      expect(state.status).toBe('error');
      expect(state.lastError).toEqual(error);
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

  describe('ветки отказа: офлайн, удалённый проект, прочее (спека 10, задача 0082)', () => {
    /** Отказ транспорта нужной ветки: реализация `storage` объявляет причину, планер её только читает. */
    const failing = (error: unknown): PlannerStorage => ({
      load: () => Promise.resolve(null),
      save: () => Promise.reject(error),
    });

    it('офлайн даёт постоянный статус offline, а не обычную ошибку', async () => {
      const { manager, edit } = setup(failing(new FakeSaveError('offline')));
      edit();

      const result = await manager.persistence.save('autosave');
      expect(result).toEqual({
        ok: false,
        error: { kind: 'save-failed', reason: 'autosave', failure: 'offline', detail: null, cause: expect.anything() },
      });
      const state = manager.persistence.getState();
      expect(state.status).toBe('offline');
      expect(state.dirty).toBe(true);
      expect(typeof state.failedAt).toBe('number');
    });

    it('ручной Save в офлайне дополнительно поднимает модалку с той же причиной', async () => {
      const { manager, edit } = setup(failing(new FakeSaveError('offline')));
      edit();

      await manager.persistence.save('manual');
      const state = manager.persistence.getState();
      expect(state.status).toBe('offline');
      expect(state.alert).toMatchObject({ kind: 'offline', detail: null });
    });

    it('404 на ручном Save — частный случай «проект удалён»', async () => {
      const { manager, edit } = setup(failing(new FakeSaveError('not-found', 'Проект не найден')));
      edit();

      await manager.persistence.save('manual');
      const state = manager.persistence.getState();
      expect(state.status).toBe('error');
      expect(state.alert).toMatchObject({ kind: 'not-found', detail: 'Проект не найден' });
      expect(state.lastError).toMatchObject({ failure: 'not-found', detail: 'Проект не найден' });
    });

    it('прочий отказ ручного Save даёт модалку с текстом ошибки от транспорта', async () => {
      const { manager, edit } = setup(failing(new FakeSaveError('unknown', 'Документ устарел')));
      edit();

      await manager.persistence.save('manual');
      expect(manager.persistence.getState().alert).toMatchObject({ kind: 'unknown', detail: 'Документ устарел' });
    });

    it('ошибка автосейва — тихое состояние: модалки не появляется ни в одной ветке', async () => {
      for (const failure of ['offline', 'not-found', 'unknown'] as const) {
        const { manager, edit } = setup(failing(new FakeSaveError(failure, 'что-то пошло не так')));
        edit();

        await manager.persistence.save('autosave');
        const state = manager.persistence.getState();
        expect(state.alert).toBeNull();
        expect(state.lastError).toMatchObject({ reason: 'autosave', failure });
      }
    });

    it('исключение без объявленной причины считается прочим отказом, а не офлайном', async () => {
      const { manager, edit } = setup(failing(new Error('boom')));
      edit();

      await manager.persistence.save('manual');
      expect(manager.persistence.getState().status).toBe('error');
      expect(manager.persistence.getState().alert).toMatchObject({ kind: 'unknown', detail: null });
    });

    it('модалку снимает только dismissAlert: успех соседнего сохранения её не закрывает', async () => {
      const fake = createFakeStorage();
      let fail = true;
      const storage: PlannerStorage = {
        load: () => Promise.resolve(null),
        save: (projectId, document, options) =>
          fail ? Promise.reject(new FakeSaveError('unknown', 'нет')) : fake.storage.save(projectId, document, options),
      };
      const { manager, edit } = setup(storage);
      edit();
      await manager.persistence.save('manual');
      expect(manager.persistence.getState().alert).not.toBeNull();

      fail = false;
      const ok = manager.persistence.save('autosave');
      fake.pending[0]!.resolve({ updatedAt: 'u1' });
      await ok;
      expect(manager.persistence.getState().status).toBe('saved');
      expect(manager.persistence.getState().alert).not.toBeNull();

      manager.persistence.dismissAlert();
      expect(manager.persistence.getState().alert).toBeNull();
    });
  });

  describe('что читает шапка (задача 0084)', () => {
    it('успех помнит, чем он был вызван: «Сохранено» и «Автосохранено» — разные тексты', async () => {
      const fake = createFakeStorage();
      const { manager, edit } = setup(fake.storage);
      edit();

      const manual = manager.persistence.save('manual');
      fake.pending[0]!.resolve({ updatedAt: 'u1' });
      await manual;
      expect(manager.persistence.getState().savedReason).toBe('manual');

      edit(320);
      const auto = manager.persistence.save('autosave');
      fake.pending[1]!.resolve({ updatedAt: 'u2' });
      await auto;
      expect(manager.persistence.getState().savedReason).toBe('autosave');
    });

    it('метка времени отказа отдаётся наружу и снимается первым успехом', async () => {
      const fake = createFakeStorage();
      const { manager, edit } = setup(fake.storage);
      edit();

      const failed = manager.persistence.save('autosave');
      fake.pending[0]!.reject(new FakeSaveError('unknown'));
      await failed;
      expect(typeof manager.persistence.getState().failedAt).toBe('number');

      const ok = manager.persistence.save('autosave');
      fake.pending[1]!.resolve({ updatedAt: 'u1' });
      await ok;
      expect(manager.persistence.getState().failedAt).toBeNull();
      expect(manager.persistence.getState().lastError).toBeNull();
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
