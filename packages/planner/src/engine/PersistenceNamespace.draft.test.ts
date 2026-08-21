import { AUTOSAVE_INTERVAL_MS, AUTOSAVE_START_DELAY_MS, DRAFT_INTERVAL_MS } from './PersistenceNamespace';
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

/** Момент первой записи черновика: таймер стартует через те же 5 с, что серверный, и тикает раз в 30 с (спека 10). */
const FIRST_DRAFT_MS = AUTOSAVE_START_DELAY_MS + DRAFT_INTERVAL_MS;

const managers: PlannerManager[] = [];

const setup = (options: { projectId?: string; saveTarget?: 'server' | 'draft'; storage?: FakeStorage } = {}) => {
  const fake = options.storage ?? createFakeStorage({ withDraft: true });
  const manager = new PlannerManager({
    projectId: options.projectId ?? '',
    logger: silentLogger,
    document: ringDocument(),
    storage: fake.storage,
    saveTarget: options.saveTarget ?? 'draft',
  });
  managers.push(manager);

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

  return { manager, fake, edit, startDrag, endDrag };
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose();
  jest.useRealTimers();
});

describe('локальный черновик демо — таймер 30 с (спека 10, ADR 0021)', () => {
  describe('периодичность', () => {
    it('первая запись не раньше 5 с после старта редактора', async () => {
      const { fake, edit } = setup();
      edit();

      await jest.advanceTimersByTimeAsync(AUTOSAVE_START_DELAY_MS);
      expect(fake.draftCalls).toEqual([]);
    });

    it('первая запись уходит на первом тике — через 5 + 30 с и ни секундой раньше', async () => {
      const { fake, edit } = setup();
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_DRAFT_MS - 1);
      expect(fake.draftCalls).toEqual([]);

      await jest.advanceTimersByTimeAsync(1);
      expect(fake.draftCalls).toHaveLength(1);
    });

    it('дальше — раз в 30 с, пока есть изменения', async () => {
      const { fake, edit } = setup();
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_DRAFT_MS);
      expect(fake.draftCalls).toHaveLength(1);

      // Снятый успехом dirty поднимается новой правкой — иначе следующий тик пропустил бы гейт.
      edit(320);
      await jest.advanceTimersByTimeAsync(DRAFT_INTERVAL_MS);
      expect(fake.draftCalls).toHaveLength(2);

      edit(340);
      await jest.advanceTimersByTimeAsync(DRAFT_INTERVAL_MS);
      expect(fake.draftCalls).toHaveLength(3);
    });

    it('серверный период черновику не достаётся: между 30 и 60 с запись уже была', async () => {
      const { fake, edit } = setup();
      edit();

      await jest.advanceTimersByTimeAsync(AUTOSAVE_START_DELAY_MS + AUTOSAVE_INTERVAL_MS - 1);
      expect(fake.draftCalls).toHaveLength(1);
    });

    it('dispose останавливает таймер черновика: после него записей нет', async () => {
      const { manager, fake, edit } = setup();
      edit();
      manager.dispose();

      await jest.advanceTimersByTimeAsync(FIRST_DRAFT_MS * 3);
      expect(fake.draftCalls).toEqual([]);
    });
  });

  describe('гейты и гасители — те же, что у серверного автосейва', () => {
    it('projectId демо-роуту не нужен: черновик пишется и без него', async () => {
      const { fake, edit } = setup({ projectId: '' });
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_DRAFT_MS);
      expect(fake.draftCalls).toHaveLength(1);
    });

    it('при снятом dirty записи нет: сохранять нечего', async () => {
      const { manager, fake } = setup();
      // Камера dirty не ставит (ADR 0021) — состояние «изменений нет» после реальной команды.
      manager.view.setCamera('plan', { x: 10, y: 20, zoom: 0.5 });

      await jest.advanceTimersByTimeAsync(FIRST_DRAFT_MS * 3);
      expect(fake.draftCalls).toEqual([]);
      expect(manager.persistence.getState().status).toBe('idle');
    });

    it('активный жест гасит тик черновика так же, как серверный', async () => {
      const { manager, fake, edit, startDrag, endDrag } = setup();
      edit();
      startDrag();

      await jest.advanceTimersByTimeAsync(FIRST_DRAFT_MS);
      await jest.advanceTimersByTimeAsync(DRAFT_INTERVAL_MS);
      expect(fake.draftCalls).toEqual([]);
      expect(manager.persistence.getState().status).toBe('idle');

      // После отпускания уходит **одна** запись на ближайшем тике, а не две пропущенные подряд.
      endDrag();
      await jest.advanceTimersByTimeAsync(DRAFT_INTERVAL_MS);
      expect(fake.draftCalls).toHaveLength(1);
    });

    it('без draft-методов таймер черновика не заводится вовсе', async () => {
      const { manager, edit } = setup({ storage: createFakeStorage() });
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_DRAFT_MS * 3);
      expect(manager.persistence.getState().status).toBe('idle');
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('хранилища не путаются местами', () => {
    it('в режиме черновика серверного save нет ни разу', async () => {
      const { fake, edit } = setup({ projectId: 'p-1' });
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_DRAFT_MS * 3);
      expect(fake.calls).toEqual([]);
      expect(fake.draftCalls.length).toBeGreaterThan(0);
    });

    it('в обычном проекте saveDraft не зовётся ни разу', async () => {
      const { fake, edit } = setup({ projectId: 'p-1', saveTarget: 'server' });
      edit();

      await jest.advanceTimersByTimeAsync((AUTOSAVE_START_DELAY_MS + AUTOSAVE_INTERVAL_MS) * 3);
      expect(fake.draftCalls).toEqual([]);
      expect(fake.calls.length).toBeGreaterThan(0);
    });
  });

  describe('отказ записи', () => {
    /** Отказ `localStorage` (квота, приватный режим) приходит из платформы объявленной причиной. */
    const failing = (): FakeStorage => {
      const fake = createFakeStorage({ withDraft: true });
      fake.storage.saveDraft = () => Promise.reject(new FakeSaveError('unknown'));
      return fake;
    };

    it('даёт то же тихое состояние, что и ошибка автосейва: статус error без модалки', async () => {
      const { manager, edit } = setup({ storage: failing() });
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_DRAFT_MS);
      const state = manager.persistence.getState();
      expect(state.status).toBe('error');
      expect(state.lastError).toMatchObject({ kind: 'save-failed', reason: 'draft', failure: 'unknown' });
      expect(state.failedAt).not.toBeNull();
      expect(state.alert).toBeNull();
    });

    it('редактор не падает и работу не теряет: dirty остаётся, следующий тик пробует снова', async () => {
      const { manager, edit } = setup({ storage: failing() });
      edit();

      await jest.advanceTimersByTimeAsync(FIRST_DRAFT_MS);
      expect(manager.document.isDirty()).toBe(true);

      await jest.advanceTimersByTimeAsync(DRAFT_INTERVAL_MS);
      expect(manager.persistence.getState().status).toBe('error');
      expect(manager.document.isDirty()).toBe(true);
    });
  });
});
