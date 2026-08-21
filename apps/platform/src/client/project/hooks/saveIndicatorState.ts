import type { PersistenceState, SaveAlert, SaveFailureKind } from '@uyutno/planner';

/**
 * Что стоит в слоте статуса шапки (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Индикатор
 * состояния сохранения»). Ровно **один** статус на все запросы: состояние `persistence` одно на планер, и
 * ручной Save с автосейвом в очереди дают общий кадр, а не два индикатора.
 */
export type SaveIndicatorView =
  /** Покой, «идёт запись» и демо — в слоте нет ничего: во время записи статус несёт сама кнопка. */
  | { kind: 'none' }
  | { kind: 'saved'; reason: 'manual' | 'autosave'; label: string }
  /** Тихая иконка фоновой ошибки: `label` — имя для скринридера, `tooltip` — подпись по наведению. */
  | { kind: 'error'; label: string; tooltip: string }
  | { kind: 'offline'; label: string };

/** Модалка отказа **ручного** Save; у автосейва её не бывает — его ошибка тихая (спека 10). */
export interface SaveAlertView {
  kind: SaveFailureKind;
  title: string;
  text: string;
}

/**
 * Часы клиента → `ЧЧ:ММ`. Момент времени берётся из состояния `persistence` (`savedAt` / `failedAt`), а не
 * считается компонентом заново: показанное время обязано совпадать с тем, к которому относится статус.
 */
const CLOCK = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

const clockAt = (at: number): string => CLOCK.format(at);

/**
 * Состояние сохранения → слот шапки (таблица состояний B3).
 *
 * Чего здесь **нет и не появится** — обещания «изменения сохранены локально»: локальной копии у обычного
 * проекта не существует (ADR 0021, спека 10 «Автосохранение»), а на демо-роуте, где черновик есть,
 * индикатора нет вовсе. Обещание давалось бы ровно там, где оно заведомо ложно.
 */
export const saveIndicatorView = (state: PersistenceState | null): SaveIndicatorView => {
  if (state === null) return { kind: 'none' };

  switch (state.status) {
    case 'saved':
      // `draft` — локальный черновик демо: там индикатора нет вовсе (handoff, «Шапка», строка «демо»).
      if (state.savedAt === null || state.savedReason === null || state.savedReason === 'draft') {
        return { kind: 'none' };
      }
      return {
        kind: 'saved',
        reason: state.savedReason,
        label: `${state.savedReason === 'manual' ? 'Сохранено' : 'Автосохранено'}, ${clockAt(state.savedAt)}`,
      };

    case 'error': {
      const label = 'Не удалось сохранить на сервер';
      return {
        kind: 'error',
        label,
        tooltip: state.failedAt === null ? label : `${label}, ${clockAt(state.failedAt)}`,
      };
    }

    case 'offline':
      // Времени в статусе офлайна нет намеренно: он держится всё время отсутствия сети, а не сообщает о моменте.
      return { kind: 'offline', label: 'Нет сети, изменения не сохранены' };

    default:
      // `idle` — покой; `saving` — «идёт запись», и её показывает кнопка, а не слот (handoff, таблица B3).
      return { kind: 'none' };
  }
};

/**
 * Ждущий отказ ручного Save → модалка (handoff, «Индикатор состояния сохранения»; прототип, кадры `s3`).
 *
 * Текст сервера подставляется **только** в общую ветку: у офлайна ответа не было вовсе, а у 404 своя
 * формулировка понятнее серверного «проект не найден» — обе ветки названы спекой 10 поимённо.
 */
export const saveAlertView = (alert: SaveAlert | null): SaveAlertView | null => {
  if (alert === null) return null;

  switch (alert.kind) {
    case 'offline':
      return {
        kind: 'offline',
        title: 'Нет сети',
        text: 'Изменения не сохранены. Не закрывайте вкладку: сохранение продолжится само, когда сеть вернётся.',
      };

    case 'not-found':
      return {
        kind: 'not-found',
        title: 'Проект удалён',
        text: 'Проект удалили — возможно, в другой вкладке. Сохранить в него уже нельзя.',
      };

    default:
      return {
        kind: 'unknown',
        title: 'Не удалось сохранить',
        text:
          alert.detail ??
          'Сервер не ответил. Проверьте соединение и попробуйте ещё раз — нарисованное осталось на месте.',
      };
  }
};
