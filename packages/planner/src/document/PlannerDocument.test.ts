import {
  createDefaultCamera,
  createDefaultView,
  createEmptyDocument,
  createEmptyFloor,
  DEFAULT_WALL_HEIGHT,
  DOCUMENT_FORMAT,
  DOCUMENT_VERSION,
} from './PlannerDocument';

describe('createEmptyDocument', () => {
  it('формат и версия — с первого дня (ADR 0016 B6)', () => {
    const doc = createEmptyDocument();
    expect(doc.format).toBe('uyutno.planner');
    expect(doc.format).toBe(DOCUMENT_FORMAT);
    expect(doc.version).toBe(1);
    expect(doc.version).toBe(DOCUMENT_VERSION);
  });

  it('настройки: см и высота стен 280 (README «Единицы и координаты»)', () => {
    expect(createEmptyDocument().settings).toEqual({ units: 'cm', wallHeight: 280 });
    expect(DEFAULT_WALL_HEIGHT).toBe(280);
  });

  it('ровно один этаж с пустыми layout и scene по скетчу ADR 0016 B3', () => {
    const { floors } = createEmptyDocument();
    expect(floors).toHaveLength(1);
    expect(floors[0]!.layout).toEqual({ points: {}, contours: [], covers: [], areas: [], cuts: [], rooms: [] });
    expect(floors[0]!.scene).toEqual({ items: [], rulers: [], hidden: [] });
  });

  it('новый проект открывается в конструкторе с дефолтными камерами трёх видов (спека 08)', () => {
    const { view } = createEmptyDocument();
    expect(view.activeView).toBe('constructor');
    expect(Object.keys(view.cameras).sort()).toEqual(['orbit', 'plan', 'walk']);
    expect(view.cameras.plan).toEqual({ x: 0, y: 0, zoom: 0.5 });
    expect(view.cameras.orbit).toEqual({ x: 0, y: 0, elevation: 110, pan: 45, tilt: 45, zoom: 0.1 });
    expect(view.cameras.walk).toEqual({ x: 0, y: 0, pan: 0, tilt: 0 });
  });

  it('каждый вызов — независимое дерево с новым id этажа', () => {
    const a = createEmptyDocument();
    const b = createEmptyDocument();
    expect(a).not.toBe(b);
    expect(a.floors[0]!.id).not.toBe(b.floors[0]!.id);
    expect(a.view).not.toBe(b.view);
    expect(a.view.cameras.plan).not.toBe(b.view.cameras.plan);
  });

  it('plain JSON: round-trip через JSON.stringify эквивалентен (ADR 0016 B5)', () => {
    const doc = createEmptyDocument();
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  it('в документе нет undefined-значений (B5)', () => {
    const walk = (value: unknown, path: string): void => {
      expect([path, value]).not.toEqual([path, undefined]);
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
      }
    };
    walk(createEmptyDocument(), 'document');
  });
});

describe('createDefaultCamera / createDefaultView / createEmptyFloor', () => {
  it('createDefaultCamera возвращает свежий объект на каждый вызов', () => {
    expect(createDefaultCamera('plan')).not.toBe(createDefaultCamera('plan'));
    expect(createDefaultCamera('orbit')).toEqual(createDefaultView().cameras.orbit);
    expect(createDefaultCamera('walk')).toEqual(createDefaultView().cameras.walk);
  });

  it('createEmptyFloor даёт этаж с уникальным id и пустыми поддеревьями', () => {
    const floor = createEmptyFloor();
    expect(typeof floor.id).toBe('string');
    expect(floor.id).not.toBe(createEmptyFloor().id);
    expect(floor.layout.points).toEqual({});
    expect(floor.scene.hidden).toEqual([]);
  });
});
