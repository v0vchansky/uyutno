/** @jest-environment jsdom */
import type React from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';

import { PlannerManager, type PlannerLogger } from '../engine/PlannerManager';
import { PlannerContext, usePlannerManager } from './PlannerContext';
import { usePlannerSelector } from './usePlannerSelector';

const silentLogger: PlannerLogger = { debug() {}, info() {}, warn() {}, error() {} };

const createWrapper = (manager: PlannerManager): React.FC<{ children: React.ReactNode }> => {
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <PlannerContext value={manager}>{children}</PlannerContext>
  );
  return Wrapper;
};

describe('usePlannerManager', () => {
  it('вне <Planner /> бросает понятную ошибку', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => usePlannerManager())).toThrow(
      /usePlannerManager\(\) must be used inside <Planner \/>/,
    );
    error.mockRestore();
  });

  it('внутри провайдера возвращает менеджер', () => {
    const manager = new PlannerManager({ projectId: 'p', logger: silentLogger });
    const { result } = renderHook(() => usePlannerManager(), { wrapper: createWrapper(manager) });
    expect(result.current).toBe(manager);
  });
});

describe('usePlannerSelector', () => {
  let manager: PlannerManager;

  beforeEach(() => {
    manager = new PlannerManager({ projectId: 'p', logger: silentLogger });
  });

  afterEach(() => manager.dispose());

  it('читает начальное значение синхронно при монтировании', () => {
    const { result } = renderHook(() => usePlannerSelector(m => m.view.get().activeView), {
      wrapper: createWrapper(manager),
    });
    expect(result.current).toBe('constructor');
  });

  it('ре-рендерится по событию шины и видит новый снимок', () => {
    const { result } = renderHook(() => usePlannerSelector(m => m.document.get().settings.wallHeight), {
      wrapper: createWrapper(manager),
    });
    act(() => {
      manager.document.setSettings({ wallHeight: 300 });
    });
    expect(result.current).toBe(300);
  });

  it('событие, не меняющее выбранное значение, не вызывает ре-рендер', () => {
    const renders = jest.fn();
    const Probe: React.FC = () => {
      renders();
      const units = usePlannerSelector(m => m.document.get().settings.units);
      return <span>{units}</span>;
    };
    render(<Probe />, { wrapper: createWrapper(manager) });
    expect(screen.getByText('cm')).toBeTruthy();
    const before = renders.mock.calls.length;

    act(() => {
      manager.view.setActive('plan');
    });
    expect(renders).toHaveBeenCalledTimes(before);

    act(() => {
      manager.document.setSettings({ units: 'm' });
    });
    expect(screen.getByText('m')).toBeTruthy();
    expect(renders.mock.calls.length).toBeGreaterThan(before);
  });

  it('селектор, возвращающий снимок фасада, стабилен между рендерами', () => {
    const { result, rerender } = renderHook(() => usePlannerSelector(m => m.view.get()), {
      wrapper: createWrapper(manager),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    act(() => {
      manager.view.setCamera('plan', { x: 1, y: 2, zoom: 0.3 });
    });
    expect(result.current).not.toBe(first);
    expect(result.current.cameras.plan).toEqual({ x: 1, y: 2, zoom: 0.3 });
  });

  it('смена экземпляра менеджера в контексте — переподписка и чтение нового снимка', () => {
    const other = new PlannerManager({ projectId: 'q', logger: silentLogger });
    other.view.setActive('walk');
    const { result, rerender } = renderHook(() => usePlannerSelector(m => m.view.get().activeView), {
      wrapper: createWrapper(manager),
    });
    expect(result.current).toBe('constructor');
    // Новый wrapper = новый провайдер с другим менеджером.
    const { result: next } = renderHook(() => usePlannerSelector(m => m.view.get().activeView), {
      wrapper: createWrapper(other),
    });
    expect(next.current).toBe('walk');
    act(() => {
      other.view.setActive('orbit');
    });
    expect(next.current).toBe('orbit');
    rerender();
    expect(result.current).toBe('constructor');
    other.dispose();
  });

  it('после unmount подписка снята: события не дёргают компонент', () => {
    const selector = jest.fn((m: PlannerManager) => m.view.get().activeView);
    const { unmount } = renderHook(() => usePlannerSelector(selector), { wrapper: createWrapper(manager) });
    unmount();
    const calls = selector.mock.calls.length;
    act(() => {
      manager.view.setActive('orbit');
    });
    expect(selector).toHaveBeenCalledTimes(calls);
  });
});
