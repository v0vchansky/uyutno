/** @jest-environment jsdom */
import type React from 'react';
import { useEffect } from 'react';
import { act, render } from '@testing-library/react';

import { PlannerManager, type PlannerLogger } from '../../engine/PlannerManager';
import type { PlannerInstance, PlannerProjections } from '../../projection/createPlanner';
import { PlannerContext } from '../PlannerContext';
import { PlannerOverlayProvider, useReportLengthFocus, type LengthInputFocus } from '../PlannerOverlayContext';
import { KeyHints } from './KeyHints';
import { MAX_KEY_HINTS } from './keyHintsFor';

const silentLogger: PlannerLogger = { debug() {}, info() {}, warn() {}, error() {} };

const NO_MODS = { ctrl: false, meta: false, shift: false, alt: false };

/** Контекст несёт `PlannerInstance` (ADR 0020 P6); проекции полосе не нужны — она читает только фасад. */
const createInstance = (manager: PlannerManager): PlannerInstance => ({
  manager,
  projections: { three: {}, canvas2d: {} } as unknown as PlannerProjections,
  dispose: () => manager.dispose(),
});

/** Так фокус сообщает оверлей полей длины (0060): через сеттер общего контекста скина. */
const FocusReporter: React.FC<{ focus: LengthInputFocus | null }> = ({ focus }) => {
  const report = useReportLengthFocus();
  useEffect(() => report(focus), [report, focus]);
  return null;
};

interface RenderedHint {
  action: string;
  key: string | null;
  mouse: boolean;
}

const PANNING: RenderedHint = { action: 'Панорамирование', key: null, mouse: true };
const pair = (action: string, key: string | null = null): RenderedHint => ({ action, key, mouse: false });

describe('KeyHints', () => {
  let manager: PlannerManager;
  let container: HTMLElement;

  beforeEach(() => {
    manager = new PlannerManager({ projectId: 'p', logger: silentLogger });
  });

  afterEach(() => manager.dispose());

  const bar = (): HTMLElement | null => container.querySelector('[aria-live]');

  /** Разбирает полосу обратно в пары: разделители — пустые `span`, действие — первый текстовый узел пары. */
  const readHints = (): RenderedHint[] => {
    const root = bar();
    if (!root) return [];
    return Array.from(root.querySelectorAll(':scope > span'))
      .filter(item => item.textContent !== '')
      .map(item => ({
        action: item.childNodes[0]?.textContent ?? '',
        key: item.querySelector('kbd')?.textContent ?? null,
        mouse: item.querySelector('svg') !== null,
      }));
  };

  /** Полное дерево скина: планер + общий контекст оверлея, в котором живёт фокус полей длины. */
  const tree = (children?: React.ReactNode): React.ReactElement => (
    <PlannerContext value={createInstance(manager)}>
      <PlannerOverlayProvider>
        <KeyHints />
        {children}
      </PlannerOverlayProvider>
    </PlannerContext>
  );

  const renderBar = (children?: React.ReactNode) => {
    const result = render(tree(children));
    container = result.container;
    return {
      ...result,
      /** Перерисовать то же дерево с другими потребителями — так меняется фокус. */
      update: (next?: React.ReactNode) => result.rerender(tree(next)),
    };
  };

  describe('источник по умолчанию — автомат инструментов', () => {
    it('в editing показывает панорамирование иконкой мыши, а не словом «ПКМ»', () => {
      renderBar();
      expect(readHints()).toEqual([PANNING]);
      expect(bar()?.textContent).not.toContain('ПКМ');
    });

    it('старт «Стен» перерисовывает полосу на подсказки рисования', () => {
      renderBar();
      act(() => {
        manager.tools.start('walls');
      });
      expect(readHints()).toEqual([pair('Отменить рисование', 'Esc'), pair('Без снапа', 'Ctrl')]);
    });

    it('«Комната по точкам» — те же пары, что у «Стен»', () => {
      renderBar();
      act(() => {
        manager.tools.start('room');
      });
      expect(readHints()).toEqual([pair('Отменить рисование', 'Esc'), pair('Без снапа', 'Ctrl')]);
    });

    it('у «Прямоугольной комнаты» добавляется Tab, и пар всё ещё не больше трёх', () => {
      renderBar();
      act(() => {
        manager.tools.start('rect');
      });
      expect(readHints()).toEqual([
        pair('Отменить рисование', 'Esc'),
        pair('Без снапа', 'Ctrl'),
        pair('Другое поле', 'Tab'),
      ]);
      expect(readHints().length).toBeLessThanOrEqual(MAX_KEY_HINTS);
    });

    it('драг вершины и драг стороны — Ctrl первым, Esc вторым', () => {
      renderBar();
      // Кольцо 400×300 рисуется кликами, дальше вершина (0,0) тащится за порог драга.
      act(() => {
        manager.tools.start('walls');
        for (const [x, y] of [
          [0, 0],
          [400, 0],
          [400, 300],
          [0, 300],
        ] as const) {
          manager.tools.pointerDown({ x, y, mods: NO_MODS, button: 0 });
          manager.tools.pointerUp({ x, y, mods: NO_MODS, button: 0 });
        }
        manager.tools.pointerMove({ x: 0, y: 0, mods: NO_MODS, button: 0 });
        manager.tools.pointerDown({ x: 0, y: 0, mods: NO_MODS, button: 0 });
        manager.tools.pointerUp({ x: 0, y: 0, mods: NO_MODS, button: 0 });
      });
      expect(manager.tools.get().kind).toBe('editing');

      act(() => {
        manager.tools.pointerDown({ x: 0, y: 0, mods: NO_MODS, button: 0 });
        manager.tools.pointerMove({ x: 60, y: 60, mods: NO_MODS, button: 0 });
      });
      expect(manager.tools.get().kind).toBe('dragging-point');
      expect(readHints()).toEqual([pair('Без снапа', 'Ctrl'), pair('Отменить жест', 'Esc')]);
    });
  });

  describe('второй источник — фокус в полях длины', () => {
    it('рисование, полей несколько: Tab, Enter, Esc', () => {
      renderBar(<FocusReporter focus={{ mode: 'drawing', hasSiblings: true }} />);
      expect(readHints()).toEqual([
        pair('Другое поле', 'Tab'),
        pair('Поставить точку', 'Enter'),
        pair('Отменить', 'Esc'),
      ]);
    });

    it('рисование, поле одно: без Tab', () => {
      renderBar(<FocusReporter focus={{ mode: 'drawing', hasSiblings: false }} />);
      expect(readHints()).toEqual([pair('Поставить точку', 'Enter'), pair('Отменить', 'Esc')]);
    });

    it('правка длины: Применить, Отменить и пара без клавиши про формы', () => {
      renderBar(<FocusReporter focus={{ mode: 'editing', hasSiblings: true }} />);
      expect(readHints()).toEqual([pair('Применить', 'Enter'), pair('Отменить', 'Esc'), pair('Формы +N / −N')]);
    });

    it('фокус перебивает подсказку автомата в рисовании', () => {
      renderBar(<FocusReporter focus={{ mode: 'drawing', hasSiblings: true }} />);
      act(() => {
        manager.tools.start('walls');
      });
      expect(bar()?.textContent).not.toContain('Отменить рисование');
      expect(readHints()[0]).toEqual(pair('Другое поле', 'Tab'));
    });

    it('фокус снят (null) — вернулась подсказка автомата', () => {
      const { update } = renderBar(<FocusReporter focus={{ mode: 'drawing', hasSiblings: true }} />);
      expect(readHints()[0]?.action).toBe('Другое поле');

      update(<FocusReporter focus={null} />);
      expect(readHints()).toEqual([PANNING]);
    });
  });

  describe('вне провайдера оверлея', () => {
    it('полоса работает и показывает подсказки автомата', () => {
      // `usePlannerLengthFocus` вне провайдера отдаёт `null`, и остаётся единственный источник — автомат.
      const result = render(
        <PlannerContext value={createInstance(manager)}>
          <KeyHints />
        </PlannerContext>,
      );
      container = result.container;
      expect(readHints()).toEqual([PANNING]);
      expect(() => result.unmount()).not.toThrow();
    });
  });

  describe('доступность и клавиатура', () => {
    it('у корня полосы aria-live="polite"', () => {
      renderBar();
      expect(bar()?.getAttribute('aria-live')).toBe('polite');
    });

    it('клавиатурных слушателей нет: keydown мимо полосы ничего не меняет', () => {
      renderBar();
      act(() => {
        manager.tools.start('walls');
      });
      const before = manager.tools.get();
      const rendered = readHints();

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });

      expect(manager.tools.get()).toBe(before);
      expect(readHints()).toEqual(rendered);
    });
  });
});
