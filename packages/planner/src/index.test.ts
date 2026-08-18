import { createPlanner, type PlannerLogger } from './index';

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

const silentLogger: PlannerLogger = { debug() {}, info() {}, warn() {}, error() {} };

describe('@uyutno/planner smoke', () => {
  it('createPlanner returns manager, projection and dispose; dispose() does not throw', () => {
    const canvas = {} as HTMLCanvasElement;
    const planner = createPlanner({ canvas, projectId: 'p-1', logger: silentLogger });

    expect(planner.manager.projectId).toBe('p-1');
    expect(planner.projection.canvas).toBe(canvas);
    expect(() => planner.dispose()).not.toThrow();
  });
});
