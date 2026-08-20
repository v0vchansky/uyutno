/** @jest-environment jsdom */
import type React from 'react';
import { act, render, screen } from '@testing-library/react';

import { renderToString } from 'react-dom/server';

import type { PlannerLogger } from '../../engine/PlannerManager';
import { ringDocument } from '../../engine/testing/testManager';
import type { PlannerInstance } from '../../projection/createPlanner';
import { Planner } from './Planner';
import { usePlannerSelector } from '../usePlannerSelector';

const mockThreeCtor = jest.fn();
const mockCanvas2dCtor = jest.fn();

// WebGL в jsdom недоступен — проекция подменяется; реальный рендерер проверяет Playwright-гвард (ADR 0015 A9).
jest.mock('../../projection/three/ThreeProjection', () => ({
  ThreeProjection: class {
    private readonly logger: PlannerLogger;
    constructor(
      readonly manager: { projectId: string },
      readonly canvas: HTMLCanvasElement,
      options: { frameBudget?: number; logger: PlannerLogger },
    ) {
      mockThreeCtor(manager, canvas, options);
      this.logger = options.logger;
      this.logger.debug('@uyutno/planner: ThreeProjection created', { projectId: manager.projectId });
    }
    dispose(): void {
      this.logger.debug('@uyutno/planner: ThreeProjection disposed', { projectId: this.manager.projectId });
    }
  },
}));

// 2D-контекста jsdom не даёт (ADR 0020 P7) — проекция конструктора подменяется; её поведение проверяет
// `projection/canvas2d/Canvas2dProjection.test.ts`, здесь важна только разводка канвасов и жизненный цикл.
jest.mock('../../projection/canvas2d/Canvas2dProjection', () => ({
  Canvas2dProjection: class {
    private readonly logger: PlannerLogger;
    constructor(
      readonly manager: { projectId: string },
      readonly canvas: HTMLCanvasElement,
      options: { frameBudget?: number; logger: PlannerLogger },
    ) {
      mockCanvas2dCtor(manager, canvas, options);
      this.logger = options.logger;
      this.logger.debug('@uyutno/planner: Canvas2dProjection created', { projectId: manager.projectId });
    }
    dispose(): void {
      this.logger.debug('@uyutno/planner: Canvas2dProjection disposed', { projectId: this.manager.projectId });
    }
    panByKeyboard(): boolean {
      return false;
    }
    setPanModifier(): void {}
  },
}));

const silentLogger: PlannerLogger = { debug() {}, info() {}, warn() {}, error() {} };

const ActiveView: React.FC = () => {
  const activeView = usePlannerSelector(m => m.view.get().activeView);
  return <span data-testid='active-view'>{activeView}</span>;
};

/** Канвасы в порядке DOM: Three снизу, Canvas2D конструктора сверху (ADR 0020 P6). */
const canvasesOf = (container: HTMLElement): { three: HTMLCanvasElement; canvas2d: HTMLCanvasElement } => {
  const list = container.querySelectorAll('canvas');
  expect(list).toHaveLength(2);
  return { three: list[0] as HTMLCanvasElement, canvas2d: list[1] as HTMLCanvasElement };
};

const captureInstance = () => {
  const captured: { current: PlannerInstance | null } = { current: null };
  const onReady = (planner: PlannerInstance): void => {
    captured.current = planner;
  };
  return { captured, onReady };
};

beforeEach(() => {
  mockThreeCtor.mockReset();
  mockCanvas2dCtor.mockReset();
});

describe('<Planner />', () => {
  it('рендерит контейнер с className и два канваса внутри; каждая проекция получает свой канвас', () => {
    const { container } = render(
      <Planner projectId='p-1' logger={silentLogger} className='block h-full w-full'>
        <ActiveView />
      </Planner>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe('DIV');
    expect(root.className).toBe('block h-full w-full');
    expect(root.style.position).toBe('relative');

    const { three, canvas2d } = canvasesOf(container);
    expect(three.className).toBe('');
    expect(screen.getByTestId('active-view').textContent).toBe('constructor');
    // Владелец канвасов один: элементы создаёт React и отдаёт их фабрике (ADR 0015 A7).
    expect(mockThreeCtor).toHaveBeenCalledTimes(1);
    expect(mockThreeCtor.mock.calls[0]![1]).toBe(three);
    expect(mockCanvas2dCtor).toHaveBeenCalledTimes(1);
    expect(mockCanvas2dCtor.mock.calls[0]![1]).toBe(canvas2d);
  });

  it('в конструкторе виден канвас конструктора, Three скрыт; после view.setActive(plan) — наоборот', () => {
    const { captured, onReady } = captureInstance();
    const { container } = render(<Planner projectId='p-1' logger={silentLogger} onReady={onReady} />);
    const { three, canvas2d } = canvasesOf(container);

    expect(canvas2d.hidden).toBe(false);
    expect(canvas2d.style.display).toBe('block');
    expect(three.hidden).toBe(true);
    expect(three.style.display).toBe('none');

    act(() => {
      captured.current!.manager.view.setActive('plan');
    });

    expect(canvas2d.hidden).toBe(true);
    expect(canvas2d.style.display).toBe('none');
    expect(three.hidden).toBe(false);
    expect(three.style.display).toBe('block');
  });

  it('канвас конструктора — role="img" с описанием плана, которое обновляется при смене геометрии', () => {
    const { captured, onReady } = captureInstance();
    const { container } = render(<Planner projectId='p-1' logger={silentLogger} onReady={onReady} />);
    const { three, canvas2d } = canvasesOf(container);

    expect(canvas2d.getAttribute('role')).toBe('img');
    expect(canvas2d.getAttribute('aria-label')).toBe('план: 0 комнат, 0,0 м²');
    // Описание — только у холста конструктора: Three-канвас графикой с текстовым эквивалентом не считается.
    expect(three.getAttribute('role')).toBeNull();

    act(() => {
      captured.current!.manager.document.load(ringDocument());
    });
    expect(canvas2d.getAttribute('aria-label')).toMatch(/^план: 1 комната, \d+,\d м²$/);
  });

  it('onReady получает результат фабрики после подъёма: менеджер, обе проекции и dispose', () => {
    const onReady = jest.fn<void, [PlannerInstance]>();
    const { container } = render(<Planner projectId='p-1' logger={silentLogger} onReady={onReady} />);
    const { three, canvas2d } = canvasesOf(container);

    expect(onReady).toHaveBeenCalledTimes(1);
    const planner = onReady.mock.calls[0]![0];
    expect(planner.manager.projectId).toBe('p-1');
    expect(planner.projections.three.canvas).toBe(three);
    expect(planner.projections.canvas2d.canvas).toBe(canvas2d);
    expect(typeof planner.dispose).toBe('function');
  });

  it('на unmount зовёт dispose (canvas2d → three → менеджер) и снимает оба канваса', () => {
    const debug = jest.fn();
    const { container, unmount } = render(<Planner projectId='p-1' logger={{ ...silentLogger, debug }} />);
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
    const createdCalls = debug.mock.calls.length;

    unmount();

    const messages = debug.mock.calls.slice(createdCalls).map(call => String(call[0]));
    expect(messages).toEqual([
      '@uyutno/planner: Canvas2dProjection disposed',
      '@uyutno/planner: ThreeProjection disposed',
      '@uyutno/planner: PlannerManager disposed',
    ]);
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
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

  it('SSR: renderToString отдаёт контейнер с двумя канвасами, планер не поднимает и детей не рендерит', () => {
    const debug = jest.fn();
    const html = renderToString(
      <Planner projectId='p-ssr' logger={{ ...silentLogger, debug }} className='c'>
        <ActiveView />
      </Planner>,
    );
    expect(html).toContain('<div class="c"');
    expect(html.match(/<canvas/g)).toHaveLength(2);
    expect(html).toContain('role="img"');
    expect(html).not.toContain('active-view');
    expect(debug).not.toHaveBeenCalled();
    expect(mockThreeCtor).not.toHaveBeenCalled();
    expect(mockCanvas2dCtor).not.toHaveBeenCalled();
  });

  it('смена projectId пересоздаёт планер на новых канвасах: старый dispose, новый created', () => {
    const debug = jest.fn();
    const logger = { ...silentLogger, debug };
    const { container, rerender } = render(<Planner projectId='p-1' logger={logger} />);
    const first = canvasesOf(container);
    debug.mockClear();

    rerender(<Planner projectId='p-2' logger={logger} />);

    const messages = debug.mock.calls.map(call => `${String(call[0])} ${JSON.stringify(call[1])}`);
    expect(messages.some(m => /disposed/.test(m) && /p-1/.test(m))).toBe(true);
    expect(messages.some(m => /created/.test(m) && /p-2/.test(m))).toBe(true);
    // Контекст старого Three-канваса потерян (`forceContextLoss`) — новому планеру нужны новые элементы.
    const second = canvasesOf(container);
    expect(second.three).not.toBe(first.three);
    expect(second.canvas2d).not.toBe(first.canvas2d);
    expect(mockThreeCtor.mock.calls[1]![1]).toBe(second.three);
    expect(mockCanvas2dCtor.mock.calls[1]![1]).toBe(second.canvas2d);
  });

  it('frameBudget прокидывается в обе проекции при монтировании; смена пропса планер не пересоздаёт', () => {
    const { rerender } = render(<Planner projectId='p-1' logger={silentLogger} frameBudget={2} />);
    expect(mockThreeCtor.mock.calls[0]![2]).toMatchObject({ frameBudget: 2 });
    expect(mockCanvas2dCtor.mock.calls[0]![2]).toMatchObject({ frameBudget: 2 });
    rerender(<Planner projectId='p-1' logger={silentLogger} frameBudget={7} />);
    expect(mockThreeCtor).toHaveBeenCalledTimes(1);
    expect(mockCanvas2dCtor).toHaveBeenCalledTimes(1);
  });

  it('смена onReady-ссылки не пересоздаёт планер и не зовёт колбэк повторно', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(<Planner projectId='p-1' logger={silentLogger} onReady={first} />);
    rerender(<Planner projectId='p-1' logger={silentLogger} onReady={second} />);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(mockThreeCtor).toHaveBeenCalledTimes(1);
  });

  it('без onReady планер поднимается как обычно', () => {
    const { container } = render(
      <Planner projectId='p-1' logger={silentLogger}>
        <ActiveView />
      </Planner>,
    );
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
    expect(screen.getByTestId('active-view')).toBeTruthy();
  });

  it('если планер не поднялся (нет WebGL) — ошибка в logger.error, контекст пуст, хост не падает', () => {
    mockThreeCtor.mockImplementation(() => {
      throw new Error('Error creating WebGL context.');
    });
    const error = jest.fn();
    const onReady = jest.fn();
    const { container, unmount } = render(
      <Planner projectId='p-1' logger={{ ...silentLogger, error }} onReady={onReady}>
        <ActiveView />
      </Planner>,
    );
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
    expect(screen.queryByTestId('active-view')).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toMatch(/failed to start planner/);
    expect(() => unmount()).not.toThrow();
  });
});
