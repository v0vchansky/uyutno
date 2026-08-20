/** @jest-environment jsdom */
import type React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { PlanPosition } from '../../document/PlannerDocument';
import { PlannerManager, type PlannerLogger } from '../../engine/PlannerManager';
import type { PlannerInstance, PlannerProjections } from '../../projection/createPlanner';
import { PlannerContext } from '../PlannerContext';
import { type LabelVisibility, PlannerOverlayProvider, usePlannerLabelVisibility } from '../PlannerOverlayContext';
import { ToolPanel } from './ToolPanel';

/**
 * Скин панели поверх **реального** фасада (образец — `../usePlannerSelector.test.tsx`): проекций у headless-движка
 * нет, контексту хватает ссылки. Ввод указателя — командами `tools.*` в координатах плана, как в
 * `apps/platform/e2e/planner-rect-and-room-tools.spec.ts`: экран → план делает вьювер, которого здесь нет.
 *
 * Тумблеры подписей проверяются через пробник, читающий контекст скина, а не через мок сеттера: важно, что флаг
 * действительно переключился и соседние не поехали, а не что функцию позвали.
 */

/**
 * Логгер молчит в консоль, но остаётся наблюдаемым: отказ команды фасада — это `Result`, а не исключение, и
 * единственный его след — `logger.debug` (`engine/tools/*.ts` пишет отказы так же).
 */
type SilentLogger = { [K in keyof PlannerLogger]: jest.Mock };

const createSilentLogger = (): SilentLogger => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const createWrapper = (manager: PlannerManager): React.FC<{ children: React.ReactNode }> => {
  const instance: PlannerInstance = {
    manager,
    projections: { three: {}, canvas2d: {} } as unknown as PlannerProjections,
    dispose: () => manager.dispose(),
  };
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <PlannerContext value={instance}>{children}</PlannerContext>
  );
  return Wrapper;
};

/** Тот же контекст плюс провайдер скина — тумблерам подписей нужен он, инструментам достаточно фасада. */
const createOverlayWrapper = (manager: PlannerManager): React.FC<{ children: React.ReactNode }> => {
  const Base = createWrapper(manager);
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Base>
      <PlannerOverlayProvider>{children}</PlannerOverlayProvider>
    </Base>
  );
  return Wrapper;
};

/** Пробник состояния скина: панель переключает флаги, а видно их только отсюда. */
const VisibilityProbe: React.FC = () => (
  <output data-testid='visibility'>{JSON.stringify(usePlannerLabelVisibility())}</output>
);

const visibility = (): LabelVisibility =>
  JSON.parse(screen.getByTestId('visibility').textContent ?? '') as LabelVisibility;

const MODS = { ctrl: false, meta: false, shift: false, alt: false };

/** Полный цикл клика указателем в координатах плана: точку ставит `pointerUp` основной кнопки. */
const click = (manager: PlannerManager, { x, y }: PlanPosition): void => {
  act(() => {
    manager.tools.pointerMove({ x, y, mods: MODS, button: 0 });
    manager.tools.pointerDown({ x, y, mods: MODS, button: 0 });
    manager.tools.pointerUp({ x, y, mods: MODS, button: 0 });
  });
};

const roomCount = (manager: PlannerManager): number => manager.document.getDerived().floors[0]!.rooms.length;

const button = (name: string): HTMLButtonElement => screen.getByRole('button', { name }) as HTMLButtonElement;

/** Доступный ярлык тумблера — его видимая подпись: `role="switch"` берёт имя из содержимого, `aria-label` не нужен. */
const toggle = (name: string): HTMLElement => screen.getByRole('switch', { name });

/** Прямоугольная комната headless-командами: старт инструмента → два клика по углам → коммит одной транзакцией. */
const drawRectRoom = (manager: PlannerManager): void => {
  act(() => {
    manager.tools.start('rect');
  });
  click(manager, { x: 0, y: 0 });
  click(manager, { x: 300, y: 400 });
};

describe('<ToolPanel />', () => {
  let manager: PlannerManager;
  let logger: SilentLogger;

  beforeEach(() => {
    logger = createSilentLogger();
    manager = new PlannerManager({ projectId: 'p', logger });
  });

  afterEach(() => manager.dispose());

  it('на пустом документе обе кнопки истории задизейблены', () => {
    render(<ToolPanel />, { wrapper: createWrapper(manager) });
    expect(button('Отменить').disabled).toBe(true);
    expect(button('Повторить').disabled).toBe(true);
  });

  it('клик по «Прямоугольная комната» включает инструмент и помечает строку aria-pressed', () => {
    render(<ToolPanel />, { wrapper: createWrapper(manager) });
    fireEvent.click(button('Прямоугольная комната'));

    expect(manager.tools.get().kind).toBe('making-rect');
    expect(button('Прямоугольная комната').getAttribute('aria-pressed')).toBe('true');
    expect(button('Стены').getAttribute('aria-pressed')).toBe('false');
    expect(button('Комната по точкам').getAttribute('aria-pressed')).toBe('false');
  });

  it('клик по «Стены» посреди рисования прямоугольника меняет инструмент', () => {
    render(<ToolPanel />, { wrapper: createWrapper(manager) });
    fireEvent.click(button('Прямоугольная комната'));
    expect(manager.tools.get().kind).toBe('making-rect');

    fireEvent.click(button('Стены'));
    expect(manager.tools.get().kind).toBe('making-walls');
    expect(button('Стены').getAttribute('aria-pressed')).toBe('true');
    expect(button('Прямоугольная комната').getAttribute('aria-pressed')).toBe('false');
  });

  it('отказ tools.start не меняет автомат и уходит в логгер, а не наружу исключением', () => {
    render(<ToolPanel />, { wrapper: createWrapper(manager) });
    // Инструменты рисования живут только в конструкторе: на 2D-плане `tools.start` вернёт `view-not-constructor`.
    act(() => {
      manager.view.setActive('plan');
    });
    logger.debug.mockClear();

    fireEvent.click(button('Прямоугольная комната'));

    expect(manager.tools.get().kind).toBe('editing');
    expect(button('Прямоугольная комната').getAttribute('aria-pressed')).toBe('false');
    expect(logger.debug).toHaveBeenCalledWith('@uyutno/planner: tools.start rejected', {
      kind: 'view-not-constructor',
      view: 'plan',
    });
  });

  it('после коммита комнаты «Отменить» снимает её, «Повторить» возвращает', () => {
    render(<ToolPanel />, { wrapper: createWrapper(manager) });
    drawRectRoom(manager);

    // Контур закоммичен, автомат вернулся в `editing` — это норма, активного инструмента больше нет.
    expect(manager.tools.get().kind).toBe('editing');
    expect(roomCount(manager)).toBe(1);
    expect(button('Отменить').disabled).toBe(false);
    expect(button('Повторить').disabled).toBe(true);

    fireEvent.click(button('Отменить'));
    expect(roomCount(manager)).toBe(0);
    expect(button('Повторить').disabled).toBe(false);

    fireEvent.click(button('Повторить'));
    expect(roomCount(manager)).toBe(1);
  });

  it('в «Стенах» «Отменить» снимает точку из локального стека, историю документа не трогая', () => {
    render(<ToolPanel />, { wrapper: createWrapper(manager) });
    drawRectRoom(manager);
    const historyBefore = manager.history.get();
    expect(historyBefore.canUndo).toBe(true);

    act(() => {
      manager.tools.start('walls');
    });
    click(manager, { x: 1000, y: 1000 });
    click(manager, { x: 1400, y: 1000 });
    const drawing = manager.tools.get();
    expect(drawing.kind === 'making-walls' && drawing.points.length).toBe(2);
    expect(button('Отменить').disabled).toBe(false);

    fireEvent.click(button('Отменить'));

    const afterUndo = manager.tools.get();
    expect(afterUndo.kind).toBe('making-walls');
    expect(afterUndo.kind === 'making-walls' && afterUndo.points.length).toBe(1);
    // Локальный стек инструмента (ADR 0018 D8): документ и его история не изменились.
    expect(manager.history.get()).toEqual(historyBefore);
    expect(roomCount(manager)).toBe(1);
  });

  it('панель не слушает клавиатуру: Ctrl+Z на document ничего не откатывает', () => {
    render(<ToolPanel />, { wrapper: createWrapper(manager) });
    drawRectRoom(manager);
    expect(roomCount(manager)).toBe(1);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });

    expect(roomCount(manager)).toBe(1);
    expect(manager.tools.get().kind).toBe('editing');
    expect(button('Отменить').disabled).toBe(false);
  });

  it('у каждой кнопки непустой доступный ярлык, активный инструмент помечен aria-pressed', () => {
    render(<ToolPanel />, { wrapper: createWrapper(manager) });
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);
    for (const element of buttons) {
      expect((element.getAttribute('aria-label') ?? '').length).toBeGreaterThan(0);
    }

    // Инструменты — кнопки с `aria-pressed`; кнопки истории им не притворяются.
    expect(buttons.filter(element => element.hasAttribute('aria-pressed'))).toHaveLength(3);
    fireEvent.click(button('Комната по точкам'));
    expect(
      screen.getAllByRole('button').filter(element => element.getAttribute('aria-pressed') === 'true'),
    ).toHaveLength(1);
    expect(button('Комната по точкам').getAttribute('aria-pressed')).toBe('true');
  });

  it('группы панели доступны по подписи, а не заголовками документа', () => {
    render(<ToolPanel />, { wrapper: createOverlayWrapper(manager) });

    // Подпись группы — `<div>` с `aria-labelledby`, а не `<h3>`: на странице нет ни `h1`, ни `h2`.
    expect(screen.queryAllByRole('heading')).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Инструменты' }).contains(button('Стены'))).toBe(true);
    expect(screen.getByRole('group', { name: 'Подписи' }).contains(toggle('Размеры'))).toBe(true);
  });

  describe('переключатели подписей', () => {
    /** Подпись в панели → флаг видимости (handoff, «Панель инструментов»). */
    const TOGGLES: readonly (readonly [string, keyof LabelVisibility])[] = [
      ['Размеры', 'dimensions'],
      ['Имя комнаты', 'roomName'],
      ['Площадь', 'roomArea'],
    ];

    it('три переключателя с подписями-ярлыками, все включены по умолчанию', () => {
      render(<ToolPanel />, { wrapper: createOverlayWrapper(manager) });

      const switches = screen.getAllByRole('switch');
      expect(switches).toHaveLength(3);
      for (const [title] of TOGGLES) {
        expect(toggle(title).getAttribute('aria-checked')).toBe('true');
        // Ярлык — сама подпись, отдельным `aria-label` он не дублируется.
        expect(toggle(title).hasAttribute('aria-label')).toBe(false);
      }
    });

    it.each(TOGGLES)('клик по «%s» гасит и возвращает свой флаг, соседние не трогая', (title, key) => {
      render(
        <>
          <ToolPanel />
          <VisibilityProbe />
        </>,
        { wrapper: createOverlayWrapper(manager) },
      );
      const others = TOGGLES.filter(([, other]) => other !== key);

      fireEvent.click(toggle(title));

      expect(toggle(title).getAttribute('aria-checked')).toBe('false');
      expect(visibility()[key]).toBe(false);
      for (const [otherTitle, otherKey] of others) {
        expect(toggle(otherTitle).getAttribute('aria-checked')).toBe('true');
        expect(visibility()[otherKey]).toBe(true);
      }

      fireEvent.click(toggle(title));

      expect(toggle(title).getAttribute('aria-checked')).toBe('true');
      expect(visibility()).toEqual({ dimensions: true, roomName: true, roomArea: true });
    });

    it('вне провайдера скина панель рендерится, тумблеры показывают дефолт, клик не падает', () => {
      render(<ToolPanel />, { wrapper: createWrapper(manager) });

      expect(screen.getAllByRole('switch')).toHaveLength(3);
      fireEvent.click(toggle('Размеры'));

      // Сеттер вне провайдера — no-op: значение остаётся дефолтным, а не ломает панель.
      for (const [title] of TOGGLES) {
        expect(toggle(title).getAttribute('aria-checked')).toBe('true');
      }
      expect(button('Стены').getAttribute('aria-pressed')).toBe('false');
    });
  });
});
