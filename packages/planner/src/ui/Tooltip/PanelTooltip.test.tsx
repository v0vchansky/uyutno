/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';

import { PanelTooltip } from './PanelTooltip';

/**
 * Тултип написан вручную (причина — в JSDoc `PanelTooltip.tsx`), поэтому проверяется целиком здесь, а не
 * отдаётся на веру библиотеке: показ по таймеру `setTimeout` на 400ms, мгновенное скрытие, `aria-describedby`
 * ровно на время показа и снятие плашки на прокрутке предка и ресайзе окна. Геометрия (`position: fixed` по
 * `getBoundingClientRect()`, стрелка, зазор) в jsdom смысла не имеет — все боксы нулевые, — и остаётся визуальной
 * приёмке 0061; здесь проверяется поведение.
 *
 * Источник правды по текстам и таймингам — handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Тултипы».
 * Оговорка про снап взята дословно из рейла: тумблер обязан сказать, что выключение не отключает притяжение.
 */

/** Задержка появления по handoff'у — та же константа, что в компоненте. */
const SHOW_DELAY_MS = 400;

const SNAP_TITLE = 'Липнуть к углам';
const SNAP_HINT = 'Выключение сжимает радиус притяжения до 2 см, а не отключает его';

const renderSnapTooltip = (): ReturnType<typeof render> =>
  render(
    <PanelTooltip title={SNAP_TITLE} hint={SNAP_HINT} placement='right'>
      <button type='button' aria-label={SNAP_TITLE}>
        x
      </button>
    </PanelTooltip>,
  );

/**
 * `onPointerEnter` / `onPointerLeave` React не слушает напрямую: он синтезирует их из всплывающих `pointerover` /
 * `pointerout`. Поэтому события шлём на саму кнопку — до обёртки с её обработчиками они и доходят.
 */
const enter = (element: HTMLElement): void => {
  fireEvent.pointerOver(element);
};
const leave = (element: HTMLElement): void => {
  fireEvent.pointerOut(element);
};

/** Прокрутка таймеров меняет состояние — без `act` React ругается и не перерисовывает. */
const advance = (ms: number): void => {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
};

describe('PanelTooltip', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('оборачиваемая кнопка сохраняет свой доступный ярлык и остаётся кликабельной', () => {
    const onClick = jest.fn();
    render(
      <PanelTooltip title='Отменить' hint='Ctrl+Z (⌘Z на macOS)'>
        <button type='button' aria-label='Отменить' onClick={onClick}>
          x
        </button>
      </PanelTooltip>,
    );

    const button = screen.getByRole('button', { name: 'Отменить' });
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('до наведения плашки нет в документе и кнопка ни на что не ссылается', () => {
    renderSnapTooltip();

    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.queryByText(SNAP_HINT)).toBeNull();
    expect(screen.getByRole('button', { name: SNAP_TITLE }).hasAttribute('aria-describedby')).toBe(false);
  });

  it('наведение показывает обе строки, но только после задержки в 400ms', () => {
    renderSnapTooltip();
    const button = screen.getByRole('button', { name: SNAP_TITLE });

    enter(button);
    advance(SHOW_DELAY_MS - 1);
    expect(screen.queryByRole('tooltip')).toBeNull();

    advance(1);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain(SNAP_TITLE);
    expect(tooltip.textContent).toContain(SNAP_HINT);
  });

  it('пока плашка показана, `aria-describedby` кнопки указывает именно на неё', () => {
    renderSnapTooltip();
    const button = screen.getByRole('button', { name: SNAP_TITLE });

    enter(button);
    advance(SHOW_DELAY_MS);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.id).not.toBe('');
    expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('уход указателя прячет плашку мгновенно, без всякой задержки', () => {
    renderSnapTooltip();
    const button = screen.getByRole('button', { name: SNAP_TITLE });

    enter(button);
    advance(SHOW_DELAY_MS);
    expect(screen.getByRole('tooltip')).not.toBeNull();

    leave(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });

  it('уход указателя до истечения задержки снимает таймер — плашка не появляется вовсе', () => {
    renderSnapTooltip();
    const button = screen.getByRole('button', { name: SNAP_TITLE });

    enter(button);
    advance(SHOW_DELAY_MS - 100);
    leave(button);
    advance(SHOW_DELAY_MS);

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('нажатие на кнопку прячет плашку — иначе она висела бы поверх результата клика', () => {
    renderSnapTooltip();
    const button = screen.getByRole('button', { name: SNAP_TITLE });

    enter(button);
    advance(SHOW_DELAY_MS);
    expect(screen.getByRole('tooltip')).not.toBeNull();

    fireEvent.pointerDown(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('прокрутка прячет плашку: координаты сняты один раз, ехать за кнопкой она не умеет', () => {
    renderSnapTooltip();
    const button = screen.getByRole('button', { name: SNAP_TITLE });

    enter(button);
    advance(SHOW_DELAY_MS);

    act(() => {
      fireEvent.scroll(window);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('ресайз окна прячет плашку по той же причине', () => {
    renderSnapTooltip();
    const button = screen.getByRole('button', { name: SNAP_TITLE });

    enter(button);
    advance(SHOW_DELAY_MS);

    act(() => {
      fireEvent.resize(window);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('слушатели окна снимаются вместе с плашкой и не переживают размонтирование', () => {
    const added = jest.spyOn(window, 'addEventListener');
    const removed = jest.spyOn(window, 'removeEventListener');
    const ours = (spy: jest.SpyInstance): string[] =>
      spy.mock.calls.map(call => String(call[0])).filter(type => type === 'scroll' || type === 'resize');

    const { unmount } = renderSnapTooltip();
    const button = screen.getByRole('button', { name: SNAP_TITLE });

    enter(button);
    advance(SHOW_DELAY_MS);
    expect(ours(added)).toEqual(['scroll', 'resize']);
    expect(ours(removed)).toEqual([]);

    unmount();
    expect(ours(removed)).toEqual(['scroll', 'resize']);
  });
});
