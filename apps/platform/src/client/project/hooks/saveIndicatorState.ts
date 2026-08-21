import type { PersistenceState, SaveAlert, SaveFailureKind } from '@uyutno/planner';

import type { SaveButtonPhase } from './useSaveButtonFeedback';

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
export const saveIndicatorView = (
  state: PersistenceState | null,
  options: {
    /**
     * Подтверждение ручного сохранения сейчас несёт сама кнопка (задача 0090): она держит галочку около
     * полутора секунд. Всё это время слот молчит — двух галочек в двенадцати пикселях друг от друга не
     * бывает ни в одном кадре. Текст не потерян, а **отложен**: «Сохранено, ЧЧ:ММ» встаёт в слот ровно
     * тогда, когда галочка ушла, и дальше держится как прежде — время последнего сохранения кнопка не
     * несёт и нести не может.
     */
    buttonCarriesSaved?: boolean;
  } = {},
): SaveIndicatorView => {
  if (state === null) return { kind: 'none' };

  switch (state.status) {
    case 'saved':
      // `draft` — локальный черновик демо: там индикатора нет вовсе (handoff, «Шапка», строка «демо»).
      if (state.savedAt === null || state.savedReason === null || state.savedReason === 'draft') {
        return { kind: 'none' };
      }
      // Перехватывается только `manual`: «Автосохранено, ЧЧ:ММ» кнопка не показывает вовсе (задача 0090).
      if (options.buttonCarriesSaved === true && state.savedReason === 'manual') return { kind: 'none' };
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

/** Вид кнопки «Сохранить»: подпись, что стоит слева от неё и нажимается ли она вообще (задача 0090). */
export interface SaveButtonView {
  label: string;
  icon: 'none' | 'spinner' | 'check';
  disabled: boolean;
}

/**
 * Кадр кнопки «Сохранить» (задача 0090).
 *
 * **Причин неактивности две, и выглядят они по-разному.** «Идёт запись» — со спиннером и подписью
 * «Сохраняем…»: кнопка занята, второй запрос из неё не запустить (это правило задачи 0084, очередь
 * `persistence` схлопнула бы его всё равно). «Сохранять нечего» — обычный погашенный вид: раньше кнопка в
 * этом состоянии оставалась активной, нажатие молча отбрасывал dirty-гейт внутри `persistence.save()`, и
 * читалось это как сломанная кнопка. После успешного сохранения кнопка гаснет именно по второй причине —
 * `dirty` снят, — а не залипает в «идёт запись».
 *
 * **Отсутствие признака изменений — не «изменений нет».** `hasChanges` необязателен, и без него кнопка
 * активна: так живёт демо-роут, где нажатие не сохраняет, а поднимает гейт логина (спека 10, «Storage
 * backend и авторизация»: «в демо кнопка Save и Ctrl+S активны и кликабельны, не disabled-кнопка, иначе
 * Ctrl+S остаётся без ответа»). Гасить её там по `dirty` нельзя, и правило заложено сразу, до 0064/0065.
 */
export const saveButtonView = (
  phase: SaveButtonPhase,
  options: {
    /** Сохранение вообще доступно: планер поднят и оболочка не гасит шапку экраном открытия. */
    canSave: boolean;
    hasChanges?: boolean;
  },
): SaveButtonView => {
  if (phase === 'saving') return { label: 'Сохраняем…', icon: 'spinner', disabled: true };
  // Галочка доживает своё на погашенной кнопке: `dirty` снят успехом, сохранять к этому моменту уже нечего.
  if (phase === 'saved') return { label: 'Сохранено', icon: 'check', disabled: true };

  return { label: 'Сохранить', icon: 'none', disabled: !options.canSave || options.hasChanges === false };
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
