import {
  NUDGE_FACTOR_FAST,
  NUDGE_FACTOR_FINE,
  isEditableTarget,
  isPanModifierKey,
  keyToAction,
  type KeyEventLike,
} from './keymap';

/** Событие клавиатуры минимальной формы: по умолчанию — без модификаторов. */
const ev = (key: string, mods: Partial<Omit<KeyEventLike, 'key'>> = {}): KeyEventLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

/** Цель события — только то, что читает guard (без DOM). */
const target = (value: { tagName?: string; isContentEditable?: boolean }): EventTarget => value as EventTarget;

describe('keymap — раскладка клавиш конструктора (ADR 0019 E5)', () => {
  describe('keyToAction: cancel', () => {
    it('Esc → cancel', () => {
      expect(keyToAction(ev('Escape'))).toEqual({ kind: 'cancel' });
    });

    it('регистр клавиши не важен', () => {
      expect(keyToAction(ev('escape'))).toEqual({ kind: 'cancel' });
      expect(keyToAction(ev('ESCAPE'))).toEqual({ kind: 'cancel' });
    });

    it('Esc с модификаторами — всё равно cancel', () => {
      expect(keyToAction(ev('Escape', { ctrlKey: true }))).toEqual({ kind: 'cancel' });
      expect(keyToAction(ev('Escape', { shiftKey: true, altKey: true }))).toEqual({ kind: 'cancel' });
    });
  });

  describe('keyToAction: undo / redo', () => {
    it('Ctrl+Z и Cmd+Z → undo', () => {
      expect(keyToAction(ev('z', { ctrlKey: true }))).toEqual({ kind: 'undo' });
      expect(keyToAction(ev('z', { metaKey: true }))).toEqual({ kind: 'undo' });
      expect(keyToAction(ev('Z', { metaKey: true }))).toEqual({ kind: 'undo' });
    });

    it('Ctrl+Shift+Z и Cmd+Shift+Z → redo', () => {
      expect(keyToAction(ev('z', { ctrlKey: true, shiftKey: true }))).toEqual({ kind: 'redo' });
      expect(keyToAction(ev('Z', { metaKey: true, shiftKey: true }))).toEqual({ kind: 'redo' });
    });

    it('Ctrl+Y и Cmd+Y → redo', () => {
      expect(keyToAction(ev('y', { ctrlKey: true }))).toEqual({ kind: 'redo' });
      expect(keyToAction(ev('Y', { metaKey: true }))).toEqual({ kind: 'redo' });
    });

    it('Z и Y без Ctrl/Cmd в автомат не уходят', () => {
      expect(keyToAction(ev('z'))).toBeNull();
      expect(keyToAction(ev('y'))).toBeNull();
      expect(keyToAction(ev('z', { shiftKey: true }))).toBeNull();
    });
  });

  describe('keyToAction: delete', () => {
    it('Delete и Backspace → delete', () => {
      expect(keyToAction(ev('Delete'))).toEqual({ kind: 'delete' });
      expect(keyToAction(ev('Backspace'))).toEqual({ kind: 'delete' });
      expect(keyToAction(ev('delete'))).toEqual({ kind: 'delete' });
    });

    it('Shift не мешает удалению', () => {
      expect(keyToAction(ev('Delete', { shiftKey: true }))).toEqual({ kind: 'delete' });
    });

    it('с Ctrl/Cmd/Alt → null: это браузерные сочетания, не наши', () => {
      expect(keyToAction(ev('Delete', { ctrlKey: true }))).toBeNull();
      expect(keyToAction(ev('Delete', { metaKey: true }))).toBeNull();
      expect(keyToAction(ev('Backspace', { ctrlKey: true }))).toBeNull();
      expect(keyToAction(ev('Backspace', { metaKey: true }))).toBeNull();
      expect(keyToAction(ev('Backspace', { altKey: true }))).toBeNull();
      expect(keyToAction(ev('Delete', { altKey: true }))).toBeNull();
    });
  });

  describe('keyToAction: nudge — направления в осях плана (y вверх)', () => {
    it.each<[string, number, number]>([
      ['ArrowUp', 0, 1],
      ['ArrowDown', 0, -1],
      ['ArrowLeft', -1, 0],
      ['ArrowRight', 1, 0],
      ['w', 0, 1],
      ['s', 0, -1],
      ['a', -1, 0],
      ['d', 1, 0],
    ])('%s → dx %p, dy %p', (key, dx, dy) => {
      expect(keyToAction(ev(key))).toEqual({ kind: 'nudge', dx, dy, factor: 1 });
    });

    it('регистр клавиш не важен: W = w, ARROWUP = ArrowUp', () => {
      expect(keyToAction(ev('W'))).toEqual(keyToAction(ev('w')));
      expect(keyToAction(ev('ARROWUP'))).toEqual(keyToAction(ev('ArrowUp')));
      expect(keyToAction(ev('D'))).toEqual({ kind: 'nudge', dx: 1, dy: 0, factor: 1 });
    });

    it('без Shift множитель 1, с Shift — NUDGE_FACTOR_FAST', () => {
      expect(NUDGE_FACTOR_FAST).toBe(10);
      expect(keyToAction(ev('ArrowUp'))).toMatchObject({ factor: 1 });
      expect(keyToAction(ev('ArrowUp', { shiftKey: true }))).toEqual({ kind: 'nudge', dx: 0, dy: 1, factor: 10 });
      expect(keyToAction(ev('w', { shiftKey: true }))).toMatchObject({ factor: NUDGE_FACTOR_FAST });
    });

    it('Shift + Ctrl + стрелка — точный шаг NUDGE_FACTOR_FINE', () => {
      expect(NUDGE_FACTOR_FINE).toBe(0.1);
      expect(keyToAction(ev('ArrowLeft', { shiftKey: true, ctrlKey: true }))).toEqual({
        kind: 'nudge',
        dx: -1,
        dy: 0,
        factor: NUDGE_FACTOR_FINE,
      });
    });

    it('Shift + Cmd + стрелка — тот же точный шаг', () => {
      expect(keyToAction(ev('ArrowUp', { shiftKey: true, metaKey: true }))).toEqual({
        kind: 'nudge',
        dx: 0,
        dy: 1,
        factor: NUDGE_FACTOR_FINE,
      });
    });

    it('Ctrl/Cmd без Shift у стрелок множитель не меняет: остаётся 1', () => {
      expect(keyToAction(ev('ArrowRight', { ctrlKey: true }))).toEqual({ kind: 'nudge', dx: 1, dy: 0, factor: 1 });
      expect(keyToAction(ev('ArrowDown', { metaKey: true }))).toEqual({ kind: 'nudge', dx: 0, dy: -1, factor: 1 });
    });

    it.each<string>(['w', 'a', 's', 'd'])(
      'WASD (%s) с Ctrl/Cmd/Alt → null: браузерные сочетания не перехватываем',
      key => {
        expect(keyToAction(ev(key, { ctrlKey: true }))).toBeNull();
        expect(keyToAction(ev(key, { metaKey: true }))).toBeNull();
        expect(keyToAction(ev(key, { altKey: true }))).toBeNull();
      },
    );

    it('поимённо: Ctrl+W, Cmd+S, Cmd+A, Cmd+D остаются браузеру', () => {
      expect(keyToAction(ev('w', { ctrlKey: true }))).toBeNull();
      expect(keyToAction(ev('s', { metaKey: true }))).toBeNull();
      expect(keyToAction(ev('a', { metaKey: true }))).toBeNull();
      expect(keyToAction(ev('d', { metaKey: true }))).toBeNull();
    });

    it('WASD с Shift + Ctrl/Cmd тоже null: точный шаг — только у стрелок', () => {
      expect(keyToAction(ev('w', { shiftKey: true, ctrlKey: true }))).toBeNull();
      expect(keyToAction(ev('d', { shiftKey: true, metaKey: true }))).toBeNull();
    });

    it('Alt на нудж не претендует ни у стрелок, ни у WASD', () => {
      expect(keyToAction(ev('ArrowLeft', { altKey: true }))).toBeNull();
      expect(keyToAction(ev('ArrowUp', { altKey: true }))).toBeNull();
      expect(keyToAction(ev('w', { altKey: true }))).toBeNull();
      expect(keyToAction(ev('ArrowUp', { altKey: true, shiftKey: true }))).toBeNull();
    });
  });

  describe('keyToAction: чужие клавиши', () => {
    it.each<string>(['q', 'Enter', 'Tab', 'F5', 'PageUp', ' ', '1'])('%p → null', key => {
      expect(keyToAction(ev(key))).toBeNull();
    });
  });

  describe('isPanModifierKey', () => {
    it('Space в обеих раскладках имён → true', () => {
      expect(isPanModifierKey(ev(' '))).toBe(true);
      expect(isPanModifierKey(ev('Spacebar'))).toBe(true);
    });

    it('прочие клавиши → false', () => {
      expect(isPanModifierKey(ev('Escape'))).toBe(false);
      expect(isPanModifierKey(ev('w'))).toBe(false);
      expect(isPanModifierKey(ev('Space'))).toBe(false);
      expect(isPanModifierKey(ev(''))).toBe(false);
    });
  });

  describe('isEditableTarget', () => {
    it('фокуса нет (null) → false: перехватываем', () => {
      expect(isEditableTarget(null)).toBe(false);
    });

    it.each<string>(['INPUT', 'TEXTAREA', 'SELECT', 'input', 'TextArea'])('поле ввода (%s) → true', tagName => {
      expect(isEditableTarget(target({ tagName }))).toBe(true);
    });

    it('contenteditable → true', () => {
      expect(isEditableTarget(target({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
    });

    it.each<string>(['CANVAS', 'DIV', 'BUTTON'])('обычный элемент (%s) → false', tagName => {
      expect(isEditableTarget(target({ tagName }))).toBe(false);
    });

    it('объект без tagName и без isContentEditable → false', () => {
      expect(isEditableTarget(target({}))).toBe(false);
      expect(isEditableTarget(target({ isContentEditable: false }))).toBe(false);
    });
  });
});
