/** @jest-environment jsdom */
import type React from 'react';
import { render, screen } from '@testing-library/react';

import { renderToString } from 'react-dom/server';

import type { PlannerLogger } from '../../engine/PlannerManager';
import type { PlannerInstance } from '../../projection/createPlanner';
import { Planner } from './Planner';
import { usePlannerSelector } from '../usePlannerSelector';

const mockProjectionCtor = jest.fn();

// WebGL в jsdom недоступен — проекция подменяется; реальный рендерер проверяет Playwright-гвард (ADR 0015 A9).
jest.mock('../../projection/three/ThreeProjection', () => ({
  ThreeProjection: class {
    private readonly logger: PlannerLogger;
    constructor(
      readonly manager: { projectId: string },
      readonly canvas: HTMLCanvasElement,
      options: { frameBudget?: number; logger: PlannerLogger },
    ) {
      mockProjectionCtor(manager, canvas, options);
      this.logger = options.logger;
      this.logger.debug('@uyutno/planner: ThreeProjection created', { projectId: manager.projectId });
    }
    dispose(): void {
      this.logger.debug('@uyutno/planner: ThreeProjection disposed', { projectId: this.manager.projectId });
    }
  },
}));

const silentLogger: PlannerLogger = { debug() {}, info() {}, warn() {}, error() {} };

const ActiveView: React.FC = () => {
  const activeView = usePlannerSelector(m => m.view.get().activeView);
  return <span data-testid='active-view'>{activeView}</span>;
};

beforeEach(() => {
  mockProjectionCtor.mockReset();
});

describe('<Planner />', () => {
  it('рендерит canvas с className и поднимает планер, кладя менеджер в контекст для детей', () => {
    const { container } = render(
      <Planner projectId='p-1' logger={silentLogger} className='block h-full w-full'>
        <ActiveView />
      </Planner>,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas!.className).toBe('block h-full w-full');
    expect(screen.getByTestId('active-view').textContent).toBe('constructor');
    // Проекция получила именно этот canvas — владелец canvas один (ADR 0015 A7).
    expect(mockProjectionCtor).toHaveBeenCalledTimes(1);
    expect(mockProjectionCtor.mock.calls[0]![1]).toBe(canvas);
  });

  it('на unmount зовёт dispose: сначала проекция, потом менеджер (по логам заглушки и менеджера)', () => {
    const debug = jest.fn();
    const { unmount } = render(<Planner projectId='p-1' logger={{ ...silentLogger, debug }} />);
    const createdCalls = debug.mock.calls.length;
    unmount();
    const messages = debug.mock.calls.slice(createdCalls).map(call => String(call[0]));
    expect(messages).toEqual(['@uyutno/planner: ThreeProjection disposed', '@uyutno/planner: PlannerManager disposed']);
  });

  it('смена logger-ссылки НЕ пересоздаёт планер, но новые записи идут в новый логгер', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender, unmount } = render(<Planner projectId='p-1' logger={{ ...silentLogger, debug: first }} />);
    expect(first).toHaveBeenCalled();
    first.mockClear();

    rerender(<Planner projectId='p-1' logger={{ ...silentLogger, debug: second }} />);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    unmount();
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls.some(call => /disposed/.test(String(call[0])))).toBe(true);
  });

  it('SSR: renderToString отдаёт canvas, не поднимает планер и не рендерит детей', () => {
    const debug = jest.fn();
    const html = renderToString(
      <Planner projectId='p-ssr' logger={{ ...silentLogger, debug }} className='c'>
        <ActiveView />
      </Planner>,
    );
    expect(html).toContain('<canvas class="c"></canvas>');
    expect(html).not.toContain('active-view');
    expect(debug).not.toHaveBeenCalled();
    expect(mockProjectionCtor).not.toHaveBeenCalled();
  });

  it('смена projectId пересоздаёт планер на новом canvas: старый dispose, новый created', () => {
    const debug = jest.fn();
    const logger = { ...silentLogger, debug };
    const { container, rerender } = render(<Planner projectId='p-1' logger={logger} />);
    const firstCanvas = container.querySelector('canvas');
    debug.mockClear();
    rerender(<Planner projectId='p-2' logger={logger} />);
    const messages = debug.mock.calls.map(call => `${call[0]} ${JSON.stringify(call[1])}`);
    expect(messages.some(m => /disposed/.test(m) && /p-1/.test(m))).toBe(true);
    expect(messages.some(m => /created/.test(m) && /p-2/.test(m))).toBe(true);
    // Контекст старого канваса потерян (`forceContextLoss`) — новому планеру нужен новый элемент.
    const secondCanvas = container.querySelector('canvas');
    expect(secondCanvas).not.toBe(firstCanvas);
    expect(mockProjectionCtor.mock.calls[1]![1]).toBe(secondCanvas);
  });

  it('frameBudget прокидывается в проекцию при монтировании; смена пропса планер не пересоздаёт', () => {
    const { rerender } = render(<Planner projectId='p-1' logger={silentLogger} frameBudget={2} />);
    expect(mockProjectionCtor.mock.calls[0]![2]).toMatchObject({ frameBudget: 2 });
    rerender(<Planner projectId='p-1' logger={silentLogger} frameBudget={7} />);
    expect(mockProjectionCtor).toHaveBeenCalledTimes(1);
  });

  it('onReady получает результат фабрики после подъёма (manager, projection, dispose)', () => {
    const onReady = jest.fn<void, [PlannerInstance]>();
    render(<Planner projectId='p-1' logger={silentLogger} onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
    const planner = onReady.mock.calls[0]![0];
    expect(planner.manager.projectId).toBe('p-1');
    expect(planner.projection).toBeDefined();
    expect(typeof planner.dispose).toBe('function');
  });

  it('смена onReady-ссылки не пересоздаёт планер и не зовёт колбэк повторно', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(<Planner projectId='p-1' logger={silentLogger} onReady={first} />);
    rerender(<Planner projectId='p-1' logger={silentLogger} onReady={second} />);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(mockProjectionCtor).toHaveBeenCalledTimes(1);
  });

  it('без onReady планер поднимается как обычно', () => {
    const { container } = render(
      <Planner projectId='p-1' logger={silentLogger}>
        <ActiveView />
      </Planner>,
    );
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(screen.getByTestId('active-view')).toBeTruthy();
  });

  it('если планер не поднялся (нет WebGL) — ошибка в logger.error, контекст пуст, хост не падает', () => {
    mockProjectionCtor.mockImplementation(() => {
      throw new Error('Error creating WebGL context.');
    });
    const error = jest.fn();
    const onReady = jest.fn();
    const { container, unmount } = render(
      <Planner projectId='p-1' logger={{ ...silentLogger, error }} onReady={onReady}>
        <ActiveView />
      </Planner>,
    );
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(screen.queryByTestId('active-view')).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toMatch(/failed to start planner/);
    expect(() => unmount()).not.toThrow();
  });
});
