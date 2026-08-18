import { createEmptyDocument, type PlannerDocument } from '../document/PlannerDocument';
import { createPlannerBus, type PlannerBus, type PlannerEventType } from './PlannerBus';
import { PlannerStore } from './PlannerStore';

const isDeepFrozen = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(isDeepFrozen);
};

const recordEvents = (bus: PlannerBus): PlannerEventType[] => {
  const log: PlannerEventType[] = [];
  bus.on('*', type => log.push(type));
  return log;
};

describe('PlannerStore', () => {
  let bus: PlannerBus;
  let store: PlannerStore;
  let events: PlannerEventType[];

  beforeEach(() => {
    bus = createPlannerBus();
    store = new PlannerStore(bus, createEmptyDocument());
    events = recordEvents(bus);
  });

  describe('начальное состояние', () => {
    it('снимок документа глубоко заморожен уже при создании (auto-freeze всегда)', () => {
      expect(isDeepFrozen(store.getDocument())).toBe(true);
    });

    it('производное построено при создании и заморожено', () => {
      const derived = store.getDerived();
      expect(derived.floors).toEqual([{ id: store.getDocument().floors[0]!.id }]);
      expect(isDeepFrozen(derived)).toBe(true);
    });

    it('переданный документ замораживается на месте — им теперь владеет движок', () => {
      const initial = createEmptyDocument();
      new PlannerStore(createPlannerBus(), initial);
      expect(Object.isFrozen(initial)).toBe(true);
      expect(Object.isFrozen(initial.floors[0]!.layout)).toBe(true);
    });

    it('создание не порождает событий', () => {
      expect(events).toEqual([]);
    });
  });

  describe('транзакция содержимого', () => {
    it('ровно одно событие document:changed, снимок обновлён до эмита', () => {
      let seenInHandler: PlannerDocument | undefined;
      bus.on('document:changed', ({ document }) => {
        seenInHandler = store.getDocument();
        expect(document).toBe(seenInHandler);
      });

      store.transact(draft => {
        draft.settings.wallHeight = 300;
      });

      expect(events).toEqual(['document:changed']);
      expect(seenInHandler).toBe(store.getDocument());
      expect(store.getDocument().settings.wallHeight).toBe(300);
    });

    it('новый снимок глубоко заморожен, старый не мутирован', () => {
      const before = store.getDocument();
      store.transact(draft => {
        draft.settings.wallHeight = 300;
      });
      const after = store.getDocument();
      expect(after).not.toBe(before);
      expect(before.settings.wallHeight).toBe(280);
      expect(isDeepFrozen(after)).toBe(true);
    });

    it('структурное разделение: неизменённые поддеревья сохраняют ссылку', () => {
      const before = store.getDocument();
      store.transact(draft => {
        draft.settings.wallHeight = 300;
      });
      const after = store.getDocument();
      expect(after.settings).not.toBe(before.settings);
      expect(after.floors).toBe(before.floors);
      expect(after.floors[0]).toBe(before.floors[0]);
      expect(after.view).toBe(before.view);
    });

    it('rebuild выполняется синхронно внутри транзакции: производное заменено к моменту события', () => {
      const derivedBefore = store.getDerived();
      let derivedInHandler: unknown;
      bus.on('document:changed', () => {
        derivedInHandler = store.getDerived();
      });

      store.transact(draft => {
        draft.floors[0]!.scene.hidden.push('x');
      });

      expect(store.getDerived()).not.toBe(derivedBefore);
      expect(derivedInHandler).toBe(store.getDerived());
      expect(isDeepFrozen(store.getDerived())).toBe(true);
    });

    it('замена документа целиком (возврат из рецепта): document:changed + view:changed', () => {
      const replacement = createEmptyDocument();
      replacement.settings.wallHeight = 250;
      replacement.view.activeView = 'plan';

      store.transact(() => replacement);

      expect(events).toEqual(['document:changed', 'view:changed']);
      expect(store.getDocument().settings.wallHeight).toBe(250);
      expect(store.getDocument().view.activeView).toBe('plan');
      expect(isDeepFrozen(store.getDocument())).toBe(true);
      expect(store.getDerived().floors[0]!.id).toBe(replacement.floors[0]!.id);
    });
  });

  describe('транзакция вида', () => {
    it('ровно одно событие view:changed с новым снимком view, без rebuild', () => {
      const derivedBefore = store.getDerived();
      const viewBefore = store.getDocument().view;
      let payload: unknown;
      bus.on('view:changed', view => {
        payload = view;
      });

      store.transact(draft => {
        draft.view.activeView = 'orbit';
      });

      expect(events).toEqual(['view:changed']);
      expect(payload).toBe(store.getDocument().view);
      expect(store.getDocument().view).not.toBe(viewBefore);
      expect(store.getDocument().view.activeView).toBe('orbit');
      expect(store.getDerived()).toBe(derivedBefore);
    });

    it('содержимое при смене вида не трогается: floors/settings — те же ссылки', () => {
      const before = store.getDocument();
      store.transact(draft => {
        draft.view.cameras.plan.zoom = 0.7;
      });
      const after = store.getDocument();
      expect(after.floors).toBe(before.floors);
      expect(after.settings).toBe(before.settings);
      expect(after.view.cameras.orbit).toBe(before.view.cameras.orbit);
      expect(after.view.cameras.plan).not.toBe(before.view.cameras.plan);
    });
  });

  describe('смешанная транзакция и no-op', () => {
    it('содержимое + view в одном рецепте → по одному событию на факт, в порядке document → view', () => {
      store.transact(draft => {
        draft.view.activeView = 'walk';
        draft.settings.units = 'm';
      });
      expect(events).toEqual(['document:changed', 'view:changed']);
    });

    it('рецепт без изменений: снимок и производное те же, событий нет', () => {
      const doc = store.getDocument();
      const derived = store.getDerived();
      store.transact(() => {});
      store.transact(draft => {
        draft.settings.wallHeight = 280;
        draft.view.activeView = 'constructor';
      });
      expect(store.getDocument()).toBe(doc);
      expect(store.getDerived()).toBe(derived);
      expect(events).toEqual([]);
    });

    it('исключение в рецепте не меняет снимок и не порождает событий', () => {
      const doc = store.getDocument();
      expect(() =>
        store.transact(draft => {
          draft.settings.wallHeight = 1;
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(store.getDocument()).toBe(doc);
      expect(events).toEqual([]);
    });
  });
});
