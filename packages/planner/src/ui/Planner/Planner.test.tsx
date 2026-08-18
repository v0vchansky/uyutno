/** @jest-environment jsdom */
import type React from 'react';
import { render, screen } from '@testing-library/react';

import { renderToString } from 'react-dom/server';

import type { PlannerLogger } from '../../engine/PlannerManager';
import { Planner } from './Planner';
import { usePlannerSelector } from '../usePlannerSelector';

const silentLogger: PlannerLogger = { debug() {}, info() {}, warn() {}, error() {} };

const ActiveView: React.FC = () => {
  const activeView = usePlannerSelector(m => m.view.get().activeView);
  return <span data-testid='active-view'>{activeView}</span>;
};

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
  });

  it('на unmount зовёт dispose (менеджер и проекция логируют завершение)', () => {
    const debug = jest.fn();
    const { unmount } = render(<Planner projectId='p-1' logger={{ ...silentLogger, debug }} />);
    const createdCalls = debug.mock.calls.length;
    unmount();
    expect(debug.mock.calls.length).toBeGreaterThan(createdCalls);
    expect(debug.mock.calls.at(-1)![0]).toMatch(/disposed/);
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
  });

  it('смена projectId пересоздаёт планер: старый dispose, новый created', () => {
    const debug = jest.fn();
    const logger = { ...silentLogger, debug };
    const { rerender } = render(<Planner projectId='p-1' logger={logger} />);
    debug.mockClear();
    rerender(<Planner projectId='p-2' logger={logger} />);
    const messages = debug.mock.calls.map(call => `${call[0]} ${JSON.stringify(call[1])}`);
    expect(messages.some(m => /disposed/.test(m) && /p-1/.test(m))).toBe(true);
    expect(messages.some(m => /created/.test(m) && /p-2/.test(m))).toBe(true);
  });
});
