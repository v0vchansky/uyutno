import type { PlannerLogger } from '../engine/PlannerManager';
import { createPlanner } from './createPlanner';

const mockProjectionDispose = jest.fn();
const mockProjectionCtor = jest.fn();

// WebGL в Node/jsdom недоступен — проекция подменяется; реальный рендерер проверяет Playwright-гвард (ADR 0015 A9).
jest.mock('./three/ThreeProjection', () => ({
  ThreeProjection: class {
    constructor(...args: unknown[]) {
      mockProjectionCtor(...args);
    }
    dispose(): void {
      mockProjectionDispose();
    }
  },
}));

const createLogger = (): PlannerLogger & { debug: jest.Mock; error: jest.Mock } => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

beforeEach(() => {
  mockProjectionCtor.mockReset();
  mockProjectionDispose.mockReset();
});

describe('createPlanner — композиционный корень (ADR 0015 A7)', () => {
  it('поднимает движок и проекцию: проекция получает менеджер, canvas, frameBudget и логгер', () => {
    const canvas = {} as HTMLCanvasElement;
    const logger = createLogger();
    const planner = createPlanner({ canvas, projectId: 'p-1', logger, frameBudget: 3 });

    expect(planner.manager.projectId).toBe('p-1');
    expect(mockProjectionCtor).toHaveBeenCalledTimes(1);
    const [manager, passedCanvas, options] = mockProjectionCtor.mock.calls[0]!;
    expect(manager).toBe(planner.manager);
    expect(passedCanvas).toBe(canvas);
    expect(options).toEqual({ frameBudget: 3, logger });
  });

  it('dispose(): сначала проекция, потом менеджер; повторный вызов — no-op', () => {
    const logger = createLogger();
    const planner = createPlanner({ canvas: {} as HTMLCanvasElement, projectId: 'p-1', logger });
    const order: string[] = [];
    mockProjectionDispose.mockImplementation(() => order.push('projection'));
    logger.debug.mockImplementation((message: string) => {
      if (/PlannerManager disposed/.test(message)) order.push('manager');
    });

    planner.dispose();
    planner.dispose();
    expect(order).toEqual(['projection', 'manager']);
    expect(mockProjectionDispose).toHaveBeenCalledTimes(1);
  });

  it('если проекция не поднялась — менеджер освобождается, ошибка пробрасывается (полуживого планера нет)', () => {
    const logger = createLogger();
    mockProjectionCtor.mockImplementation(() => {
      throw new Error('Error creating WebGL context.');
    });
    expect(() => createPlanner({ canvas: {} as HTMLCanvasElement, projectId: 'p-1', logger })).toThrow(
      'Error creating WebGL context.',
    );
    expect(logger.debug.mock.calls.some(call => /PlannerManager disposed/.test(String(call[0])))).toBe(true);
    expect(mockProjectionDispose).not.toHaveBeenCalled();
  });
});
