import type { PersistenceState, SaveAlert } from '@uyutno/planner';

import { saveAlertView, saveIndicatorView } from './saveIndicatorState';

/**
 * Отображение состояния `persistence` в шапку (задача 0084; handoff `planner-editor-ui.md`, «Индикатор
 * состояния сохранения»). Проверяется без React и без сети: это таблица состояний из макета, а не вёрстка.
 */

/** Часы клиента строятся из локального времени — формат `HH:MM` не должен зависеть от таймзоны прогона. */
const AT = new Date(2026, 7, 21, 14, 32).getTime();
const EARLIER = new Date(2026, 7, 21, 9, 5).getTime();

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

const alert = (patch: Partial<SaveAlert>): SaveAlert => ({ kind: 'unknown', detail: null, at: AT, ...patch });

describe('saveIndicatorView', () => {
  it('покой — статуса нет вовсе', () => {
    expect(saveIndicatorView(state({}))).toEqual({ kind: 'none' });
  });

  it('планер ещё не поднят — статуса нет', () => {
    expect(saveIndicatorView(null)).toEqual({ kind: 'none' });
  });

  it('идёт запись — статуса нет: «Сохраняем…» несёт кнопка', () => {
    expect(saveIndicatorView(state({ status: 'saving', dirty: true }))).toEqual({ kind: 'none' });
  });

  it('ручной Save — «Сохранено, HH:MM» акцентной галочкой', () => {
    expect(saveIndicatorView(state({ status: 'saved', savedAt: AT, savedReason: 'manual' }))).toEqual({
      kind: 'saved',
      reason: 'manual',
      label: 'Сохранено, 14:32',
    });
  });

  it('автосейв — то же семейство, другое слово и приглушённая иконка', () => {
    expect(saveIndicatorView(state({ status: 'saved', savedAt: EARLIER, savedReason: 'autosave' }))).toEqual({
      kind: 'saved',
      reason: 'autosave',
      label: 'Автосохранено, 09:05',
    });
  });

  it('локальный черновик демо статуса не рисует — на демо индикатора нет вовсе', () => {
    expect(saveIndicatorView(state({ status: 'saved', savedAt: AT, savedReason: 'draft' }))).toEqual({ kind: 'none' });
  });

  it('ошибка фонового сохранения — тихая иконка с тултипом и временем отказа', () => {
    const view = saveIndicatorView(state({ status: 'error', failedAt: AT, dirty: true }));

    expect(view).toEqual({
      kind: 'error',
      label: 'Не удалось сохранить на сервер',
      tooltip: 'Не удалось сохранить на сервер, 14:32',
    });
  });

  it('офлайн — постоянный статус без времени', () => {
    expect(saveIndicatorView(state({ status: 'offline', failedAt: AT, dirty: true }))).toEqual({
      kind: 'offline',
      label: 'Нет сети, изменения не сохранены',
    });
  });

  it('время берётся из состояния: другой снимок — другая строка', () => {
    const first = saveIndicatorView(state({ status: 'saved', savedAt: AT, savedReason: 'manual' }));
    const second = saveIndicatorView(state({ status: 'saved', savedAt: EARLIER, savedReason: 'manual' }));

    expect(first).not.toEqual(second);
  });
});

describe('saveAlertView', () => {
  it('модалки нет, пока `persistence` её не поднял', () => {
    expect(saveAlertView(null)).toBeNull();
  });

  it('офлайн — «Нет сети» и обещание, что сохранение продолжится само', () => {
    expect(saveAlertView(alert({ kind: 'offline' }))).toEqual({
      kind: 'offline',
      title: 'Нет сети',
      text: 'Изменения не сохранены. Не закрывайте вкладку: сохранение продолжится само, когда сеть вернётся.',
    });
  });

  it('404 — частный случай «Проект удалён»', () => {
    expect(saveAlertView(alert({ kind: 'not-found' }))).toEqual({
      kind: 'not-found',
      title: 'Проект удалён',
      text: 'Проект удалили — возможно, в другой вкладке. Сохранить в него уже нельзя.',
    });
  });

  it('прочий отказ без текста сервера — формулировку подбирает шапка', () => {
    expect(saveAlertView(alert({ kind: 'unknown' }))).toEqual({
      kind: 'unknown',
      title: 'Не удалось сохранить',
      text: 'Сервер не ответил. Проверьте соединение и попробуйте ещё раз — нарисованное осталось на месте.',
    });
  });

  it('текст сервера показывается как есть — своего движок не сочиняет', () => {
    expect(saveAlertView(alert({ kind: 'unknown', detail: 'Проект слишком большой' }))?.text).toBe(
      'Проект слишком большой',
    );
  });

  it('офлайн текст сервера не подменяет: ответа не было вовсе', () => {
    const view = saveAlertView(alert({ kind: 'offline', detail: 'Request failed' }));

    expect(view?.title).toBe('Нет сети');
    expect(view?.text).not.toBe('Request failed');
  });
});

describe('обещания «изменения сохранены локально» нет ни в одном тексте', () => {
  it('ни в статусе, ни в тултипе, ни в модалке (ADR 0021, спека 10)', () => {
    const views = [
      saveIndicatorView(state({ status: 'saved', savedAt: AT, savedReason: 'manual' })),
      saveIndicatorView(state({ status: 'saved', savedAt: AT, savedReason: 'autosave' })),
      saveIndicatorView(state({ status: 'error', failedAt: AT })),
      saveIndicatorView(state({ status: 'offline', failedAt: AT })),
    ];
    const alerts = (['offline', 'not-found', 'unknown'] as const).map(kind => saveAlertView(alert({ kind })));

    const texts = [...views, ...alerts].flatMap(view => (view === null ? [] : Object.values(view)));
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).not.toMatch(/локальн/i);
  });
});
