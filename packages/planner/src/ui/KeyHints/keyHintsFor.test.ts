import type { ToolKind } from '../../engine/tools/ToolState';
import type { LengthInputFocus } from '../PlannerOverlayContext';
import { clampKeyHints, keyHintsFor, keyHintsForFocus, MAX_KEY_HINTS, type KeyHint } from './keyHintsFor';

/** Все шесть состояний автомата (ADR 0019 E1) — таблица handoff'а обязана покрывать каждое. */
const ALL_KINDS: readonly ToolKind[] = [
  'editing',
  'making-walls',
  'making-rect',
  'making-room',
  'dragging-point',
  'dragging-wall',
];

describe('keyHintsFor', () => {
  it('editing — одна пара: панорамирование правой кнопкой мыши', () => {
    expect(keyHintsFor('editing')).toEqual([{ action: 'Панорамирование', key: { mouse: 'right' } }]);
  });

  it('making-walls — отмена рисования и выключение снапа, в этом порядке', () => {
    expect(keyHintsFor('making-walls')).toEqual([
      { action: 'Отменить рисование', key: 'Esc' },
      { action: 'Без снапа', key: 'Ctrl' },
    ]);
  });

  it('making-room — те же пары, что у «Стен»', () => {
    expect(keyHintsFor('making-room')).toEqual([
      { action: 'Отменить рисование', key: 'Esc' },
      { action: 'Без снапа', key: 'Ctrl' },
    ]);
  });

  it('making-rect — то же плюс «Другое поле — Tab» третьей парой', () => {
    expect(keyHintsFor('making-rect')).toEqual([
      { action: 'Отменить рисование', key: 'Esc' },
      { action: 'Без снапа', key: 'Ctrl' },
      { action: 'Другое поле', key: 'Tab' },
    ]);
  });

  it('dragging-point — снап важнее отмены: Ctrl первым, Esc вторым', () => {
    expect(keyHintsFor('dragging-point')).toEqual([
      { action: 'Без снапа', key: 'Ctrl' },
      { action: 'Отменить жест', key: 'Esc' },
    ]);
  });

  it('dragging-wall — те же пары, что у драга вершины', () => {
    expect(keyHintsFor('dragging-wall')).toEqual([
      { action: 'Без снапа', key: 'Ctrl' },
      { action: 'Отменить жест', key: 'Esc' },
    ]);
  });

  it('ни одно состояние не отдаёт больше трёх пар', () => {
    for (const kind of ALL_KINDS) expect(keyHintsFor(kind).length).toBeLessThanOrEqual(MAX_KEY_HINTS);
  });

  it('ссылка на набор стабильна между вызовами — селектор не гоняет ре-рендер', () => {
    expect(keyHintsFor('making-walls')).toBe(keyHintsFor('making-walls'));
  });
});

describe('keyHintsForFocus', () => {
  const focus = (mode: LengthInputFocus['mode'], hasSiblings: boolean): LengthInputFocus => ({ mode, hasSiblings });

  it('рисование, полей несколько — Tab, Enter ставит точку, Esc отменяет', () => {
    expect(keyHintsForFocus(focus('drawing', true))).toEqual([
      { action: 'Другое поле', key: 'Tab' },
      { action: 'Поставить точку', key: 'Enter' },
      { action: 'Отменить', key: 'Esc' },
    ]);
  });

  it('рисование, поле одно — без Tab: переносить фокус некуда', () => {
    expect(keyHintsForFocus(focus('drawing', false))).toEqual([
      { action: 'Поставить точку', key: 'Enter' },
      { action: 'Отменить', key: 'Esc' },
    ]);
  });

  it('правка длины — Enter применяет, плюс пара без клавиши про формы +N / −N', () => {
    expect(keyHintsForFocus(focus('editing', true))).toEqual([
      { action: 'Применить', key: 'Enter' },
      { action: 'Отменить', key: 'Esc' },
      { action: 'Формы +N / −N' },
    ]);
  });

  it('в правке длины hasSiblings ничего не меняет — Tab там не при чём', () => {
    expect(keyHintsForFocus(focus('editing', false))).toBe(keyHintsForFocus(focus('editing', true)));
  });

  it('ни одна ветка фокуса не длиннее трёх пар', () => {
    for (const mode of ['drawing', 'editing'] as const) {
      for (const hasSiblings of [true, false]) {
        expect(keyHintsForFocus(focus(mode, hasSiblings)).length).toBeLessThanOrEqual(MAX_KEY_HINTS);
      }
    }
  });

  it('ссылка на набор стабильна между вызовами — новый объект фокуса не гоняет ре-рендер', () => {
    expect(keyHintsForFocus(focus('drawing', true))).toBe(keyHintsForFocus(focus('drawing', true)));
    expect(keyHintsForFocus(focus('drawing', false))).toBe(keyHintsForFocus(focus('drawing', false)));
  });
});

describe('clampKeyHints', () => {
  const hint = (action: string): KeyHint => ({ action, key: 'X' });

  it('вход длиннее трёх обрезается справа: остаются первые, приоритетные', () => {
    const hints = [hint('a'), hint('b'), hint('c'), hint('d'), hint('e')];
    expect(clampKeyHints(hints)).toEqual([hint('a'), hint('b'), hint('c')]);
  });

  it('вход ровно из трёх не меняется и возвращается той же ссылкой', () => {
    const hints = [hint('a'), hint('b'), hint('c')];
    expect(clampKeyHints(hints)).toBe(hints);
  });

  it('вход короче предела не меняется и возвращается той же ссылкой', () => {
    const hints = [hint('a')];
    expect(clampKeyHints(hints)).toBe(hints);
    expect(clampKeyHints([])).toEqual([]);
  });
});
