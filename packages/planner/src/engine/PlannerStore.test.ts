import { createEmptyDocument, type PlannerDocument } from '../document/PlannerDocument';
import { createPlanBuilder } from '../document/testing/planBuilder';
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
      expect(derived.floors).toEqual([{ id: store.getDocument().floors[0]!.id, walls: [], rooms: [], axes: [] }]);
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

  describe('нормализация и производное (шаг 2, ADR 0017)', () => {
    const ringDocument = (): PlannerDocument => {
      const b = createPlanBuilder();
      b.ring(0, 0, 400, 300, 10);
      return b.document();
    };

    it('документ с контурами при создании нормализуется: квады слиты в outer + inner, комната заведена', () => {
      const local = new PlannerStore(createPlannerBus(), ringDocument());
      const layout = local.getDocument().floors[0]!.layout;
      expect(layout.contours.map(c => c.kind)).toEqual(['outer', 'inner']);
      expect(layout.rooms).toHaveLength(1);
      expect(isDeepFrozen(local.getDocument())).toBe(true);
    });

    it('производное после создания: стены-треугольники, комната с roomId записи, 4 оси; заморожено', () => {
      const local = new PlannerStore(createPlannerBus(), ringDocument());
      const floor = local.getDerived().floors[0]!;
      const layout = local.getDocument().floors[0]!.layout;
      expect(floor.walls).toHaveLength(1);
      expect(floor.rooms).toHaveLength(1);
      expect(floor.rooms[0]!.roomId).toBe(layout.rooms[0]!.id);
      expect(floor.axes).toHaveLength(4);
      expect(isDeepFrozen(local.getDerived())).toBe(true);
    });

    it('load с непустым layout: document:changed несёт уже пересобранный документ', () => {
      let seen: PlannerDocument | undefined;
      bus.on('document:changed', ({ document }) => {
        seen = document;
      });
      store.transact(() => ringDocument());
      expect(seen!.floors[0]!.layout.contours.map(c => c.kind)).toEqual(['outer', 'inner']);
      expect(seen).toBe(store.getDocument());
      expect(store.getDerived().floors[0]!.rooms).toHaveLength(1);
    });

    it('транзакция settings при непустом layout: layout сохраняет ссылку, производное пересчитано и равно прежнему', () => {
      const local = new PlannerStore(createPlannerBus(), ringDocument());
      const layoutBefore = local.getDocument().floors[0]!.layout;
      const derivedBefore = local.getDerived();
      local.transact(draft => {
        draft.settings.wallHeight = 300;
      });
      expect(local.getDocument().floors[0]!.layout).toBe(layoutBefore);
      expect(local.getDerived()).toEqual(derivedBefore);
    });

    it('сдвиг точки стены: контуры переписаны, запись комнаты та же (anchor по площади), производное новое', () => {
      const local = new PlannerStore(createPlannerBus(), ringDocument());
      const roomBefore = local.getDocument().floors[0]!.layout.rooms[0]!;
      const derivedBefore = local.getDerived();
      local.transact(draft => {
        const layout = draft.floors[0]!.layout;
        layout.points['p2']!.x = 500;
        layout.points['p3']!.x = 500;
        layout.points['p6']!.x = 490;
        layout.points['p7']!.x = 490;
      });
      const layout = local.getDocument().floors[0]!.layout;
      expect(layout.rooms[0]!.id).toBe(roomBefore.id);
      expect(local.getDerived()).not.toBe(derivedBefore);
      expect(local.getDerived().floors[0]!.rooms[0]!.area).toBe(480 * 280);
    });

    it('нормализация одиночной «Комнаты по точкам» заводит запись rooms[] сама — предупреждений нет', () => {
      const warnings: string[] = [];
      const b = createPlanBuilder();
      b.contour('inner', [b.point(0, 0), b.point(300, 0), b.point(300, 200), b.point(0, 200)]);
      const local = new PlannerStore(createPlannerBus(), b.document(), { warn: m => warnings.push(m) });
      expect(warnings).toEqual([]);
      expect(local.getDocument().floors[0]!.layout.rooms).toHaveLength(1);
      expect(local.getDerived().floors[0]!.rooms).toHaveLength(1);
    });
  });
});
