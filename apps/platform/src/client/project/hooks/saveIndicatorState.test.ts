import type { PersistenceState, SaveAlert } from '@uyutno/planner';

import { saveAlertView, saveButtonView, saveIndicatorView } from './saveIndicatorState';

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

describe('saveIndicatorView — кнопка перехватывает подтверждение (задача 0090)', () => {
  const saved = state({ status: 'saved', savedAt: AT, savedReason: 'manual' });

  it('пока галочка на кнопке, слот молчит — двух подтверждений рядом не бывает', () => {
    expect(saveIndicatorView(saved, { buttonCarriesSaved: true })).toEqual({ kind: 'none' });
  });

  it('галочка ушла — «Сохранено, ЧЧ:ММ» возвращается в слот и держится дальше', () => {
    expect(saveIndicatorView(saved, { buttonCarriesSaved: false })).toEqual({
      kind: 'saved',
      reason: 'manual',
      label: 'Сохранено, 14:32',
    });
  });

  it('«Автосохранено» кнопка не несёт — его слот показывает всегда', () => {
    const autosaved = state({ status: 'saved', savedAt: EARLIER, savedReason: 'autosave' });

    expect(saveIndicatorView(autosaved, { buttonCarriesSaved: true })).toEqual({
      kind: 'saved',
      reason: 'autosave',
      label: 'Автосохранено, 09:05',
    });
  });

  it('тихую иконку отказа и офлайн кнопка не перехватывает', () => {
    expect(saveIndicatorView(state({ status: 'error', failedAt: AT }), { buttonCarriesSaved: true }).kind).toBe(
      'error',
    );
    expect(saveIndicatorView(state({ status: 'offline', failedAt: AT }), { buttonCarriesSaved: true }).kind).toBe(
      'offline',
    );
  });
});

describe('saveButtonView — вид кнопки «Сохранить» (задача 0090)', () => {
  it('покой с изменениями — обычный вид, кнопка нажимается', () => {
    expect(saveButtonView('idle', { canSave: true, hasChanges: true })).toEqual({
      label: 'Сохранить',
      icon: 'none',
      disabled: false,
    });
  });

  it('изменений нет — кнопка неактивна: нажатие всё равно отбросил бы dirty-гейт', () => {
    expect(saveButtonView('idle', { canSave: true, hasChanges: false })).toEqual({
      label: 'Сохранить',
      icon: 'none',
      disabled: true,
    });
  });

  it('идёт запись — спиннер с «Сохраняем…», второй запрос из кнопки не запустить', () => {
    expect(saveButtonView('saving', { canSave: true, hasChanges: true })).toEqual({
      label: 'Сохраняем…',
      icon: 'spinner',
      disabled: true,
    });
  });

  it('успех — галочка на погашенной кнопке: сохранять уже нечего, а подтверждение ещё видно', () => {
    expect(saveButtonView('saved', { canSave: true, hasChanges: false })).toEqual({
      label: 'Сохранено',
      icon: 'check',
      disabled: true,
    });
  });

  it('две причины неактивности различимы иконкой, а не только словом', () => {
    const idle = saveButtonView('idle', { canSave: true, hasChanges: false });
    const saving = saveButtonView('saving', { canSave: true, hasChanges: true });

    expect(idle.disabled).toBe(true);
    expect(saving.disabled).toBe(true);
    expect(idle.icon).not.toBe(saving.icon);
  });

  it('обработчика ещё нет (планер не поднят) — кнопка неактивна независимо от изменений', () => {
    expect(saveButtonView('idle', { canSave: false, hasChanges: true }).disabled).toBe(true);
  });

  it('признак изменений не передан — кнопка активна: так живёт демо-роут (спека 10)', () => {
    // На демо нажатие поднимает гейт логина (0065), а не сохраняет: гасить её по dirty там нельзя.
    expect(saveButtonView('idle', { canSave: true }).disabled).toBe(false);
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
