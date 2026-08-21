/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import type { PersistenceState } from '@uyutno/planner';

import { SAVED_HOLD_MS, SAVING_TAIL_MS, useSaveButtonFeedback } from './useSaveButtonFeedback';

/**
 * Обратная связь на кнопке «Сохранить» (задача 0090). Проверяется **фейковыми таймерами**, а не ожиданием:
 * вся суть механики — в сроках, и тест, который их пересиживает, платит реальными секундами за каждую ветку.
 *
 * Почему механика вообще нужна: измерение на dev-стенде дало 9–24 мс на `PUT …/document` (медиана ~11 мс) —
 * меньше одного кадра экрана. Без хвоста спиннер физически не успевает быть увиденным, на что автор и
 * пожаловался.
 */

const state = (patch: Partial<PersistenceState>): PersistenceState => ({
  status: 'idle',
  savedAt: null,
  savedReason: null,
  updatedAt: null,
  lastError: null,
  failedAt: null,
  alert: null,
  dirty: false,
  ...patch,
});

const SAVING = state({ status: 'saving', dirty: true });

/** Успех «прямо сейчас»: время берётся с тех же (фейковых) часов, с которых его читает хук. */
const savedNow = (savedReason: PersistenceState['savedReason']): PersistenceState =>
  state({ status: 'saved', savedAt: Date.now(), savedReason });

const render = () => renderHook(props => useSaveButtonFeedback(props), { initialProps: state({}) });

/** Прогон времени внутри `act`: таймеры хука меняют состояние React, и без `act` обновление потеряется. */
const advance = (ms: number): void => {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useSaveButtonFeedback — спиннер живёт дольше самого запроса', () => {
  it('мгновенный ответ сервера всё равно держит «Сохраняем…» весь хвост', () => {
    const { result, rerender } = render();
    expect(result.current).toBe('idle');

    rerender(SAVING);
    expect(result.current).toBe('saving');

    // Реальная длительность запроса на стенде — около 11 мс.
    advance(11);
    rerender(savedNow('manual'));
    expect(result.current).toBe('saving');

    advance(SAVING_TAIL_MS - 1);
    expect(result.current).toBe('saving');

    advance(1);
    expect(result.current).toBe('saved');
  });

  it('галочка держится ощутимое время и уходит сама', () => {
    const { result, rerender } = render();
    rerender(SAVING);
    rerender(savedNow('manual'));

    advance(SAVING_TAIL_MS);
    expect(result.current).toBe('saved');

    advance(SAVED_HOLD_MS - 1);
    expect(result.current).toBe('saved');

    advance(1);
    expect(result.current).toBe('idle');
  });

  it('медленный ответ не удлиняет хвост пропорционально — он постоянный', () => {
    const { result, rerender } = render();
    rerender(SAVING);

    advance(3_000);
    expect(result.current).toBe('saving');

    rerender(savedNow('manual'));
    advance(SAVING_TAIL_MS);
    expect(result.current).toBe('saved');
  });
});

describe('useSaveButtonFeedback — чья это обратная связь', () => {
  it('фоновый автосейв галочки не показывает и хвоста не получает', () => {
    const { result, rerender } = render();
    rerender(SAVING);
    rerender(savedNow('autosave'));

    expect(result.current).toBe('idle');
    advance(SAVING_TAIL_MS + SAVED_HOLD_MS);
    expect(result.current).toBe('idle');
  });

  it('отказ галочки не даёт: ошибку показывает модалка, а не кнопка', () => {
    const { result, rerender } = render();
    rerender(SAVING);
    rerender(state({ status: 'error', failedAt: Date.now(), dirty: true }));

    expect(result.current).toBe('idle');
    advance(SAVING_TAIL_MS + SAVED_HOLD_MS);
    expect(result.current).toBe('idle');
  });

  it('офлайн — тоже без галочки: сохранено ничего не было', () => {
    const { result, rerender } = render();
    rerender(SAVING);
    rerender(state({ status: 'offline', failedAt: Date.now(), dirty: true }));

    expect(result.current).toBe('idle');
    advance(SAVING_TAIL_MS + SAVED_HOLD_MS);
    expect(result.current).toBe('idle');
  });

  it('планера ещё нет — покой, а не «идёт запись»', () => {
    const { result } = renderHook(props => useSaveButtonFeedback(props), { initialProps: null });
    expect(result.current).toBe('idle');
  });

  it('новая запись поверх доживающей галочки возвращает спиннер и гасит её хвост', () => {
    const { result, rerender } = render();
    rerender(SAVING);
    rerender(savedNow('manual'));
    advance(SAVING_TAIL_MS);
    expect(result.current).toBe('saved');

    rerender(SAVING);
    expect(result.current).toBe('saving');
    // Хвост прошлого цикла погашен: старая галочка не всплывает поверх нового спиннера.
    advance(SAVED_HOLD_MS);
    expect(result.current).toBe('saving');
  });

  it('второй ручной Save получает свой полный цикл, а не остаток прошлого', () => {
    const { result, rerender } = render();
    rerender(SAVING);
    rerender(savedNow('manual'));
    advance(SAVING_TAIL_MS + SAVED_HOLD_MS);
    expect(result.current).toBe('idle');

    rerender(SAVING);
    rerender(savedNow('manual'));
    expect(result.current).toBe('saving');
    advance(SAVING_TAIL_MS);
    expect(result.current).toBe('saved');
    advance(SAVED_HOLD_MS);
    expect(result.current).toBe('idle');
  });
});
