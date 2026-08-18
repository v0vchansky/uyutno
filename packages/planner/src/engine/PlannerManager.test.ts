import { createEmptyDocument, type PlannerDocument } from '../document/PlannerDocument';
import { PlannerManager, type PlannerLogger } from './PlannerManager';
import type { PlannerEventType } from './PlannerBus';

const silentLogger: PlannerLogger = { debug() {}, info() {}, warn() {}, error() {} };

const createManager = (document?: PlannerDocument): { manager: PlannerManager; events: PlannerEventType[] } => {
  const manager = new PlannerManager({ projectId: 'p-1', logger: silentLogger, document });
  const events: PlannerEventType[] = [];
  manager.on('document:changed', () => events.push('document:changed'));
  manager.on('view:changed', () => events.push('view:changed'));
  manager.on('history:changed', () => events.push('history:changed'));
  return { manager, events };
};

describe('PlannerManager', () => {
  describe('конструктор', () => {
    it('без документа создаёт пустой проект; projectId сохранён', () => {
      const { manager } = createManager();
      expect(manager.projectId).toBe('p-1');
      expect(manager.document.get().floors).toHaveLength(1);
      expect(manager.view.get().activeView).toBe('constructor');
    });

    it('принимает начальный документ и замораживает его', () => {
      const initial = createEmptyDocument();
      initial.settings.units = 'mm';
      const { manager } = createManager(initial);
      expect(manager.document.get()).toBe(initial);
      expect(Object.isFrozen(initial.settings)).toBe(true);
    });

    it('логирует создание и dispose через DI-логгер', () => {
      const debug = jest.fn();
      const manager = new PlannerManager({ projectId: 'p-2', logger: { ...silentLogger, debug } });
      manager.dispose();
      expect(debug).toHaveBeenCalledTimes(2);
      expect(debug.mock.calls[0]![1]).toEqual({ projectId: 'p-2' });
    });
  });

  describe('document', () => {
    it('get() — стабильная замороженная ссылка между вызовами', () => {
      const { manager } = createManager();
      expect(manager.document.get()).toBe(manager.document.get());
      expect(Object.isFrozen(manager.document.get())).toBe(true);
    });

    it('getDerived() — снимок производного по этажам', () => {
      const { manager } = createManager();
      expect(manager.document.getDerived().floors.map(f => f.id)).toEqual(manager.document.get().floors.map(f => f.id));
      expect(manager.document.getDerived()).toBe(manager.document.getDerived());
    });

    describe('setSettings', () => {
      it('меняет units и wallHeight одной транзакцией → одно document:changed', () => {
        const { manager, events } = createManager();
        const result = manager.document.setSettings({ units: 'm', wallHeight: 300 });
        expect(result).toEqual({ ok: true, value: undefined });
        expect(manager.document.get().settings).toEqual({ units: 'm', wallHeight: 300 });
        expect(events).toEqual(['document:changed']);
      });

      it('частичный patch не трогает остальные поля и не пишет undefined', () => {
        const { manager } = createManager();
        manager.document.setSettings({ units: 'ftin' });
        expect(manager.document.get().settings).toEqual({ units: 'ftin', wallHeight: 280 });
        manager.document.setSettings({ wallHeight: 260, units: undefined });
        expect(manager.document.get().settings).toEqual({ units: 'ftin', wallHeight: 260 });
        expect('units' in manager.document.get().settings).toBe(true);
      });

      it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'wallHeight = %p → invalid-wall-height, документ и события не тронуты',
        wallHeight => {
          const { manager, events } = createManager();
          const before = manager.document.get();
          const result = manager.document.setSettings({ wallHeight });
          expect(result).toEqual({ ok: false, error: { kind: 'invalid-wall-height', wallHeight } });
          expect(manager.document.get()).toBe(before);
          expect(events).toEqual([]);
        },
      );

      it('units вне UNITS → invalid-units (вход из сырого JSON шага 3)', () => {
        const { manager, events } = createManager();
        const units = 'inch' as unknown as 'cm';
        expect(manager.document.setSettings({ units })).toEqual({ ok: false, error: { kind: 'invalid-units', units } });
        expect(events).toEqual([]);
      });

      it('граница: wallHeight = 0.001 валиден', () => {
        const { manager } = createManager();
        expect(manager.document.setSettings({ wallHeight: 0.001 }).ok).toBe(true);
      });

      it('те же значения — no-op: снимок и события не меняются', () => {
        const { manager, events } = createManager();
        const before = manager.document.get();
        expect(manager.document.setSettings({ units: 'cm', wallHeight: 280 }).ok).toBe(true);
        expect(manager.document.setSettings({}).ok).toBe(true);
        expect(manager.document.get()).toBe(before);
        expect(events).toEqual([]);
      });
    });

    describe('load', () => {
      it('заменяет документ, замораживает его, эмитит document:changed и view:changed', () => {
        const { manager, events } = createManager();
        const incoming = createEmptyDocument();
        incoming.settings.wallHeight = 240;
        incoming.view.activeView = 'plan';

        const result = manager.document.load(incoming);

        expect(result.ok).toBe(true);
        expect(manager.document.get()).toBe(incoming);
        expect(Object.isFrozen(incoming.floors[0]!.layout)).toBe(true);
        expect(manager.view.get().activeView).toBe('plan');
        expect(manager.document.getDerived().floors[0]!.id).toBe(incoming.floors[0]!.id);
        expect(events).toEqual(['document:changed', 'view:changed']);
      });

      it('load того же снимка — ok без событий; load JSON-копии — эквивалентный документ (round-trip B5)', () => {
        const { manager, events } = createManager();
        manager.view.setCamera('plan', { x: 12.5, y: -3, zoom: 0.25 });
        events.length = 0;
        const snapshot = manager.document.get();

        expect(manager.document.load(snapshot).ok).toBe(true);
        expect(manager.document.get()).toBe(snapshot);
        expect(events).toEqual([]);

        const copy = JSON.parse(JSON.stringify(snapshot)) as PlannerDocument;
        expect(manager.document.load(copy).ok).toBe(true);
        expect(manager.document.get()).toBe(copy);
        expect(manager.document.get()).toEqual(snapshot);
        expect(events).toEqual(['document:changed', 'view:changed']);
      });

      it.each([null, undefined, 42, 'doc'])('не объект (%p) → unsupported-format, без исключения', input => {
        const { manager, events } = createManager();
        const result = manager.document.load(input as unknown as PlannerDocument);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.kind).toBe('unsupported-format');
        expect(events).toEqual([]);
      });

      it('чужой format → unsupported-format, документ не тронут', () => {
        const { manager, events } = createManager();
        const before = manager.document.get();
        const incoming = { ...createEmptyDocument(), format: 'other' } as unknown as PlannerDocument;
        expect(manager.document.load(incoming)).toEqual({
          ok: false,
          error: { kind: 'unsupported-format', format: 'other' },
        });
        expect(manager.document.get()).toBe(before);
        expect(events).toEqual([]);
      });

      it.each([0, 2, 1.5, -1, Number.NaN, '1' as unknown as number])(
        'version = %p → unsupported-version (поддерживается только 1)',
        version => {
          const { manager, events } = createManager();
          const incoming = { ...createEmptyDocument(), version };
          expect(manager.document.load(incoming)).toEqual({
            ok: false,
            error: { kind: 'unsupported-version', version, supported: 1 },
          });
          expect(events).toEqual([]);
        },
      );
    });
  });

  describe('view', () => {
    it('get() возвращает Document.view — та же ссылка, что в document.get().view', () => {
      const { manager } = createManager();
      expect(manager.view.get()).toBe(manager.document.get().view);
    });

    it('setActive → одно view:changed, document:changed нет, производное не пересобирается', () => {
      const { manager, events } = createManager();
      const derived = manager.document.getDerived();
      expect(manager.view.setActive('orbit')).toEqual({ ok: true, value: undefined });
      expect(manager.view.get().activeView).toBe('orbit');
      expect(events).toEqual(['view:changed']);
      expect(manager.document.getDerived()).toBe(derived);
    });

    it('setActive с неизвестным видом → invalid-view', () => {
      const { manager, events } = createManager();
      const view = 'iso' as unknown as 'plan';
      expect(manager.view.setActive(view)).toEqual({ ok: false, error: { kind: 'invalid-view', view } });
      expect(events).toEqual([]);
    });

    it('setActive на тот же вид — no-op', () => {
      const { manager, events } = createManager();
      const before = manager.view.get();
      manager.view.setActive('constructor');
      expect(manager.view.get()).toBe(before);
      expect(events).toEqual([]);
    });

    describe('setCamera', () => {
      it('пишет камеру вида, остальные камеры сохраняют ссылку, событие одно', () => {
        const { manager, events } = createManager();
        const before = manager.view.get();
        const result = manager.view.setCamera('plan', { x: 120.5, y: -40, zoom: 1 });
        expect(result.ok).toBe(true);
        const after = manager.view.get();
        expect(after.cameras.plan).toEqual({ x: 120.5, y: -40, zoom: 1 });
        expect(after.cameras.orbit).toBe(before.cameras.orbit);
        expect(after.cameras.walk).toBe(before.cameras.walk);
        expect(after.activeView).toBe(before.activeView);
        expect(events).toEqual(['view:changed']);
      });

      it('типизирована по виду: orbit и walk принимают свои поля', () => {
        const { manager } = createManager();
        expect(manager.view.setCamera('orbit', { x: 1, y: 2, elevation: 110, pan: 90, tilt: 30, zoom: 0 }).ok).toBe(
          true,
        );
        expect(manager.view.setCamera('walk', { x: 5, y: 5, pan: 180, tilt: -10 }).ok).toBe(true);
        expect(manager.view.get().cameras.orbit.pan).toBe(90);
        expect(manager.view.get().cameras.walk.tilt).toBe(-10);
      });

      it('переданный объект камеры не становится частью снимка (копируется поимённо)', () => {
        const { manager } = createManager();
        const camera = { x: 1, y: 1, zoom: 0.5 };
        manager.view.setCamera('plan', camera);
        expect(manager.view.get().cameras.plan).not.toBe(camera);
        expect(Object.isFrozen(camera)).toBe(false);
      });

      it.each([
        ['x', Number.NaN],
        ['y', Number.POSITIVE_INFINITY],
        ['zoom', Number.NEGATIVE_INFINITY],
        ['zoom', -0.001],
        ['zoom', 1.001],
      ])('поле %s = %p → invalid-camera, вид не тронут', (field, value) => {
        const { manager, events } = createManager();
        const before = manager.view.get();
        const camera = { x: 0, y: 0, zoom: 0.5, [field]: value };
        expect(manager.view.setCamera('plan', camera)).toEqual({
          ok: false,
          error: { kind: 'invalid-camera', view: 'plan', field, value },
        });
        expect(manager.view.get()).toBe(before);
        expect(events).toEqual([]);
      });

      it('orbit: zoom вне [0,1] и walk: NaN tilt → invalid-camera своего вида', () => {
        const { manager } = createManager();
        expect(manager.view.setCamera('orbit', { x: 0, y: 0, elevation: 110, pan: 0, tilt: 0, zoom: 1.5 })).toEqual({
          ok: false,
          error: { kind: 'invalid-camera', view: 'orbit', field: 'zoom', value: 1.5 },
        });
        expect(manager.view.setCamera('walk', { x: 0, y: 0, pan: 0, tilt: Number.NaN })).toEqual({
          ok: false,
          error: { kind: 'invalid-camera', view: 'walk', field: 'tilt', value: Number.NaN },
        });
      });

      it('схема камеры: лишнее поле → invalid-camera, в документ не попадает', () => {
        const { manager, events } = createManager();
        const camera = { x: 0, y: 0, zoom: 0.5, fov: 60 } as unknown as { x: number; y: number; zoom: number };
        expect(manager.view.setCamera('plan', camera)).toEqual({
          ok: false,
          error: { kind: 'invalid-camera', view: 'plan', field: 'fov', value: 60 },
        });
        expect(events).toEqual([]);
        expect('fov' in manager.view.get().cameras.plan).toBe(false);
      });

      it('схема камеры: недостающее поле → invalid-camera (partial-патч не допускается)', () => {
        const { manager, events } = createManager();
        const camera = { x: 1, y: 1 } as unknown as { x: number; y: number; zoom: number };
        expect(manager.view.setCamera('plan', camera)).toEqual({
          ok: false,
          error: { kind: 'invalid-camera', view: 'plan', field: 'zoom', value: undefined },
        });
        expect(events).toEqual([]);
      });

      it('нечисловое поле (строка) → invalid-camera', () => {
        const { manager } = createManager();
        const camera = { x: '1', y: 0, zoom: 0.5 } as unknown as { x: number; y: number; zoom: number };
        expect(manager.view.setCamera('plan', camera)).toEqual({
          ok: false,
          error: { kind: 'invalid-camera', view: 'plan', field: 'x', value: '1' },
        });
      });

      it('неизвестный вид → invalid-view', () => {
        const { manager } = createManager();
        const view = 'constructor' as unknown as 'plan';
        expect(manager.view.setCamera(view, { x: 0, y: 0, zoom: 0.5 })).toEqual({
          ok: false,
          error: { kind: 'invalid-view', view: 'constructor' },
        });
        expect(manager.view.resetCamera(view)).toEqual({
          ok: false,
          error: { kind: 'invalid-view', view: 'constructor' },
        });
      });

      it('координаты квантуются до 0.001 см, -0 нормализуется в 0 во всех полях (B1/B5)', () => {
        const { manager } = createManager();
        expect(manager.view.setCamera('plan', { x: 0.1 + 0.2, y: -0, zoom: -0 }).ok).toBe(true);
        const plan = manager.view.get().cameras.plan;
        expect(plan.x).toBe(0.3);
        expect(Object.is(plan.y, 0)).toBe(true);
        expect(Object.is(plan.zoom, 0)).toBe(true);
        expect(
          manager.view.setCamera('orbit', { x: 1.00049, y: 2, elevation: 110.0006, pan: -0, tilt: 45, zoom: 0.1 }).ok,
        ).toBe(true);
        const orbit = manager.view.get().cameras.orbit;
        expect(orbit.x).toBe(1);
        expect(orbit.elevation).toBe(110.001);
        expect(Object.is(orbit.pan, 0)).toBe(true);
        expect(JSON.parse(JSON.stringify(manager.document.get()))).toEqual(manager.document.get());
      });

      it('границы zoom 0 и 1 валидны', () => {
        const { manager } = createManager();
        expect(manager.view.setCamera('plan', { x: 0, y: 0, zoom: 0 }).ok).toBe(true);
        expect(manager.view.setCamera('plan', { x: 0, y: 0, zoom: 1 }).ok).toBe(true);
      });

      it('те же значения — no-op без события', () => {
        const { manager, events } = createManager();
        const before = manager.view.get();
        expect(manager.view.setCamera('plan', { x: 0, y: 0, zoom: 0.5 }).ok).toBe(true);
        expect(manager.view.get()).toBe(before);
        expect(events).toEqual([]);
      });
    });

    describe('resetCamera', () => {
      it('возвращает камеру вида к дефолту, событие одно', () => {
        const { manager, events } = createManager();
        manager.view.setCamera('orbit', { x: 9, y: 9, elevation: 9, pan: 9, tilt: 9, zoom: 0.9 });
        events.length = 0;
        expect(manager.view.resetCamera('orbit')).toEqual({ ok: true, value: undefined });
        expect(manager.view.get().cameras.orbit).toEqual({ x: 0, y: 0, elevation: 110, pan: 45, tilt: 45, zoom: 0.1 });
        expect(events).toEqual(['view:changed']);
      });

      it('уже дефолтная камера — no-op', () => {
        const { manager, events } = createManager();
        const before = manager.view.get();
        manager.view.resetCamera('walk');
        expect(manager.view.get()).toBe(before);
        expect(events).toEqual([]);
      });
    });
  });

  describe('history (заглушка до ADR D)', () => {
    it('get() — пустая история, стабильная ссылка', () => {
      const { manager } = createManager();
      expect(manager.history.get()).toEqual({ canUndo: false, canRedo: false });
      expect(manager.history.get()).toBe(manager.history.get());
      expect(Object.isFrozen(manager.history.get())).toBe(true);
    });

    it('undo/redo отвечают ошибкой и не порождают событий', () => {
      const { manager, events } = createManager();
      manager.document.setSettings({ wallHeight: 300 });
      events.length = 0;
      expect(manager.history.undo()).toEqual({ ok: false, error: { kind: 'nothing-to-undo' } });
      expect(manager.history.redo()).toEqual({ ok: false, error: { kind: 'nothing-to-redo' } });
      expect(events).toEqual([]);
      expect(manager.document.get().settings.wallHeight).toBe(300);
    });
  });

  describe('подписки', () => {
    it('subscribe — wildcard: вызывается на любое событие, отписка работает', () => {
      const { manager } = createManager();
      const listener = jest.fn();
      const unsubscribe = manager.subscribe(listener);

      manager.document.setSettings({ wallHeight: 300 });
      manager.view.setActive('plan');
      // document:changed + document:dirty-changed + view:changed
      expect(listener).toHaveBeenCalledTimes(3);
      expect(listener).toHaveBeenLastCalledWith();

      unsubscribe();
      manager.view.setActive('orbit');
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it('subscribe — стабильная ссылка, пригодная для useSyncExternalStore без bind', () => {
      const { manager } = createManager();
      const { subscribe } = manager;
      const listener = jest.fn();
      const unsubscribe = subscribe(listener);
      manager.view.setActive('plan');
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it('on — типизированная подписка с payload, отписка работает', () => {
      const { manager } = createManager();
      const handler = jest.fn();
      const off = manager.on('view:changed', handler);

      manager.view.setActive('walk');
      expect(handler).toHaveBeenCalledWith(manager.view.get());
      manager.document.setSettings({ units: 'm' });
      expect(handler).toHaveBeenCalledTimes(1);

      off();
      manager.view.setActive('plan');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('несколько подписчиков независимы; повторная отписка и отписка после dispose не бросают', () => {
      const { manager } = createManager();
      const a = jest.fn();
      const b = jest.fn();
      const offA = manager.subscribe(a);
      manager.subscribe(b);
      offA();
      offA();
      manager.view.setActive('plan');
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
      manager.dispose();
      expect(() => offA()).not.toThrow();
    });

    it('упавший подписчик изолирован: команда возвращает ok, остальные подписчики и второе событие доставлены, ошибка в логгере', () => {
      const error = jest.fn();
      const manager = new PlannerManager({ projectId: 'p', logger: { ...silentLogger, error } });
      const after = jest.fn();
      const viewHandler = jest.fn();
      manager.subscribe(() => {
        throw new Error('boom');
      });
      manager.subscribe(after);
      manager.on('document:changed', () => {
        throw new Error('boom-typed');
      });
      manager.on('view:changed', viewHandler);

      const result = manager.document.load(createEmptyDocument());

      expect(result.ok).toBe(true);
      expect(after).toHaveBeenCalledTimes(2);
      expect(viewHandler).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(3);
      expect(error.mock.calls[0]![0]).toMatch(/subscriber threw/);
    });

    it('on — стрелочное поле: работает после деструктуризации', () => {
      const { manager } = createManager();
      const { on } = manager;
      const handler = jest.fn();
      on('view:changed', handler);
      manager.view.setActive('plan');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('load дёргает wildcard-подписчика по разу на каждое событие', () => {
      const { manager } = createManager();
      const listener = jest.fn();
      manager.subscribe(listener);
      manager.document.load(createEmptyDocument());
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('dispose снимает всех подписчиков; команды после dispose работают, но событий нет', () => {
      const { manager, events } = createManager();
      const listener = jest.fn();
      manager.subscribe(listener);

      manager.dispose();
      expect(manager.view.setActive('plan').ok).toBe(true);
      expect(manager.view.get().activeView).toBe('plan');
      expect(listener).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });
  });
});
