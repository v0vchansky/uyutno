/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';

import { createDefaultCamera } from '../../document/PlannerDocument';
import { PlannerManager, type PlannerLogger } from '../../engine/PlannerManager';
import { err } from '../../document/Result';
import type { SetActiveViewError } from '../../engine/ViewNamespace';
import type { PlannerInstance, PlannerProjections } from '../../projection/createPlanner';
import { PlannerContext } from '../PlannerContext';
import { ViewRail } from './ViewRail';

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

let manager: PlannerManager;
let logger: SilentLogger;
let resetConstructorCamera: jest.Mock;

/** Проекции подменяются фейком: рейлу нужен ровно `canvas2d.resetCamera()` — камера конструктора живёт там (ADR 0020 P3). */
const renderRail = (): void => {
  logger = createSilentLogger();
  manager = new PlannerManager({ projectId: 'p', logger });
  resetConstructorCamera = jest.fn();
  const instance: PlannerInstance = {
    manager,
    projections: { three: {}, canvas2d: { resetCamera: resetConstructorCamera } } as unknown as PlannerProjections,
    dispose: () => manager.dispose(),
  };
  render(
    <PlannerContext value={instance}>
      <ViewRail />
    </PlannerContext>,
  );
};

const viewButton = (name: string): HTMLElement => screen.getByRole('button', { name });
const snapSwitch = (name: string): HTMLElement => screen.getByRole('switch', { name });

const VIEW_NAMES = ['Конструктор стен', '2D-план'];
const SNAP_NAMES = ['Липнуть к углам', 'Оси через точки', 'Ровно по горизонтали и вертикали', 'По центру угла'];

afterEach(() => manager.dispose());

describe('<ViewRail /> — кнопки видов', () => {
  it('стартово активен конструктор: aria-pressed только у него', () => {
    renderRail();
    expect(viewButton('Конструктор стен').getAttribute('aria-pressed')).toBe('true');
    expect(viewButton('2D-план').getAttribute('aria-pressed')).toBe('false');
  });

  it('клик по неактивной кнопке переключает вид в фасаде и переносит aria-pressed', () => {
    renderRail();
    fireEvent.click(viewButton('2D-план'));

    expect(manager.view.get().activeView).toBe('plan');
    expect(viewButton('2D-план').getAttribute('aria-pressed')).toBe('true');
    expect(viewButton('Конструктор стен').getAttribute('aria-pressed')).toBe('false');
  });

  it('клик по активному конструктору сбрасывает камеру вьювера, вид не меняется', () => {
    renderRail();
    fireEvent.click(viewButton('Конструктор стен'));

    expect(resetConstructorCamera).toHaveBeenCalledTimes(1);
    expect(manager.view.get().activeView).toBe('constructor');
  });

  it('клик по активному 2D-плану возвращает камеру плана к дефолту, вьювер конструктора не трогается', () => {
    renderRail();
    fireEvent.click(viewButton('2D-план'));
    manager.view.setCamera('plan', { x: 320, y: -140, zoom: 0.9 });
    expect(manager.view.get().cameras.plan).not.toEqual(createDefaultCamera('plan'));

    fireEvent.click(viewButton('2D-план'));

    expect(manager.view.get().cameras.plan).toEqual(createDefaultCamera('plan'));
    expect(manager.view.get().activeView).toBe('plan');
    expect(resetConstructorCamera).not.toHaveBeenCalled();
  });
});

/**
 * Отказы команд `view.*` рейл не выбрасывает и не показывает пользователю — исключений наружу нет (ADR 0015),
 * след отказа один: `logger.debug` тем же префиксом, что у движка. Своими кнопками рейл невалидный вид не выберет,
 * поэтому отказ подставляется спаем на неймспейс — проверяется маршрут обработки, а не сама валидация фасада.
 */
describe('<ViewRail /> — отказ команды вида', () => {
  it('отказ setActive пишется в логгер, вид остаётся прежним', () => {
    renderRail();
    jest
      .spyOn(manager.view, 'setActive')
      .mockReturnValue(err<SetActiveViewError>({ kind: 'invalid-view', view: 'plan' }));
    logger.debug.mockClear();

    fireEvent.click(viewButton('2D-план'));

    expect(manager.view.get().activeView).toBe('constructor');
    expect(logger.debug).toHaveBeenCalledWith('@uyutno/planner: view.setActive rejected', {
      kind: 'invalid-view',
      view: 'plan',
    });
  });

  it('отказ resetCamera на повторном клике по активному виду пишется в логгер', () => {
    renderRail();
    fireEvent.click(viewButton('2D-план'));
    jest
      .spyOn(manager.view, 'resetCamera')
      .mockReturnValue(err<SetActiveViewError>({ kind: 'invalid-view', view: 'plan' }));
    logger.debug.mockClear();

    fireEvent.click(viewButton('2D-план'));

    expect(manager.view.get().activeView).toBe('plan');
    expect(logger.debug).toHaveBeenCalledWith('@uyutno/planner: view.resetCamera rejected', {
      kind: 'invalid-view',
      view: 'plan',
    });
  });
});

describe('<ViewRail /> — тумблеры снапа', () => {
  it('дефолты спеки 01: включено всё, кроме орто-лока', () => {
    renderRail();
    expect(snapSwitch('Липнуть к углам').getAttribute('aria-checked')).toBe('true');
    expect(snapSwitch('Оси через точки').getAttribute('aria-checked')).toBe('true');
    expect(snapSwitch('Ровно по горизонтали и вертикали').getAttribute('aria-checked')).toBe('false');
    expect(snapSwitch('По центру угла').getAttribute('aria-checked')).toBe('true');
  });

  it.each([
    ['Липнуть к углам', 'pointsSnap'],
    ['Оси через точки', 'pointsAlign'],
    ['Ровно по горизонтали и вертикали', 'orthoAlign'],
    ['По центру угла', 'bisectorAlign'],
  ] as const)('клик по «%s» переключает только %s', (name, flag) => {
    renderRail();
    const before = manager.tools.get().snapFlags;

    fireEvent.click(snapSwitch(name));

    const after = manager.tools.get().snapFlags;
    expect(after[flag]).toBe(!before[flag]);
    for (const other of Object.keys(before) as (keyof typeof before)[]) {
      if (other !== flag) expect(after[other]).toBe(before[other]);
    }
    expect(snapSwitch(name).getAttribute('aria-checked')).toBe(String(after[flag]));
  });
});

describe('<ViewRail /> — доступность и клавиатура', () => {
  it('виды — кнопки с aria-pressed, снап — switch с aria-checked, у каждой непустой aria-label', () => {
    renderRail();
    for (const name of VIEW_NAMES) {
      const button = viewButton(name);
      expect(button.getAttribute('aria-label')).toBe(name);
      expect(button.getAttribute('aria-pressed')).toMatch(/^(true|false)$/);
    }
    for (const name of SNAP_NAMES) {
      const toggle = snapSwitch(name);
      expect(toggle.getAttribute('aria-label')).toBe(name);
      expect(toggle.getAttribute('aria-checked')).toMatch(/^(true|false)$/);
    }
    expect(screen.getAllByRole('switch')).toHaveLength(SNAP_NAMES.length);
  });

  // Единственный владелец клавиатуры — `projection/input/keyboard.ts` (ADR 0019): рейл слушателей не ставит.
  it('глобальный keydown мимо рейла ничего не меняет', () => {
    renderRail();
    const document0 = manager.document.get();
    const history0 = manager.history.get();
    const view0 = manager.view.get();
    const snap0 = manager.tools.get().snapFlags;

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(manager.document.get()).toBe(document0);
    expect(manager.history.get()).toEqual(history0);
    expect(manager.view.get()).toBe(view0);
    expect(manager.tools.get().snapFlags).toBe(snap0);
  });
});
