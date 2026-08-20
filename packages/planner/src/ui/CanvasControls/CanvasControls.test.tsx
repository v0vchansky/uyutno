/** @jest-environment jsdom */
import type React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { PlannerManager, type PlannerLogger } from '../../engine/PlannerManager';
import type { ZoomState } from '../../projection/canvas2d/Canvas2dProjection';
import type { PlannerInstance, PlannerProjections } from '../../projection/createPlanner';
import { PlannerContext } from '../PlannerContext';
import { CanvasControls } from './CanvasControls';

const silentLogger: PlannerLogger = { debug() {}, info() {}, warn() {}, error() {} };

const zoomState = (patch: Partial<ZoomState> = {}): ZoomState => ({
  index: 20,
  scale: 1,
  steps: 41,
  canZoomIn: true,
  canZoomOut: true,
  ...patch,
});

/**
 * Проекция подменяется целиком: контрол обязан наполняться публичным API `Canvas2dProjection` и ничем больше,
 * а поднимать настоящую Canvas2D-проекцию в jsdom (нет `getContext('2d')`) незачем. Менеджер при этом настоящий —
 * единицы едут через фасад.
 */
const createCanvas2dStub = (initial: ZoomState) => {
  let zoom = initial;
  const listeners = new Set<(next: ZoomState) => void>();
  const unsubscribe = jest.fn(() => {
    listeners.clear();
  });
  const canvas2d = {
    getZoom: jest.fn(() => zoom),
    onZoomChanged: jest.fn((listener: (next: ZoomState) => void) => {
      listeners.add(listener);
      return unsubscribe;
    }),
    zoomBy: jest.fn(),
    fitToContent: jest.fn(),
  };
  const emit = (next: ZoomState): void => {
    zoom = next;
    for (const listener of listeners) listener(next);
  };
  return { canvas2d, emit, unsubscribe };
};

const renderControls = (initial: ZoomState = zoomState()) => {
  const manager = new PlannerManager({ projectId: 'p', logger: silentLogger });
  const stub = createCanvas2dStub(initial);
  const instance: PlannerInstance = {
    manager,
    projections: { three: {}, canvas2d: stub.canvas2d } as unknown as PlannerProjections,
    dispose: () => manager.dispose(),
  };
  const Wrapper: React.FC = () => (
    <PlannerContext value={instance}>
      <CanvasControls />
    </PlannerContext>
  );
  const view = render(<Wrapper />);
  return { ...stub, manager, ...view };
};

/**
 * Индикатор ищется по тексту, а не по `title`: нативной подписи у него больше нет — она подменена `PanelTooltip`,
 * как у остальных иконок скина. Процент в полоске один, единицы — «см»/«м»/«мм», поэтому шаблон однозначен.
 */
const zoomIndicator = (): HTMLElement => screen.getByText(/^\d+%$/);

describe('CanvasControls · индикатор зума', () => {
  it('показывает 100% при scale 1 и 50% при scale 0.5', () => {
    const { unmount } = renderControls(zoomState({ scale: 1 }));
    expect(zoomIndicator().textContent).toBe('100%');
    unmount();

    renderControls(zoomState({ scale: 0.5 }));
    expect(zoomIndicator().textContent).toBe('50%');
  });

  it('перерисовывается по событию onZoomChanged, без клика', () => {
    const { emit } = renderControls(zoomState({ scale: 1 }));
    act(() => emit(zoomState({ index: 24, scale: 2 })));
    expect(zoomIndicator().textContent).toBe('200%');
  });

  it('подписан тултипом скина, а не нативным title', () => {
    renderControls();
    expect(zoomIndicator().getAttribute('title')).toBeNull();
    expect(screen.queryByTitle('Масштаб плана')).toBeNull();
  });

  it('на unmount отписка от onZoomChanged вызвана', () => {
    const { unsubscribe, unmount } = renderControls();
    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('CanvasControls · шаг шкалы', () => {
  it('«−» зовёт zoomBy(-1), «+» — zoomBy(1)', () => {
    const { canvas2d } = renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'Отдалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Приблизить' }));
    expect(canvas2d.zoomBy.mock.calls).toEqual([[-1], [1]]);
  });

  it('на нижнем пределе шкалы «−» disabled и клик по ней zoomBy не зовёт', () => {
    const { canvas2d } = renderControls(zoomState({ index: 0, canZoomOut: false }));
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Отдалить' });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(canvas2d.zoomBy).not.toHaveBeenCalled();
  });

  it('на верхнем пределе шкалы «+» disabled и клик по ней zoomBy не зовёт', () => {
    const { canvas2d } = renderControls(zoomState({ index: 40, canZoomIn: false }));
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Приблизить' });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(canvas2d.zoomBy).not.toHaveBeenCalled();
  });
});

describe('CanvasControls · «в центр»', () => {
  it('клик зовёт fitToContent ровно один раз', () => {
    const { canvas2d } = renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'Показать весь план' }));
    expect(canvas2d.fitToContent).toHaveBeenCalledTimes(1);
  });
});

/** Сегменты живут в своей группе — так они отделяются от кнопок зума и «в центр», у которых та же роль. */
const unitSegments = (): HTMLElement[] =>
  within(screen.getByRole('group', { name: 'Единицы измерения' })).getAllByRole('button');

describe('CanvasControls · единицы', () => {
  it('дефолт — сантиметры; клики переключают документ и активный сегмент', () => {
    const { manager } = renderControls();
    const segment = (name: string): HTMLElement => screen.getByRole('button', { name });
    expect(segment('Сантиметры').getAttribute('aria-pressed')).toBe('true');
    expect(segment('Метры').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(segment('Метры'));
    expect(manager.document.get().settings.units).toBe('m');
    expect(segment('Метры').getAttribute('aria-pressed')).toBe('true');
    expect(segment('Сантиметры').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(segment('Миллиметры'));
    expect(manager.document.get().settings.units).toBe('mm');
    expect(segment('Миллиметры').getAttribute('aria-pressed')).toBe('true');
  });

  it('сегментов ровно три — имперских единиц нет (решение 18)', () => {
    renderControls();
    const segments = unitSegments();
    expect(segments).toHaveLength(3);
    expect(segments.map(segment => segment.textContent)).toEqual(['см', 'м', 'мм']);
    expect(screen.queryByRole('button', { name: /дюйм|фут|inch|feet/i })).toBeNull();
  });

  /**
   * Разметка — группа кнопок с `aria-pressed`, а не `radiogroup`: паттерн radiogroup обещает roving tabindex и
   * стрелки, а клавиатурных слушателей в скине быть не может (ADR 0019 E5). Тест держит это решение.
   */
  it('не объявляет radiogroup и radio — роли, обещающей клавиатуру, в скине нет', () => {
    renderControls();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    for (const segment of unitSegments()) expect(segment.getAttribute('role')).toBeNull();
  });
});

describe('CanvasControls · доступность и клавиатура', () => {
  it('у каждой активной кнопки непустой ярлык, и ни один не унаследован от отмены/повтора', () => {
    renderControls();
    const labels = screen.getAllByRole('button').map(button => button.getAttribute('aria-label'));
    // Три кнопки действий плюс три сегмента единиц: зарезервированные слоты линейки и полноэкранного режима
    // кнопок не заводят, поэтому в подсчёт не попадают.
    expect(labels).toEqual(['Отдалить', 'Приблизить', 'Показать весь план', 'Сантиметры', 'Метры', 'Миллиметры']);
    for (const label of labels) {
      expect(label).toBeTruthy();
      expect(label).not.toBe('Отменить');
      expect(label).not.toBe('Повторить');
    }
  });

  it('своих слушателей клавиатуры не заводит — Ctrl+Z мимо контролов ничего не меняет', () => {
    const { canvas2d } = renderControls();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    expect(canvas2d.zoomBy).not.toHaveBeenCalled();
    expect(canvas2d.fitToContent).not.toHaveBeenCalled();
    expect(zoomIndicator().textContent).toBe('100%');
  });
});
