import {
  createPlanner,
  usePlannerManager,
  usePlannerProjections,
  usePlannerSelector,
  Planner,
  type Canvas2dStats,
  type PlannerCanvases,
  type PlannerInstance,
  type PlannerLogger,
  type PlannerProjections,
  type ZoomState,
} from './index';

// WebGL в Node/jsdom недоступен — проекция подменяется; реальный рендерер проверяет Playwright-гвард (ADR 0015 A9).
jest.mock('./projection/three/ThreeProjection', () => ({
  ThreeProjection: class {
    constructor(
      readonly manager: unknown,
      readonly canvas: unknown,
    ) {}
    dispose(): void {}
  },
}));

// 2D-контекста в node-окружении тоже нет — поведение проекции конструктора проверяет её собственный jsdom-тест.
jest.mock('./projection/canvas2d/Canvas2dProjection', () => ({
  Canvas2dProjection: class {
    constructor(
      readonly manager: unknown,
      readonly canvas: unknown,
    ) {}
    dispose(): void {}
    panByKeyboard(): boolean {
      return false;
    }
    setPanModifier(): void {}
  },
}));

const silentLogger: PlannerLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** Пара канвасов-заглушек: фабрике от канваса конструктора нужен только `ownerDocument.defaultView`. */
const createCanvases = (): PlannerCanvases => ({
  three: {} as HTMLCanvasElement,
  canvas2d: {
    ownerDocument: { defaultView: { addEventListener() {}, removeEventListener() {} } },
  } as unknown as HTMLCanvasElement,
});

describe('@uyutno/planner smoke', () => {
  it('createPlanner отдаёт менеджер, обе проекции и dispose; dispose() не бросает', () => {
    const canvas = createCanvases();
    const planner: PlannerInstance = createPlanner({ canvas, projectId: 'p-1', logger: silentLogger });

    expect(planner.manager.projectId).toBe('p-1');
    expect(planner.projections.three.canvas).toBe(canvas.three);
    expect(planner.projections.canvas2d.canvas).toBe(canvas.canvas2d);
    expect(() => planner.dispose()).not.toThrow();
  });

  it('из корня пакета экспортируются React-скин и хуки контекста', () => {
    expect(typeof Planner).toBe('function');
    expect(typeof usePlannerManager).toBe('function');
    expect(typeof usePlannerProjections).toBe('function');
    expect(typeof usePlannerSelector).toBe('function');
  });

  it('публичные типы вьювера конструктора доступны из корня пакета (проверяется компиляцией)', () => {
    const canvases: PlannerCanvases = createCanvases();
    const planner = createPlanner({ canvas: canvases, projectId: 'p-2', logger: silentLogger });
    const projections: PlannerProjections = planner.projections;
    const stats: Canvas2dStats = { frame: 0 };
    const zoom: ZoomState = { index: 20, scale: 1, steps: 41, canZoomIn: true, canZoomOut: true };

    expect(projections.canvas2d).toBeDefined();
    expect(stats.frame).toBe(0);
    expect(zoom.scale).toBe(1);
    planner.dispose();
  });
});
