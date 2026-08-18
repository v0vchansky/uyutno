import { freeze, produce } from 'immer';

import { createEmptyDocument, type PlannerDocument } from '../../document/PlannerDocument';
import { applyRecord, captureRecord, HistoryLog, MAX_HISTORY, zoneOfView } from './HistoryLog';

/** Новый замороженный документ с другим `layout` (по ссылке) — имитация транзакции содержимого. */
const bumpLayout = (document: PlannerDocument, hidden = 'x'): PlannerDocument =>
  freeze(
    produce(document, draft => {
      draft.floors[0]!.layout.rooms.push({ id: hidden, anchor: [], name: '', ceilingHeight: 280 });
    }),
    true,
  );

const bumpScene = (document: PlannerDocument, hidden = 'x'): PlannerDocument =>
  freeze(
    produce(document, draft => {
      draft.floors[0]!.scene.hidden.push(hidden);
    }),
    true,
  );

describe('HistoryLog', () => {
  const base = freeze(createEmptyDocument(), true);

  it('zoneOfView: конструктор → layout, остальные виды → scene', () => {
    expect(zoneOfView('constructor')).toBe('layout');
    expect(zoneOfView('plan')).toBe('scene');
    expect(zoneOfView('orbit')).toBe('scene');
    expect(zoneOfView('walk')).toBe('scene');
  });

  it('создание: baseline в обоих контейнерах, флаги false, активная зона по виду документа', () => {
    const log = new HistoryLog(base);
    expect(log.get()).toEqual({ canUndo: false, canRedo: false });
    expect(log.getActiveZone()).toBe('layout');
    expect(log.peekUndo()).toBeNull();
    expect(log.peekRedo()).toBeNull();
    const planDoc = freeze(
      produce(base, d => void (d.view.activeView = 'plan')),
      true,
    );
    expect(new HistoryLog(planDoc).getActiveZone()).toBe('scene');
  });

  it('get() — стабильная замороженная ссылка при тех же флагах', () => {
    const log = new HistoryLog(base);
    const state = log.get();
    expect(log.get()).toBe(state);
    expect(Object.isFrozen(state)).toBe(true);
    log.commit(bumpLayout(base), 'layout');
    expect(log.get()).not.toBe(state);
    expect(log.get()).toBe(log.get());
  });

  it('captureRecord держит ссылки на поддеревья, applyRecord подменяет их по floorId', () => {
    const record = captureRecord(base, 'layout');
    expect(record).toEqual({
      zone: 'layout',
      floors: [{ floorId: base.floors[0]!.id, layout: base.floors[0]!.layout }],
    });
    const changed = bumpLayout(base);
    const restored = produce(changed, draft => applyRecord(draft, record));
    expect(restored.floors[0]!.layout).toBe(base.floors[0]!.layout);
    expect(restored.floors[0]!.scene).toBe(changed.floors[0]!.scene);

    const sceneRecord = captureRecord(changed, 'scene');
    const sceneChanged = bumpScene(changed);
    const sceneRestored = produce(sceneChanged, draft => applyRecord(draft, sceneRecord));
    expect(sceneRestored.floors[0]!.scene).toBe(changed.floors[0]!.scene);
    expect(sceneRestored.floors[0]!.layout).toBe(changed.floors[0]!.layout);
  });

  it('applyRecord той же записи — no-op (immer возвращает тот же документ)', () => {
    const record = captureRecord(base, 'layout');
    expect(produce(base, draft => applyRecord(draft, record))).toBe(base);
  });

  it('commit: push, canUndo; peekUndo — предыдущая запись; step(-1)/step(+1) двигают указатель', () => {
    const log = new HistoryLog(base);
    const v1 = bumpLayout(base, 'a');
    log.commit(v1, 'layout');
    expect(log.get()).toEqual({ canUndo: true, canRedo: false });
    expect(log.peekUndo()).toEqual(captureRecord(base, 'layout'));
    log.step(-1);
    expect(log.get()).toEqual({ canUndo: false, canRedo: true });
    expect(log.peekRedo()).toEqual(captureRecord(v1, 'layout'));
    log.step(1);
    expect(log.get()).toEqual({ canUndo: true, canRedo: false });
  });

  it('новый коммит режет redo-хвост', () => {
    const log = new HistoryLog(base);
    log.commit(bumpLayout(base, 'a'), 'layout');
    log.commit(bumpLayout(base, 'b'), 'layout');
    log.step(-1);
    log.step(-1);
    expect(log.get()).toEqual({ canUndo: false, canRedo: true });
    log.commit(bumpLayout(base, 'c'), 'layout');
    expect(log.get()).toEqual({ canUndo: true, canRedo: false });
    log.step(-1);
    expect(log.get()).toEqual({ canUndo: false, canRedo: true });
  });

  describe('коалесинг', () => {
    it('серия с одним ключом = одна запись; undo возвращает к состоянию до серии', () => {
      const log = new HistoryLog(base);
      const v1 = bumpLayout(base, 'a');
      const v2 = bumpLayout(base, 'b');
      log.commit(v1, 'layout', 'k');
      log.commit(v2, 'layout', 'k');
      expect(log.peekUndo()).toEqual(captureRecord(base, 'layout'));
      log.step(-1);
      expect(log.peekRedo()).toEqual(captureRecord(v2, 'layout'));
      expect(log.get()).toEqual({ canUndo: false, canRedo: true });
    });

    it('серию рвут: другой ключ, коммит без ключа, breakSeries, step, reset, коммит в другую зону', () => {
      const scenarios: ((log: HistoryLog) => void)[] = [
        log => log.commit(bumpLayout(base, 'x'), 'layout', 'other'),
        log => log.commit(bumpLayout(base, 'x'), 'layout'),
        log => log.breakSeries(),
        log => {
          log.step(-1);
          log.step(1);
        },
        log => log.commit(bumpScene(base, 'x'), 'scene', 'k'),
      ];
      for (const breaker of scenarios) {
        const log = new HistoryLog(base);
        log.commit(bumpLayout(base, 'a'), 'layout', 'k');
        breaker(log);
        log.setViewZone('constructor');
        log.commit(bumpLayout(base, 'b'), 'layout', 'k');
        // Записи «a» и «b» разделены: undo с «b» ведёт на состояние после разрыва, а не на baseline.
        expect(log.peekUndo()).not.toEqual(captureRecord(base, 'layout'));
        log.step(-1);
        expect(log.get().canUndo).toBe(true);
      }
      const log = new HistoryLog(base);
      log.commit(bumpLayout(base, 'a'), 'layout', 'k');
      log.reset(base);
      expect(log.get()).toEqual({ canUndo: false, canRedo: false });
      log.commit(bumpLayout(base, 'b'), 'layout', 'k');
      log.step(-1);
      expect(log.get()).toEqual({ canUndo: false, canRedo: true });
    });

    it('смена вида серию не рвёт', () => {
      const log = new HistoryLog(base);
      log.commit(bumpLayout(base, 'a'), 'layout', 'k');
      log.setViewZone('plan');
      log.setViewZone('constructor');
      log.commit(bumpLayout(base, 'b'), 'layout', 'k');
      log.step(-1);
      expect(log.get()).toEqual({ canUndo: false, canRedo: true });
    });
  });

  describe('лимит MAX_HISTORY', () => {
    it('101-й push вытесняет старейшую запись, baseline сдвигается, canUndo остаётся', () => {
      const log = new HistoryLog(base);
      const versions: PlannerDocument[] = [];
      for (let i = 0; i <= MAX_HISTORY; i++) {
        const v = bumpLayout(base, `v${i}`);
        versions.push(v);
        log.commit(v, 'layout');
      }
      // Откат до упора: baseline — versions[0], а не base.
      let steps = 0;
      while (log.get().canUndo) {
        log.step(-1);
        steps++;
      }
      expect(steps).toBe(MAX_HISTORY);
      expect(log.peekRedo()).toEqual(captureRecord(versions[1]!, 'layout'));
      log.step(1);
      log.step(-1);
      expect(log.get().canUndo).toBe(false);
    });

    it('замена по коалесингу длину не меняет и trim не зовёт', () => {
      const log = new HistoryLog(base);
      for (let i = 0; i < MAX_HISTORY; i++) log.commit(bumpLayout(base, `v${i}`), 'layout');
      log.commit(bumpLayout(base, 'k1'), 'layout', 'k');
      log.commit(bumpLayout(base, 'k2'), 'layout', 'k');
      log.commit(bumpLayout(base, 'k3'), 'layout', 'k');
      let steps = 0;
      while (log.get().canUndo) {
        log.step(-1);
        steps++;
      }
      expect(steps).toBe(MAX_HISTORY);
      // 100 обычных + 1 запись серии = 101 сверх `base` → вытеснен ровно один (`base`), baseline = v0.
      expect(log.peekRedo()).toEqual(captureRecord(bumpLayout(base, 'v1'), 'layout'));
    });
  });

  describe('две зоны и активная зона', () => {
    it('контейнеры независимы: коммит в layout не трогает scene, флаги — по активной зоне', () => {
      const log = new HistoryLog(base);
      log.commit(bumpLayout(base, 'a'), 'layout');
      expect(log.getActiveZone()).toBe('layout');
      log.setViewZone('plan');
      expect(log.getActiveZone()).toBe('scene');
      expect(log.get()).toEqual({ canUndo: false, canRedo: false });
      log.commit(bumpScene(base, 's'), 'scene');
      expect(log.get()).toEqual({ canUndo: true, canRedo: false });
      log.setViewZone('constructor');
      expect(log.get()).toEqual({ canUndo: true, canRedo: false });
    });

    it('последняя запись переключает активную зону до следующей смены вида (D4)', () => {
      const log = new HistoryLog(base);
      log.setViewZone('plan');
      log.commit(bumpLayout(base, 'a'), 'layout');
      expect(log.getActiveZone()).toBe('layout');
      expect(log.peekUndo()?.zone).toBe('layout');
      log.setViewZone('orbit');
      expect(log.getActiveZone()).toBe('scene');
    });
  });
});
