import { AUTOSAVE_INTERVAL_MS, AUTOSAVE_START_DELAY_MS, type PersistenceState } from './PersistenceNamespace';
import { PlannerManager } from './PlannerManager';
import { createFakeStorage, FakeSaveError, type FakeStorage } from './testing/fakeStorage';
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

/** Момент первого тика: таймер стартует через 5 с после старта редактора и тикает раз в 60 с (спека 10). */
const FIRST_TICK_MS = AUTOSAVE_START_DELAY_MS + AUTOSAVE_INTERVAL_MS;

const managers: PlannerManager[] = [];

const setup = (options: { projectId?: string; saveTarget?: 'server' | 'draft'; storage?: FakeStorage | null } = {}) => {
  const fake = options.storage === null ? null : (options.storage ?? createFakeStorage());
  const manager = new PlannerManager({
    projectId: options.projectId ?? 'p-1',
    logger: silentLogger,
    document: ringDocument(),
    storage: fake?.storage,
    saveTarget: options.saveTarget,
  });
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

  return { manager, fake: fake!, states, edit, startDrag, endDrag };
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose();
  jest.useRealTimers();
});

describe('серверный автосейв — таймер 60 с (спека 10, ADR 0021)', () => {
  describe('периодичность', () => {
    it('первый тик не раньше 5 с после старта редактора: до задержки запросов нет', async () => {
      const { fake, edit } = setup();
      edit();

      await jest.advanceTimersByTimeAsync(AUTOSAVE_START_DELAY_MS);
      expect(fake.calls).toEqual([]);
    });

    it('первый запрос уходит на первом тике таймера и ни секундой раньше', async () => {
      const { fake, edit } = setup();
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_TICK_MS - 1);
      expect(fake.calls).toEqual([]);

      await jest.advanceTimersByTimeAsync(1);
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]!.autosave).toBe(true);
      expect(fake.calls[0]!.projectId).toBe('p-1');
    });

    it('дальше — раз в 60 с, пока есть изменения', async () => {
      const { fake, edit } = setup();
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_TICK_MS);
      expect(fake.calls).toHaveLength(1);
      fake.pending[0]!.resolve({ updatedAt: 'u1' });
      await jest.advanceTimersByTimeAsync(0);

      // Снятый успехом dirty поднимается новой правкой — иначе следующий тик пропустил бы гейт.
      edit(320);
      await jest.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
      expect(fake.calls).toHaveLength(2);

      fake.pending[1]!.resolve({ updatedAt: 'u2' });
      await jest.advanceTimersByTimeAsync(0);
      edit(340);
      await jest.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
      expect(fake.calls).toHaveLength(3);
    });

    it('dispose останавливает таймер: после него тиков нет', async () => {
      const { manager, fake, edit } = setup();
      edit();
      manager.dispose();

      await jest.advanceTimersByTimeAsync(FIRST_TICK_MS * 3);
      expect(fake.calls).toEqual([]);
    });
  });

  describe('гейты — ровно два', () => {
    it('без projectId автосейв не уходит, сколько бы тиков ни прошло', async () => {
      const { fake, edit } = setup({ projectId: '' });
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_TICK_MS * 3);
      expect(fake.calls).toEqual([]);
    });

    it('при снятом dirty автосейв не уходит: сохранять нечего', async () => {
      const { manager, fake } = setup();
      // Камера dirty не ставит (ADR 0021) — состояние «изменений нет» после реальной команды, а не «ничего не делали».
      manager.view.setCamera('plan', { x: 10, y: 20, zoom: 0.5 });

      await jest.advanceTimersByTimeAsync(FIRST_TICK_MS * 3);
      expect(fake.calls).toEqual([]);
      expect(manager.persistence.getState().status).toBe('idle');
    });

    it('без пропа storage таймер не заводится вовсе', async () => {
      const { manager } = setup({ storage: null });
      manager.document.setSettings({ wallHeight: 300 });

      await jest.advanceTimersByTimeAsync(FIRST_TICK_MS * 3);
      expect(manager.persistence.getState().status).toBe('idle');
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('гасители тика — ровно два', () => {
    it('в режиме черновика (демо) серверного автосейва нет вовсе', async () => {
      const { fake, edit } = setup({ saveTarget: 'draft' });
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_TICK_MS * 3);
      expect(fake.calls).toEqual([]);
      expect(fake.draftCalls).toEqual([]);
    });

    it('активный жест гасит тик тихо и в очередь не копится', async () => {
      const { manager, fake, edit, startDrag, endDrag } = setup();
      edit();
      startDrag();

      await jest.advanceTimersByTimeAsync(FIRST_TICK_MS);
      await jest.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
      expect(fake.calls).toEqual([]);
      expect(manager.persistence.getState().status).toBe('idle');

      // После отпускания уходит **один** запрос на ближайшем тике, а не два пропущенных подряд.
      endDrag();
      await jest.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
      expect(fake.calls).toHaveLength(1);
    });
  });

  describe('повтор после ошибки', () => {
    it('немедленного повтора нет: следующая попытка — только на ближайшем тике через 60 с', async () => {
      const { fake, edit } = setup();
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_TICK_MS);
      fake.pending[0]!.reject(new FakeSaveError('unknown', 'сервер прилёг'));
      await jest.advanceTimersByTimeAsync(0);
      expect(fake.calls).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS - 1);
      expect(fake.calls).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(1);
      expect(fake.calls).toHaveLength(2);
    });

    it('при снятом dirty попытки не будет: ошибка сама по себе тика не оправдывает', async () => {
      const { manager, fake, edit } = setup();
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_TICK_MS);
      fake.pending[0]!.reject(new FakeSaveError('unknown', 'сервер прилёг'));
      await jest.advanceTimersByTimeAsync(0);

      // Ручной Save прошёл — изменений больше нет, и следующему тику сохранять нечего.
      const manual = manager.persistence.save('manual');
      fake.pending[1]!.resolve({ updatedAt: 'u1' });
      await manual;

      await jest.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS * 3);
      expect(fake.calls).toHaveLength(2);
    });

    it('успешный тик после ошибки снимает состояние ошибки', async () => {
      const { manager, fake, edit } = setup();
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_TICK_MS);
      fake.pending[0]!.reject(new FakeSaveError('offline'));
      await jest.advanceTimersByTimeAsync(0);
      expect(manager.persistence.getState().status).toBe('offline');

      await jest.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
      fake.pending[1]!.resolve({ updatedAt: 'u1' });
      await jest.advanceTimersByTimeAsync(0);

      const state = manager.persistence.getState();
      expect(state.status).toBe('saved');
      expect(state.lastError).toBeNull();
      expect(state.failedAt).toBeNull();
    });
  });

  describe('очередь', () => {
    it('ручной Save и тик автосейва вместе дают один запрос в полёте', async () => {
      const { manager, fake, edit } = setup();
      edit();

      const manual = manager.persistence.save('manual');
      await jest.advanceTimersByTimeAsync(FIRST_TICK_MS);
      expect(fake.calls).toHaveLength(1);
      expect(fake.peak()).toBe(1);

      fake.pending[0]!.resolve({ updatedAt: 'u1' });
      await manual;
      await jest.advanceTimersByTimeAsync(0);
      expect(fake.peak()).toBe(1);
    });
  });
});
