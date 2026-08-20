import type { PlannerLogger } from '../engine/PlannerManager';
import { createPlanner, type PlannerCanvases } from './createPlanner';

const mockThreeCtor = jest.fn();
const mockThreeDispose = jest.fn();
const mockCanvas2dCtor = jest.fn();
const mockCanvas2dDispose = jest.fn();
const mockCanvas2dPanByKeyboard = jest.fn();
const mockCanvas2dSetPanModifier = jest.fn();
const mockKeyboardCtor = jest.fn();
const mockKeyboardDispose = jest.fn();

// WebGL в Node/jsdom недоступен — проекция подменяется; реальный рендерер проверяет Playwright-гвард (ADR 0015 A9).
jest.mock('./three/ThreeProjection', () => ({
  ThreeProjection: class {
    constructor(...args: unknown[]) {
      mockThreeCtor(...args);
    }
    dispose(): void {
      mockThreeDispose();
    }
  },
}));

// 2D-контекста в Node/jsdom тоже нет — проекция конструктора подменяется (её поведение проверяет
// `canvas2d/Canvas2dProjection.test.ts`); здесь важен только порядок подъёма/освобождения.
jest.mock('./canvas2d/Canvas2dProjection', () => ({
  Canvas2dProjection: class {
    constructor(...args: unknown[]) {
      mockCanvas2dCtor(...args);
    }
    dispose(): void {
      mockCanvas2dDispose();
    }
    panByKeyboard(...args: unknown[]): boolean {
      mockCanvas2dPanByKeyboard(...args);
      return true;
    }
    setPanModifier(...args: unknown[]): void {
      mockCanvas2dSetPanModifier(...args);
    }
  },
}));

// Владелец клавиатуры вешает слушатели на `window` — в node-окружении его тоже подменяем, зато проверяем,
// какие делегаты `createPlanner` ему отдал.
jest.mock('./input/keyboard', () => ({
  KeyboardInput: class {
    constructor(...args: unknown[]) {
      mockKeyboardCtor(...args);
    }
    dispose(): void {
      mockKeyboardDispose();
    }
  },
}));

const createLogger = (): PlannerLogger & { debug: jest.Mock; error: jest.Mock } => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

/** Пара канвасов-заглушек: реальному коду фабрики от `canvas2d` нужен только `ownerDocument.defaultView`. */
const createCanvases = (defaultView: unknown = {}): PlannerCanvases => ({
  three: {} as HTMLCanvasElement,
  canvas2d: { ownerDocument: { defaultView } } as unknown as HTMLCanvasElement,
});

/** Порядковый номер вызова мока — по нему сверяется последовательность подъёма без общего журнала. */
const callOrder = (mock: jest.Mock, index = 0): number => mock.mock.invocationCallOrder[index] as number;

beforeEach(() => {
  for (const mock of [
    mockThreeCtor,
    mockThreeDispose,
    mockCanvas2dCtor,
    mockCanvas2dDispose,
    mockCanvas2dPanByKeyboard,
    mockCanvas2dSetPanModifier,
    mockKeyboardCtor,
    mockKeyboardDispose,
  ]) {
    mock.mockReset();
  }
});

describe('createPlanner — композиционный корень (ADR 0015 A7, ADR 0020 P6)', () => {
  it('поднимает движок и обе проекции: каждая получает менеджер и свой канвас', () => {
    const canvas = createCanvases();
    const logger = createLogger();
    const planner = createPlanner({ canvas, projectId: 'p-1', logger });

    expect(planner.manager.projectId).toBe('p-1');
    expect(mockThreeCtor).toHaveBeenCalledTimes(1);
    expect(mockCanvas2dCtor).toHaveBeenCalledTimes(1);

    const [threeManager, threeCanvas] = mockThreeCtor.mock.calls[0]!;
    expect(threeManager).toBe(planner.manager);
    expect(threeCanvas).toBe(canvas.three);

    const [canvas2dManager, canvas2dCanvas] = mockCanvas2dCtor.mock.calls[0]!;
    expect(canvas2dManager).toBe(planner.manager);
    expect(canvas2dCanvas).toBe(canvas.canvas2d);

    expect(planner.projections.three).toBeDefined();
    expect(planner.projections.canvas2d).toBeDefined();
  });

  it('порядок подъёма: менеджер → Three → Canvas2D → клавиатура', () => {
    const logger = createLogger();
    createPlanner({ canvas: createCanvases(), projectId: 'p-1', logger });

    const managerCreated = logger.debug.mock.calls.findIndex(call => /PlannerManager created/.test(String(call[0])));
    expect(managerCreated).toBe(0);
    expect(callOrder(mockThreeCtor)).toBeLessThan(callOrder(mockCanvas2dCtor));
    expect(callOrder(mockCanvas2dCtor)).toBeLessThan(callOrder(mockKeyboardCtor));
  });

  it('frameBudget и логгер доезжают до обеих проекций', () => {
    const logger = createLogger();
    createPlanner({ canvas: createCanvases(), projectId: 'p-1', logger, frameBudget: 3 });

    expect(mockThreeCtor.mock.calls[0]![2]).toEqual({ frameBudget: 3, logger });
    expect(mockCanvas2dCtor.mock.calls[0]![2]).toEqual({ frameBudget: 3, logger });
  });

  it('клавиатура получает окно канваса конструктора и делегаты в Canvas2D-проекцию', () => {
    const view = { id: 'window' };
    const logger = createLogger();
    createPlanner({ canvas: createCanvases(view), projectId: 'p-1', logger });

    const [keyboardManager, keyboardView, options] = mockKeyboardCtor.mock.calls[0]! as [
      unknown,
      unknown,
      { onPan(dx: number, dy: number, factor: number): boolean; onPanModifier(pressed: boolean): void },
    ];
    expect(keyboardManager).toBeDefined();
    expect(keyboardView).toBe(view);

    expect(options.onPan(1, 0, 10)).toBe(true);
    expect(mockCanvas2dPanByKeyboard).toHaveBeenCalledWith(1, 0, 10);
    options.onPanModifier(true);
    expect(mockCanvas2dSetPanModifier).toHaveBeenCalledWith(true);
  });

  it('dispose(): клавиатура → canvas2d → three → менеджер; повторный вызов — no-op', () => {
    const logger = createLogger();
    const planner = createPlanner({ canvas: createCanvases(), projectId: 'p-1', logger });
    const order: string[] = [];
    mockKeyboardDispose.mockImplementation(() => order.push('keyboard'));
    mockCanvas2dDispose.mockImplementation(() => order.push('canvas2d'));
    mockThreeDispose.mockImplementation(() => order.push('three'));
    logger.debug.mockImplementation((message: string) => {
      if (/PlannerManager disposed/.test(message)) order.push('manager');
    });

    planner.dispose();
    planner.dispose();

    expect(order).toEqual(['keyboard', 'canvas2d', 'three', 'manager']);
    expect(mockKeyboardDispose).toHaveBeenCalledTimes(1);
    expect(mockCanvas2dDispose).toHaveBeenCalledTimes(1);
    expect(mockThreeDispose).toHaveBeenCalledTimes(1);
  });

  it('если Three-проекция не поднялась — освобождается менеджер, ошибка пробрасывается', () => {
    const logger = createLogger();
    mockThreeCtor.mockImplementation(() => {
      throw new Error('Error creating WebGL context.');
    });

    expect(() => createPlanner({ canvas: createCanvases(), projectId: 'p-1', logger })).toThrow(
      'Error creating WebGL context.',
    );
    expect(logger.debug.mock.calls.some(call => /PlannerManager disposed/.test(String(call[0])))).toBe(true);
    expect(mockCanvas2dCtor).not.toHaveBeenCalled();
    expect(mockThreeDispose).not.toHaveBeenCalled();
    expect(mockKeyboardCtor).not.toHaveBeenCalled();
  });

  it('если Canvas2D-проекция не поднялась — освобождаются Three-проекция и менеджер (полуживого планера нет)', () => {
    const logger = createLogger();
    const order: string[] = [];
    mockThreeDispose.mockImplementation(() => order.push('three'));
    logger.debug.mockImplementation((message: string) => {
      if (/PlannerManager disposed/.test(message)) order.push('manager');
    });
    mockCanvas2dCtor.mockImplementation(() => {
      throw new Error('canvas 2d context is not available');
    });

    expect(() => createPlanner({ canvas: createCanvases(), projectId: 'p-1', logger })).toThrow(
      'canvas 2d context is not available',
    );
    expect(order).toEqual(['three', 'manager']);
    expect(mockCanvas2dDispose).not.toHaveBeenCalled();
    expect(mockKeyboardCtor).not.toHaveBeenCalled();
  });

  it('если не поднялась клавиатура — освобождаются обе проекции и менеджер', () => {
    const logger = createLogger();
    const order: string[] = [];
    mockCanvas2dDispose.mockImplementation(() => order.push('canvas2d'));
    mockThreeDispose.mockImplementation(() => order.push('three'));
    logger.debug.mockImplementation((message: string) => {
      if (/PlannerManager disposed/.test(message)) order.push('manager');
    });
    mockKeyboardCtor.mockImplementation(() => {
      throw new Error('keyboard failed');
    });

    expect(() => createPlanner({ canvas: createCanvases(), projectId: 'p-1', logger })).toThrow('keyboard failed');
    expect(order).toEqual(['canvas2d', 'three', 'manager']);
  });

  it('канвас конструктора вне документа с окном — ошибка, всё поднятое освобождается', () => {
    const logger = createLogger();
    const order: string[] = [];
    mockCanvas2dDispose.mockImplementation(() => order.push('canvas2d'));
    mockThreeDispose.mockImplementation(() => order.push('three'));
    logger.debug.mockImplementation((message: string) => {
      if (/PlannerManager disposed/.test(message)) order.push('manager');
    });

    expect(() => createPlanner({ canvas: createCanvases(null), projectId: 'p-1', logger })).toThrow(
      /canvas must belong to a document with a window/,
    );
    expect(order).toEqual(['canvas2d', 'three', 'manager']);
  });
});
