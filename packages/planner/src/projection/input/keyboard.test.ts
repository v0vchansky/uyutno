/** @jest-environment jsdom */
import type { PlannerDocument } from '../../document/PlannerDocument';
import type { PlannerLogger } from '../../engine/PlannerManager';
import { createTestManager } from '../../engine/testing/testManager';
import { KeyboardInput } from './keyboard';
import { NUDGE_FACTOR_FAST } from './keymap';

const createLogger = (): PlannerLogger => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() });

interface KeyInit {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

const cleanups: (() => void)[] = [];

const setup = (options: { document?: PlannerDocument; pan?: boolean } = {}) => {
  const listen = jest.spyOn(window, 'addEventListener');
  const unlisten = jest.spyOn(window, 'removeEventListener');
  const tm = createTestManager(options.document, createLogger());
  const { manager } = tm;
  const onPan = jest.fn<boolean, [number, number, number]>(() => options.pan ?? true);
  const onPanModifier = jest.fn<void, [boolean]>();
  const keyboard = new KeyboardInput(manager, window, { onPan, onPanModifier });

  /** Источник событий: клавиша всплывает от элемента, как в живом DOM (`event.target` — этот элемент). */
  const source = document.createElement('div');
  document.body.append(source);

  const press = (type: 'keydown' | 'keyup', init: KeyInit, from: HTMLElement = source): KeyboardEvent => {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    from.dispatchEvent(event);
    return event;
  };

  cleanups.push(() => {
    keyboard.dispose();
    source.remove();
    manager.dispose();
  });

  return { keyboard, manager, onPan, onPanModifier, press, source, listen, unlisten };
};

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.body.replaceChildren();
  jest.restoreAllMocks();
});

describe('KeyboardInput — единственный владелец клавиатуры (ADR 0019 E5, ADR 0020 P6)', () => {
  it('вешает ровно один keydown, один keyup и один blur на window', () => {
    const { listen } = setup();
    const types = listen.mock.calls.map(call => call[0]);
    expect(types.filter(type => type === 'keydown')).toHaveLength(1);
    expect(types.filter(type => type === 'keyup')).toHaveLength(1);
    expect(types.filter(type => type === 'blur')).toHaveLength(1);
  });

  it('Esc, Ctrl+Z и Ctrl+Y доезжают до автомата нужным KeyAction', () => {
    const { manager, press } = setup();
    const key = jest.spyOn(manager.tools, 'key');

    press('keydown', { key: 'Escape' });
    press('keydown', { key: 'z', ctrlKey: true });
    press('keydown', { key: 'y', ctrlKey: true });
    press('keydown', { key: 'z', metaKey: true, shiftKey: true });

    expect(key.mock.calls.map(call => call[0])).toEqual([
      { kind: 'cancel' },
      { kind: 'undo' },
      { kind: 'redo' },
      { kind: 'redo' },
    ]);
  });

  it('обработанное автоматом действие гасит событие браузера', () => {
    const { press } = setup();
    // Esc автомат берёт всегда (`cancel`).
    expect(press('keydown', { key: 'Escape' }).defaultPrevented).toBe(true);
  });

  it('чужие клавиши не наши: в автомат не идут и событие не гасят', () => {
    const { manager, press } = setup();
    const key = jest.spyOn(manager.tools, 'key');

    const event = press('keydown', { key: 'F5' });

    expect(key).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('guard: фокус в input/textarea/contentEditable — не перехватывается ничего', () => {
    const { manager, press, onPanModifier } = setup();
    const key = jest.spyOn(manager.tools, 'key');

    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.append(input, textarea, editable);

    for (const element of [input, textarea, editable]) {
      expect(press('keydown', { key: 'Escape' }, element).defaultPrevented).toBe(false);
      expect(press('keydown', { key: 'z', ctrlKey: true }, element).defaultPrevented).toBe(false);
      expect(press('keydown', { key: ' ' }, element).defaultPrevented).toBe(false);
      press('keydown', { key: 'ArrowRight' }, element);
    }

    expect(key).not.toHaveBeenCalled();
    expect(onPanModifier).not.toHaveBeenCalled();
  });

  it('событие с defaultPrevented игнорируется', () => {
    const { manager, press, source } = setup();
    const key = jest.spyOn(manager.tools, 'key');
    source.addEventListener('keydown', event => event.preventDefault());

    press('keydown', { key: 'Escape' });

    expect(key).not.toHaveBeenCalled();
  });
});

describe('KeyboardInput — ручной Save (спека 10, задача 0082)', () => {
  it('Ctrl+S и Cmd+S зовут ручное сохранение и гасят браузерное «сохранить страницу»', () => {
    const { manager, press } = setup();
    const save = jest.spyOn(manager.persistence, 'save');

    expect(press('keydown', { key: 's', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press('keydown', { key: 'S', metaKey: true }).defaultPrevented).toBe(true);

    expect(save.mock.calls).toEqual([['manual'], ['manual']]);
  });

  it('Ctrl+S в автомат инструментов не уходит: сохранение — не действие конструктора', () => {
    const { manager, press } = setup();
    const key = jest.spyOn(manager.tools, 'key');

    press('keydown', { key: 's', ctrlKey: true });

    expect(key).not.toHaveBeenCalled();
  });

  it('во время жеста уходит та же точка входа — откладывание делает persistence, а не клавиатура', () => {
    const { manager, press } = setup();
    const save = jest.spyOn(manager.persistence, 'save');
    expect(manager.tools.start('walls').ok).toBe(true);

    press('keydown', { key: 's', ctrlKey: true });

    expect(save).toHaveBeenCalledWith('manual');
  });

  it('фокус в поле ввода длины — Ctrl+S не перехватывается, как и остальные горячие клавиши', () => {
    const { manager, press } = setup();
    const save = jest.spyOn(manager.persistence, 'save');
    const field = document.createElement('input');
    document.body.append(field);

    expect(press('keydown', { key: 's', ctrlKey: true }, field).defaultPrevented).toBe(false);

    expect(save).not.toHaveBeenCalled();
  });
});

describe('KeyboardInput — нудж и пан', () => {
  it('нудж, который автомат не взял, уходит в onPan и только тогда гасит событие', () => {
    const { press, onPan } = setup();

    // Выделения нет — `editing` возвращает `{ handled: false }`, значит камеру двигает вьювер.
    const event = press('keydown', { key: 'ArrowRight', shiftKey: true });

    expect(onPan).toHaveBeenCalledWith(1, 0, NUDGE_FACTOR_FAST);
    expect(event.defaultPrevented).toBe(true);
  });

  it('если вьювер пан не выполнил (чужой вид) — событие не гасится', () => {
    const { press, onPan } = setup({ pan: false });

    const event = press('keydown', { key: 'ArrowUp' });

    expect(onPan).toHaveBeenCalledWith(0, 1, 1);
    expect(event.defaultPrevented).toBe(false);
  });

  it('нудж, взятый автоматом, в onPan не уходит', () => {
    const { manager, press, onPan } = setup();
    jest.spyOn(manager.tools, 'key').mockReturnValue({ handled: true });

    const event = press('keydown', { key: 'ArrowLeft' });

    expect(onPan).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('Space ставит и снимает модификатор пана и гасит прокрутку страницы', () => {
    const { manager, press, onPanModifier } = setup();
    const key = jest.spyOn(manager.tools, 'key');

    const down = press('keydown', { key: ' ' });
    expect(onPanModifier).toHaveBeenLastCalledWith(true);
    expect(down.defaultPrevented).toBe(true);
    // Space в автомат не уходит вовсе.
    expect(key).not.toHaveBeenCalled();

    press('keyup', { key: ' ' });
    expect(onPanModifier).toHaveBeenLastCalledWith(false);
  });
});

describe('KeyboardInput — потеря фокуса и освобождение', () => {
  it('blur окна снимает Space; сам tools.blur() — забота Canvas2D-проекции (одно событие, один вызов)', () => {
    const { manager, press, onPanModifier } = setup();
    const blur = jest.spyOn(manager.tools, 'blur');

    press('keydown', { key: ' ' });
    onPanModifier.mockClear();
    window.dispatchEvent(new Event('blur'));

    expect(onPanModifier).toHaveBeenCalledTimes(1);
    expect(onPanModifier).toHaveBeenCalledWith(false);
    // `blur` окна слушают оба владельца ввода; прерывание жеста делает проекция (ADR 0020 P1).
    expect(blur).not.toHaveBeenCalled();
  });

  it('dispose(): снимает слушатели, сбрасывает Space; повторный вызов — no-op', () => {
    const { keyboard, manager, press, onPan, onPanModifier, unlisten } = setup();
    const key = jest.spyOn(manager.tools, 'key');

    press('keydown', { key: ' ' });
    onPanModifier.mockClear();

    keyboard.dispose();
    keyboard.dispose();

    expect(keyboard.isDisposed).toBe(true);
    expect(onPanModifier).toHaveBeenCalledTimes(1);
    expect(onPanModifier).toHaveBeenCalledWith(false);
    const removed = unlisten.mock.calls.map(call => call[0]);
    expect(removed).toEqual(expect.arrayContaining(['keydown', 'keyup', 'blur']));

    press('keydown', { key: 'Escape' });
    press('keydown', { key: 'ArrowRight' });
    press('keyup', { key: ' ' });
    window.dispatchEvent(new Event('blur'));

    expect(key).not.toHaveBeenCalled();
    expect(onPan).not.toHaveBeenCalled();
    // Ни одного лишнего `onPanModifier` после снятия слушателей.
    expect(onPanModifier).toHaveBeenCalledTimes(1);
  });
});
