import { createPlanner, type PlannerLogger } from './index';

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
