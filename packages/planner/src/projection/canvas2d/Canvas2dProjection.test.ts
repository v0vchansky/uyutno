/** @jest-environment jsdom */
import { planToView, viewToPlan } from '../../document/geometry/viewport';
import type { PlannerDocument } from '../../document/PlannerDocument';
import type { PlannerLogger } from '../../engine/PlannerManager';
import { createTestManager, ringDocument } from '../../engine/testing/testManager';
import { DEFAULT_VIEWPORT } from '../../engine/tools/ToolState';
import { Canvas2dProjection, KEYBOARD_PAN_STEP } from './Canvas2dProjection';
import { scaleAt, ZOOM_SCALE_BASE_INDEX, ZOOM_SCALE_STEPS } from './camera';
import { DRAFT_CURSORS } from './draftStyle';

/** Бюджет кадров тестового лупа: меньше дефолтного, чтобы «сколько кадров дал invalidate» читалось точно. */
const FRAME_BUDGET = 2;

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

const NO_MODS = { ctrl: false, meta: false, shift: false, alt: false };

interface ResizeEntryLike {
  contentRect: { width: number; height: number };
}

/** `ResizeObserver` в jsdom нет — фейк даёт вручную позвать колбэк с нужным `contentRect` (ADR 0020 P7). */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = 0;

  constructor(readonly callback: (entries: ResizeEntryLike[]) => void) {
    FakeResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected += 1;
  }
}

/**
 * 2D-контекст-протокол: пиксели не проверяются (это дело `drawFrame.test.ts`), нужен только факт вызовов —
 * любое обращение к методу записывается, любое присвоение свойства запоминается.
 */
const createContext = (): { ctx: CanvasRenderingContext2D; calls: string[] } => {
  const calls: string[] = [];
  const props = new Map<string, unknown>([['globalAlpha', 1]]);
  const ctx = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (typeof property !== 'string') return undefined;
        if (props.has(property)) return props.get(property);
        return (): void => {
          calls.push(property);
        };
      },
      set: (_target, property, value) => {
        if (typeof property === 'string') props.set(property, value);
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, calls };
};

const createLogger = (): PlannerLogger & { warn: jest.Mock; error: jest.Mock } => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

interface PointerInit {
  clientX?: number;
  clientY?: number;
  button?: number;
  pointerId?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** `PointerEvent` jsdom не реализует — собираем `MouseEvent` и дописываем `pointerId`. */
const pointerEvent = (type: string, { pointerId = 1, ...init }: PointerInit): Event => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
};

const cleanups: (() => void)[] = [];

const setup = (
  options: {
    document?: PlannerDocument;
    getContext?: (canvas: HTMLCanvasElement) => CanvasRenderingContext2D | null;
  } = {},
) => {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.append(canvas);
  document.body.append(container);

  const originalRaf = window.requestAnimationFrame;
  const originalCancel = window.cancelAnimationFrame;
  const originalObserver = (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;

  let nextHandle = 1;
  const queue = new Map<number, () => void>();
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const handle = nextHandle++;
    queue.set(handle, () => callback(0));
    return handle;
  };
  window.cancelAnimationFrame = (handle: number): void => {
    queue.delete(handle);
  };
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;

  // Pointer capture в jsdom не реализован, а в исходнике зовётся через `?.` — без явных заглушек пропажа
  // всех четырёх вызовов прошла бы зелёным.
  const capture = jest.fn<void, [number]>();
  const release = jest.fn<void, [number]>();
  Object.assign(canvas, { setPointerCapture: capture, releasePointerCapture: release });

  const { ctx, calls } = createContext();
  const logger = createLogger();
  const tm = createTestManager(options.document, logger);
  const { manager } = tm;

  const getContext = options.getContext ?? ((): CanvasRenderingContext2D => ctx);
  const create = (): Canvas2dProjection =>
    new Canvas2dProjection(manager, canvas, { frameBudget: FRAME_BUDGET, logger, getContext });

  /** Прогоняет запланированные кадры до засыпания лупа; возвращает их число. */
  const flush = (limit = 20): number => {
    let count = 0;
    while (queue.size > 0) {
      if (count >= limit) throw new Error('@uyutno/planner test: render loop does not stop');
      const entry = [...queue.entries()][0]!;
      queue.delete(entry[0]);
      entry[1]();
      count += 1;
    }
    return count;
  };

  const harness = {
    canvas,
    container,
    manager,
    logger,
    ctx,
    calls,
    capture,
    release,
    create,
    flush,
    pending: (): number => queue.size,
    observer: (): FakeResizeObserver => FakeResizeObserver.instances.at(-1)!,
    dispatch: (type: string, init: PointerInit = {}): Event => {
      const event = pointerEvent(type, init);
      canvas.dispatchEvent(event);
      return event;
    },
    wheel: (deltaY: number, clientX: number, clientY: number): WheelEvent => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, clientX, clientY });
      canvas.dispatchEvent(event);
      return event;
    },
    resize: (width = CANVAS_WIDTH, height = CANVAS_HEIGHT, devicePixelRatio = 1): void => {
      Object.defineProperty(window, 'devicePixelRatio', { value: devicePixelRatio, configurable: true });
      harness.observer().callback([{ contentRect: { width, height } }]);
    },
  };

  cleanups.push(() => {
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancel;
    (window as unknown as { ResizeObserver?: unknown }).ResizeObserver = originalObserver;
    container.remove();
    manager.dispose();
    FakeResizeObserver.instances.length = 0;
  });

  return harness;
};

/** Поднятая проекция с уже выставленным размером кадра — стартовая точка большинства сценариев. */
const setupReady = (document?: PlannerDocument) => {
  const harness = setup({ document });
  const projection = harness.create();
  harness.resize();
  harness.flush();
  return { ...harness, projection };
};

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  jest.restoreAllMocks();
});

describe('Canvas2dProjection — жизненный цикл (ADR 0020 P1)', () => {
  it('без 2D-контекста конструктор бросает и не оставляет висящего лупа', () => {
    const harness = setup({ getContext: () => null });
    expect(() => harness.create()).toThrow(/canvas 2d context is not available/);
    expect(harness.pending()).toBe(0);
    expect(harness.flush()).toBe(0);
  });

  it('поднимается на переданном канвасе: слушает контейнер, ставит курсор покоя, кадров без размера не рисует', () => {
    const harness = setup();
    const projection = harness.create();

    expect(projection.isDisposed).toBe(false);
    expect(projection.isActive).toBe(true);
    expect(harness.observer().observed).toEqual([harness.container]);
    expect(harness.canvas.style.cursor).toBe(DRAFT_CURSORS.idle);
    expect(projection.getStats()).toEqual({ frame: 0 });
    expect(harness.logger.error).not.toHaveBeenCalled();
  });

  it('dispose(): снимает DOM-слушатели, подписки шины и ResizeObserver; повторный вызов — no-op', () => {
    const { projection, canvas, manager, observer } = setupReady();
    const pointerMove = jest.spyOn(manager.tools, 'pointerMove');

    projection.dispose();
    projection.dispose();

    expect(projection.isDisposed).toBe(true);
    expect(observer().disconnected).toBe(1);

    // DOM-слушатели сняты.
    canvas.dispatchEvent(pointerEvent('pointermove', { clientX: 10, clientY: 10 }));
    expect(pointerMove).not.toHaveBeenCalled();
    // Подписка на `tools:changed` снята — курсор за автоматом больше не следует.
    manager.tools.start('walls');
    expect(canvas.style.cursor).toBe(DRAFT_CURSORS.idle);
  });

  it('при подъёме viewport проекции сразу доезжает в автомат (не DEFAULT_VIEWPORT)', () => {
    const harness = setup();
    const projection = harness.create();

    const viewport = harness.manager.tools.get().viewport;
    expect(viewport).toEqual(projection.getViewport());
    // Размера ещё нет — но это уже настоящий viewport проекции, а не заглушка автомата.
    expect(viewport).toEqual({ scale: 1, center: { x: 0, y: 0 }, width: 0, height: 0 });
    expect(viewport).not.toEqual(DEFAULT_VIEWPORT);
  });

  it('автомат отверг viewport — предупреждение в логгер, проекция не падает', () => {
    const harness = setup();
    const projection = harness.create();
    const error = { kind: 'invalid-viewport' as const, field: 'scale', value: 0 };
    jest.spyOn(harness.manager.tools, 'setViewport').mockReturnValue({ ok: false, error });

    expect(() => projection.zoomBy(1)).not.toThrow();

    expect(harness.logger.warn).toHaveBeenCalledWith('@uyutno/planner: viewport rejected', error);
    // Локальная камера конструктора — источник правды проекции: отказ автомата её не откатывает.
    expect(projection.getZoom().index).toBe(ZOOM_SCALE_BASE_INDEX + 1);
  });

  it('blur окна прерывает жест и пан; после dispose() слушатель окна снят', () => {
    const { projection, manager, canvas, dispatch } = setupReady();
    const blur = jest.spyOn(manager.tools, 'blur');

    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 2, pointerId: 5 });
    expect(canvas.style.cursor).toBe(DRAFT_CURSORS.dragging);

    window.dispatchEvent(new Event('blur'));
    expect(blur).toHaveBeenCalledTimes(1);
    expect(canvas.style.cursor).toBe(DRAFT_CURSORS.idle);

    projection.dispose();
    window.dispatchEvent(new Event('blur'));
    expect(blur).toHaveBeenCalledTimes(1);
  });

  it('blur посреди жеста автомата отпускает захват указателя', () => {
    const { manager, capture, release, dispatch } = setupReady();
    const cancel = jest.spyOn(manager.tools, 'blur');

    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 21 });
    expect(capture).toHaveBeenCalledWith(21);

    window.dispatchEvent(new Event('blur'));

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(21);
    expect(release.mock.calls).toHaveLength(capture.mock.calls.length);
  });

  it('после blur новый жест начинается: «занятый» указатель не блокирует холст навсегда', () => {
    // `pointerup` с тем же `pointerId` после alt-tab может не прийти вовсе — гард взаимного исключения
    // не должен превращать это в «холст умер до перезагрузки».
    const { manager, dispatch } = setupReady();
    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 22 });
    window.dispatchEvent(new Event('blur'));

    const down = jest.spyOn(manager.tools, 'pointerDown');
    dispatch('pointerdown', { clientX: 420, clientY: 320, button: 0, pointerId: 23 });
    expect(down).toHaveBeenCalledTimes(1);

    // И пан после blur тоже доступен.
    dispatch('pointerup', { clientX: 420, clientY: 320, button: 0, pointerId: 23 });
    dispatch('pointerdown', { clientX: 420, clientY: 320, button: 2, pointerId: 24 });
    dispatch('pointermove', { clientX: 460, clientY: 320, button: 2, pointerId: 24 });
    expect(down).toHaveBeenCalledTimes(1);
  });

  it('после dispose() события мыши и invalidate() кадров не планируют', () => {
    const harness = setupReady();
    harness.projection.dispose();

    harness.projection.invalidate();
    harness.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    harness.wheel(-100, 100, 100);
    harness.manager.document.setSettings({ wallHeight: 300 });

    expect(harness.pending()).toBe(0);
    expect(harness.flush()).toBe(0);
  });
});

describe('Canvas2dProjection — экран → план в одном месте (ADR 0020 P4)', () => {
  it('pointerdown/move/up доезжают до автомата ровно в координатах плана', () => {
    const { projection, manager, dispatch } = setupReady(ringDocument());
    const down = jest.spyOn(manager.tools, 'pointerDown');
    const move = jest.spyOn(manager.tools, 'pointerMove');
    const up = jest.spyOn(manager.tools, 'pointerUp');

    // Камера сдвинута и отмасштабирована — пересчёт перестаёт быть тождественным.
    projection.zoomBy(3);
    projection.panByKeyboard(1, 1, 1);
    const viewport = projection.getViewport();
    const screen = { x: 210, y: 130 };
    const plan = viewToPlan(viewport, screen);

    dispatch('pointerdown', { clientX: screen.x, clientY: screen.y });
    dispatch('pointermove', { clientX: screen.x, clientY: screen.y });
    dispatch('pointerup', { clientX: screen.x, clientY: screen.y });

    const expected = { x: plan.x, y: plan.y, mods: NO_MODS, button: 0 };
    expect(down).toHaveBeenCalledWith(expected);
    expect(move).toHaveBeenCalledWith(expected);
    expect(up).toHaveBeenCalledWith(expected);
  });

  it('в режиме рисования курсор автомата равен плановой точке под указателем', () => {
    const { projection, manager, dispatch } = setupReady();
    manager.tools.start('walls');

    dispatch('pointermove', { clientX: 500, clientY: 200 });

    const state = manager.tools.get();
    expect(state.kind).toBe('making-walls');
    expect(state.kind === 'making-walls' && state.cursor).toEqual(
      viewToPlan(projection.getViewport(), { x: 500, y: 200 }),
    );
  });

  it('модификаторы и кнопка доезжают в PointerInput', () => {
    const { manager, dispatch } = setupReady();
    const down = jest.spyOn(manager.tools, 'pointerDown');

    dispatch('pointerdown', { clientX: 400, clientY: 300, ctrlKey: true, metaKey: true, shiftKey: true, altKey: true });

    expect(down).toHaveBeenCalledWith(
      expect.objectContaining({ mods: { ctrl: true, meta: true, shift: true, alt: true }, button: 0 }),
    );
  });

  it('pointercancel уводит автомат в pointerCancel()', () => {
    const { manager, dispatch } = setupReady();
    const cancel = jest.spyOn(manager.tools, 'pointerCancel');

    dispatch('pointerdown', { clientX: 400, clientY: 300 });
    dispatch('pointercancel', { clientX: 400, clientY: 300 });

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('dblclick доезжает до автомата основной кнопкой', () => {
    const { projection, manager, dispatch } = setupReady();
    const doubleClick = jest.spyOn(manager.tools, 'doubleClick');

    dispatch('dblclick', { clientX: 401, clientY: 299 });

    const plan = viewToPlan(projection.getViewport(), { x: 401, y: 299 });
    expect(doubleClick).toHaveBeenCalledWith({ x: plan.x, y: plan.y, mods: NO_MODS, button: 0 });
  });
});

describe('Canvas2dProjection — зум и пан (ADR 0020 P3)', () => {
  it('колесо вверх — шаг шкалы +1, вниз — −1; событие гасится', () => {
    const { projection, wheel } = setupReady();
    expect(projection.getZoom().index).toBe(ZOOM_SCALE_BASE_INDEX);

    const up = wheel(-120, 400, 300);
    expect(projection.getZoom().index).toBe(ZOOM_SCALE_BASE_INDEX + 1);
    expect(up.defaultPrevented).toBe(true);

    wheel(120, 400, 300);
    wheel(120, 400, 300);
    expect(projection.getZoom().index).toBe(ZOOM_SCALE_BASE_INDEX - 1);
  });

  it('зум колесом держит точку плана под курсором', () => {
    const { projection, wheel } = setupReady();
    const screen = { x: 620, y: 180 };
    const anchor = viewToPlan(projection.getViewport(), screen);

    wheel(-120, screen.x, screen.y);

    const after = planToView(projection.getViewport(), anchor);
    expect(after.x).toBeCloseTo(screen.x, 6);
    expect(after.y).toBeCloseTo(screen.y, 6);
  });

  it('ПКМ-драг панорамирует и в автомат не уходит; contextmenu подавлен', () => {
    const { projection, manager, canvas, dispatch } = setupReady();
    const down = jest.spyOn(manager.tools, 'pointerDown');
    const move = jest.spyOn(manager.tools, 'pointerMove');
    const up = jest.spyOn(manager.tools, 'pointerUp');
    const before = projection.getViewport();

    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 2, pointerId: 7 });
    expect(canvas.style.cursor).toBe(DRAFT_CURSORS.dragging);
    dispatch('pointermove', { clientX: 430, clientY: 280, button: 2, pointerId: 7 });
    dispatch('pointerup', { clientX: 430, clientY: 280, button: 2, pointerId: 7 });

    const after = projection.getViewport();
    expect(after.center.x).toBeCloseTo(before.center.x - 30 / before.scale, 9);
    expect(after.center.y).toBeCloseTo(before.center.y - 20 / before.scale, 9);
    expect(down).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(up).not.toHaveBeenCalled();
    expect(canvas.style.cursor).toBe(DRAFT_CURSORS.idle);

    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('Space + ЛКМ панорамирует, без Space ЛКМ уходит в автомат', () => {
    const { projection, manager, dispatch } = setupReady();
    const down = jest.spyOn(manager.tools, 'pointerDown');

    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 3 });
    expect(down).toHaveBeenCalledTimes(1);
    dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 3 });

    projection.setPanModifier(true);
    const before = projection.getViewport();
    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 4 });
    dispatch('pointermove', { clientX: 360, clientY: 300, button: 0, pointerId: 4 });
    dispatch('pointerup', { clientX: 360, clientY: 300, button: 0, pointerId: 4 });

    expect(down).toHaveBeenCalledTimes(1);
    expect(projection.getViewport().center.x).toBeCloseTo(before.center.x + 40 / before.scale, 9);
  });

  it('panByKeyboard двигает камеру шагом KEYBOARD_PAN_STEP × factor и молчит вне конструктора', () => {
    const { projection, manager } = setupReady();
    const before = projection.getViewport();

    expect(projection.panByKeyboard(1, 0, 10)).toBe(true);
    expect(projection.getViewport().center.x).toBeCloseTo(before.center.x + (KEYBOARD_PAN_STEP * 10) / before.scale, 9);

    expect(projection.panByKeyboard(0, 1, 1)).toBe(true);
    expect(projection.getViewport().center.y).toBeCloseTo(before.center.y + KEYBOARD_PAN_STEP / before.scale, 9);

    manager.view.setActive('plan');
    const parked = projection.getViewport();
    expect(projection.panByKeyboard(1, 0, 1)).toBe(false);
    expect(projection.getViewport()).toEqual(parked);
  });

  it('fitToContent и resetCamera идут тем же путём: viewport обновлён, автомат уведомлён', () => {
    const { projection, manager } = setupReady(ringDocument());

    projection.fitToContent();
    const fitted = projection.getViewport();
    expect(fitted.center).toEqual({ x: 200, y: 150 });
    expect(manager.tools.get().viewport).toEqual(fitted);

    projection.resetCamera();
    expect(projection.getViewport().center).toEqual({ x: 0, y: 0 });
    expect(projection.getZoom().index).toBe(ZOOM_SCALE_BASE_INDEX);
  });
});

describe('Canvas2dProjection — пан и жест автомата взаимно исключают друг друга', () => {
  /** Драг вершины кольца: точка плана (0, 0) лежит в центре кадра при дефолтной камере. */
  const startPointDrag = (harness: ReturnType<typeof setupReady>): void => {
    harness.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
    harness.dispatch('pointermove', { clientX: 440, clientY: 300, button: 0, pointerId: 1 });
    expect(harness.manager.tools.get().kind).toBe('dragging-point');
  };

  it('ЛКМ-драг + нажатие ПКМ: пан не начинается, жест закрывает свой pointerup', () => {
    const harness = setupReady(ringDocument());
    const { projection, manager, dispatch } = harness;
    const up = jest.spyOn(manager.tools, 'pointerUp');
    startPointDrag(harness);
    const viewport = projection.getViewport();

    // У мыши `pointerId` один на все кнопки: раньше ПКМ перехватывал указатель, и `pointerup` ЛКМ уходил в
    // `endPan()` — автомат оставался в `dragging-point` до Esc.
    dispatch('pointerdown', { clientX: 440, clientY: 300, button: 2, pointerId: 1 });
    dispatch('pointermove', { clientX: 470, clientY: 300, button: 2, pointerId: 1 });
    dispatch('pointerup', { clientX: 470, clientY: 300, button: 0, pointerId: 1 });

    expect(up).toHaveBeenCalledTimes(1);
    expect(manager.tools.get().kind).toBe('editing');
    // Камера не двигалась: пан не начинался.
    expect(projection.getViewport()).toEqual(viewport);
  });

  it('во время пана ЛКМ в автомат не уходит, а пан завершает та же кнопка, которой начат', () => {
    const { projection, manager, dispatch } = setupReady();
    const down = jest.spyOn(manager.tools, 'pointerDown');
    const up = jest.spyOn(manager.tools, 'pointerUp');

    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 2, pointerId: 1 });
    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
    dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
    expect(down).not.toHaveBeenCalled();
    expect(up).not.toHaveBeenCalled();

    // Пан жив: отпускание чужой кнопки его не закрыло.
    const before = projection.getViewport();
    dispatch('pointermove', { clientX: 440, clientY: 300, button: 2, pointerId: 1 });
    expect(projection.getViewport().center.x).toBeCloseTo(before.center.x - 40 / before.scale, 9);

    dispatch('pointerup', { clientX: 440, clientY: 300, button: 2, pointerId: 1 });
    const parked = projection.getViewport();
    dispatch('pointermove', { clientX: 480, clientY: 300, button: 0, pointerId: 1 });
    expect(projection.getViewport()).toEqual(parked);
  });

  it('камера двигается только между pointerdown и pointerup пана', () => {
    const { projection, dispatch } = setupReady();
    const start = projection.getViewport();

    dispatch('pointermove', { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    expect(projection.getViewport()).toEqual(start);

    dispatch('pointerdown', { clientX: 300, clientY: 300, button: 2, pointerId: 1 });
    dispatch('pointermove', { clientX: 350, clientY: 340, button: 2, pointerId: 1 });
    const panned = projection.getViewport();
    expect(panned).not.toEqual(start);

    dispatch('pointerup', { clientX: 350, clientY: 340, button: 2, pointerId: 1 });
    dispatch('pointermove', { clientX: 600, clientY: 100, button: 0, pointerId: 1 });
    expect(projection.getViewport()).toEqual(panned);
  });
});

describe('Canvas2dProjection — захват указателя (ADR 0019 E5)', () => {
  it('жест автомата: pointerdown захватывает указатель, pointerup отпускает', () => {
    const { capture, release, dispatch } = setupReady();

    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 11 });
    expect(capture).toHaveBeenCalledWith(11);
    expect(release).not.toHaveBeenCalled();

    dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 11 });
    expect(release).toHaveBeenCalledWith(11);
    expect(release.mock.calls).toHaveLength(capture.mock.calls.length);
  });

  it('пан: pointerdown захватывает указатель, pointerup отпускает', () => {
    const { capture, release, dispatch } = setupReady();

    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 2, pointerId: 12 });
    expect(capture).toHaveBeenCalledWith(12);

    dispatch('pointerup', { clientX: 400, clientY: 300, button: 2, pointerId: 12 });
    expect(release).toHaveBeenCalledWith(12);
    expect(release.mock.calls).toHaveLength(capture.mock.calls.length);
  });

  it('pointercancel отпускает захват и жеста, и пана', () => {
    const { capture, release, dispatch } = setupReady();

    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 13 });
    dispatch('pointercancel', { clientX: 400, clientY: 300, button: 0, pointerId: 13 });
    expect(release).toHaveBeenLastCalledWith(13);

    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 2, pointerId: 14 });
    dispatch('pointercancel', { clientX: 400, clientY: 300, button: 2, pointerId: 14 });
    expect(release).toHaveBeenLastCalledWith(14);
    expect(release.mock.calls).toHaveLength(capture.mock.calls.length);
  });

  it('dispose() посреди жеста отпускает захват', () => {
    const { projection, capture, release, dispatch } = setupReady();

    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 15 });
    projection.dispose();

    expect(release).toHaveBeenCalledWith(15);
    expect(release.mock.calls).toHaveLength(capture.mock.calls.length);
  });

  it('dispose() посреди пана отпускает захват', () => {
    const { projection, capture, release, dispatch } = setupReady();

    dispatch('pointerdown', { clientX: 400, clientY: 300, button: 2, pointerId: 16 });
    projection.dispose();

    expect(release).toHaveBeenCalledWith(16);
    expect(release.mock.calls).toHaveLength(capture.mock.calls.length);
  });

  it('без жеста dispose() ничего не отпускает', () => {
    const { projection, capture, release } = setupReady();

    projection.dispose();

    expect(capture).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
});

describe('Canvas2dProjection — viewport единственного писателя (ADR 0020 P4)', () => {
  it('resize и любое движение камеры доезжают до ToolState.viewport', () => {
    const { projection, manager, resize, flush } = setupReady();

    expect(manager.tools.get().viewport).toEqual(projection.getViewport());
    expect(projection.getViewport()).toEqual({
      scale: scaleAt(ZOOM_SCALE_BASE_INDEX),
      center: { x: 0, y: 0 },
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    });

    resize(640, 480);
    flush();
    expect(manager.tools.get().viewport).toEqual(projection.getViewport());
    expect(manager.tools.get().viewport.width).toBe(640);

    projection.zoomBy(2);
    expect(manager.tools.get().viewport).toEqual(projection.getViewport());
    projection.panByKeyboard(-1, 0, 1);
    expect(manager.tools.get().viewport).toEqual(projection.getViewport());
  });

  it('resize ставит буфер канваса = CSS-размер × devicePixelRatio', () => {
    const { canvas, resize, flush } = setupReady();

    resize(500, 400, 2);
    flush();
    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(800);

    resize(500, 400, 1);
    flush();
    expect(canvas.width).toBe(500);
    expect(canvas.height).toBe(400);
  });
});

describe('Canvas2dProjection — шаг зума наружу (решение 7)', () => {
  it('getZoom() отдаёт индекс, масштаб и границы шкалы', () => {
    const { projection } = setupReady();

    expect(projection.getZoom()).toEqual({
      index: ZOOM_SCALE_BASE_INDEX,
      scale: 1,
      steps: ZOOM_SCALE_STEPS,
      canZoomIn: true,
      canZoomOut: true,
    });

    projection.zoomBy(ZOOM_SCALE_STEPS);
    expect(projection.getZoom()).toMatchObject({ index: ZOOM_SCALE_STEPS - 1, canZoomIn: false, canZoomOut: true });

    projection.zoomBy(-ZOOM_SCALE_STEPS);
    expect(projection.getZoom()).toMatchObject({ index: 0, canZoomIn: true, canZoomOut: false });
  });

  it('onZoomChanged уведомляет только на смене шага; пан молчит, отписка работает', () => {
    const { projection } = setupReady();
    const listener = jest.fn();
    const off = projection.onZoomChanged(listener);

    projection.zoomBy(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toMatchObject({ index: ZOOM_SCALE_BASE_INDEX + 1 });

    projection.panByKeyboard(1, 1, 1);
    expect(listener).toHaveBeenCalledTimes(1);

    // Край шкалы — шаг не изменился, уведомления нет.
    projection.zoomBy(ZOOM_SCALE_STEPS);
    listener.mockClear();
    projection.zoomBy(5);
    expect(listener).not.toHaveBeenCalled();

    off();
    projection.zoomBy(-3);
    expect(listener).not.toHaveBeenCalled();
  });

  it('после dispose() слушатели зума сняты', () => {
    const { projection } = setupReady();
    const listener = jest.fn();
    projection.onZoomChanged(listener);

    projection.dispose();
    projection.zoomBy(1);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('Canvas2dProjection — render-on-demand и приостановка (ADR 0020 P5)', () => {
  it('после resize кадры рисуются, затем луп засыпает и счётчик стоит', () => {
    const harness = setup();
    const projection = harness.create();

    harness.resize();
    expect(projection.isRendering).toBe(true);
    expect(harness.flush()).toBe(FRAME_BUDGET);
    expect(projection.getStats().frame).toBe(FRAME_BUDGET);
    expect(projection.isRendering).toBe(false);
    expect(harness.calls.length).toBeGreaterThan(0);

    // Покой: ни одного запланированного кадра, счётчик не растёт (гвард «idle FPS ≈ 0»).
    expect(harness.flush()).toBe(0);
    expect(projection.getStats().frame).toBe(FRAME_BUDGET);
    expect(harness.logger.error).not.toHaveBeenCalled();
  });

  it('на чужом виде invalidate() кадров не планирует, возврат в конструктор даёт конечное число кадров', () => {
    const { projection, manager, flush, pending } = setupReady();
    const drawn = projection.getStats().frame;

    manager.view.setActive('plan');
    flush();
    expect(projection.isActive).toBe(false);
    const parked = projection.getStats().frame;

    projection.invalidate();
    manager.document.setSettings({ wallHeight: 300 });
    expect(pending()).toBe(0);
    expect(projection.getStats().frame).toBe(parked);

    manager.view.setActive('constructor');
    expect(projection.isActive).toBe(true);
    expect(flush()).toBe(FRAME_BUDGET);
    expect(projection.getStats().frame).toBeGreaterThan(drawn);
  });

  it('изменение документа планирует кадр (подписка на шину)', () => {
    const { projection, manager, flush } = setupReady();
    const drawn = projection.getStats().frame;

    manager.document.setSettings({ wallHeight: 260 });

    expect(flush()).toBe(FRAME_BUDGET);
    expect(projection.getStats().frame).toBe(drawn + FRAME_BUDGET);
  });
});

describe('Canvas2dProjection — курсор (эталон холста)', () => {
  it('рисование — crosshair, наведение на точку — grab, пан — grabbing, покой — default', () => {
    const { canvas, manager, dispatch } = setupReady(ringDocument());
    expect(canvas.style.cursor).toBe(DRAFT_CURSORS.idle);

    manager.tools.start('walls');
    expect(canvas.style.cursor).toBe(DRAFT_CURSORS.drawing);

    manager.tools.cancel();
    // Точка плана (0, 0) кольца — центр кадра при дефолтной камере.
    dispatch('pointermove', { clientX: CANVAS_WIDTH / 2, clientY: CANVAS_HEIGHT / 2 });
    expect(manager.tools.get()).toMatchObject({ kind: 'editing', hover: { kind: 'point' } });
    expect(canvas.style.cursor).toBe(DRAFT_CURSORS.hover);

    dispatch('pointerdown', { clientX: 100, clientY: 100, button: 2, pointerId: 9 });
    expect(canvas.style.cursor).toBe(DRAFT_CURSORS.dragging);
    dispatch('pointerup', { clientX: 100, clientY: 100, button: 2, pointerId: 9 });
    expect(canvas.style.cursor).toBe(DRAFT_CURSORS.hover);
  });

  it('Space без нажатия кнопки — тоже grabbing', () => {
    const { canvas, projection } = setupReady();

    projection.setPanModifier(true);
    expect(canvas.style.cursor).toBe(DRAFT_CURSORS.dragging);

    projection.setPanModifier(false);
    expect(canvas.style.cursor).toBe(DRAFT_CURSORS.idle);
  });
});
