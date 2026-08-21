import type { PlannerStorage, SaveFailureKind, StorageSaveFailure } from '@uyutno/planner';
import {
  migrateWith,
  MIGRATIONS,
  parse,
  serialize,
  type JsonObject,
  type Migration,
  type PlannerDocument,
} from '@uyutno/planner/format';

/**
 * Ключ черновика гостевой сессии (ADR 0021, спека 10 «Автосохранение»). **Один на сессию и без
 * идентификатора пользователя**: у обычного проекта локальной копии нет вовсе, поэтому различать
 * владельцев незачем, а «очистка при удалении проекта» сводится к безусловному снятию этого ключа.
 *
 * Имя — решение ADR 0021, опоры в коде у него нет: менять его — значит потерять черновики, уже лежащие
 * в браузерах, поэтому оно живёт константой в одном месте.
 */
export const PLANNER_DEMO_DRAFT_KEY = 'planner_demo_draft';

/**
 * Отказ локального хранилища с **объявленной причиной** (`StorageSaveFailure` из планера): `unknown` —
 * то есть «тихая иконка», а не постоянный статус «нет сети». Сюда попадают и `QuotaExceededError`, и
 * приватный режим с отключённым `localStorage`: для редактора это один и тот же факт — запись не легла,
 * работа не потеряна, dirty остался поднятым, следующий тик попробует снова (ADR 0021).
 *
 * `detail` пуст намеренно: текст сообщения технический (`QuotaExceededError`), а модалки у черновика нет
 * вовсе — её поднимает только ручной Save (спека 10), а он в демо уходит в гейт логина (`0065`).
 */
export class DemoDraftError extends Error implements StorageSaveFailure {
  readonly failure: SaveFailureKind = 'unknown';
  readonly detail = null;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DemoDraftError';
  }
}

/** Draft-половина пропа `storage` (`0081`): демо-роут домешивает её к транспорту сервера (`0064`). */
export type DemoDraftStorage = Required<Pick<PlannerStorage, 'loadDraft' | 'saveDraft' | 'clearDraft'>>;

/**
 * Запись черновика: **документ в формате сейва целиком** плюс метка времени клиента (решение автора
 * 2026-08-20, задача `0064`). Версия формата отдельным полем не дублируется — она уже внутри конверта,
 * и вторая копия неизбежно разъехалась бы с первой.
 */
interface DraftRecord {
  document: JsonObject;
  /** Часы клиента на момент записи, мс epoch. Служебная перезапись после миграции её не двигает. */
  savedAt: number;
}

const readRecord = (raw: string): DraftRecord | null => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const { document, savedAt } = value as { document?: unknown; savedAt?: unknown };
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return null;
  // Метка времени — не несущая часть: её отсутствие делает черновик не «битым», а просто безымянным по времени.
  return { document: document as JsonObject, savedAt: typeof savedAt === 'number' ? savedAt : Date.now() };
};

/**
 * Локальный черновик демо-роута — **единственное место в v0, где документ планера живёт в браузере**
 * (ADR 0021, спека 10). На демо сервера нет вовсе: сохранять некуда, поэтому набросок страхует
 * `localStorage`, и он же переживает уход на вход к OAuth-провайдеру и возврат.
 *
 * Здесь нет ни таймера, ни dirty-гейта, ни очереди — всё это политика `persistence` внутри планера
 * (ADR 0015 A8): движок знает, _когда_ писать (раз в 30 с, не в жесте, только при изменениях), платформа —
 * _куда_ и _чем_. Отсюда наружу едут только результат записи и названная причина отказа.
 *
 * **Diff-guard живёт здесь**, а не в движке: «строка та же, что в прошлый раз» — факт хранилища. Держится
 * на детерминированности `serialize` (`0079`): одинаковый документ даёт байт в байт одинаковую строку,
 * иначе guard не сработал бы никогда. Кеш обновляется **только после успешного** `setItem` — иначе
 * отказавшая запись выдала бы себя за лежащую в ключе, и следующий тик её бы не повторил.
 *
 * **Фабрика, а не модульная константа** (в отличие от `projectStorage`): у реализации есть состояние —
 * кеш diff-guard, — а доступ к хранилищу и цепочка миграций приходят параметрами. Цепочка параметром —
 * тот же приём, что у `migrateWith` в пакете и у `ProjectsManager` на сервере: механику шага можно
 * проверить фиктивной миграцией, не заводя фиктивную версию формата в продакшн-цепочке.
 */
export const createDemoDraftStorage = ({
  getStorage,
  migrations = MIGRATIONS,
}: {
  /**
   * Доступ к хранилищу — функцией и с правом бросить: в приватном режиме и при отключённом хранилище
   * обращение к `localStorage` бросает **синхронно**, и это ровно та ветка, которую ADR 0021 отправляет
   * в тихую иконку. Ленивость нужна ещё и для SSR: демо-страница утянет модуль в серверный бандл, а
   * `localStorage` там не существует — обращение при импорте уронило бы рендер страницы целиком.
   */
  getStorage: () => Storage | null | undefined;
  migrations?: readonly Migration[];
}): DemoDraftStorage => {
  /** Строка документа, которая **лежит в ключе** после нашей последней успешной записи; `null` — не знаем. */
  let written: string | null = null;

  const local = (): Storage | null => {
    try {
      return getStorage() ?? null;
    } catch {
      return null;
    }
  };

  const write = (json: string, savedAt: number): void => {
    const storage = local();
    if (!storage) throw new DemoDraftError('localStorage недоступен');
    try {
      /**
       * Запись собирается конкатенацией, а не `JSON.stringify` над разобранным документом: строка от
       * `serialize` уже канонична, и повторный разбор с обратной сборкой только рисковал бы порядком
       * ключей — тем самым, на котором держится diff-guard.
       */
      storage.setItem(PLANNER_DEMO_DRAFT_KEY, `{"document":${json},"savedAt":${savedAt}}`);
    } catch (cause) {
      throw new DemoDraftError('не удалось записать черновик демо в localStorage', { cause });
    }
    written = json;
  };

  const drop = (): void => {
    written = null;
    const storage = local();
    if (!storage) return;
    try {
      storage.removeItem(PLANNER_DEMO_DRAFT_KEY);
    } catch {
      // Снятие ключа — такая же операция хранилища, как запись, и отказать может по тем же причинам.
    }
  };

  /**
   * Чтение черновика. Порядок — тот же, что у сервера на `GET …/document` (`ProjectsManager.getDocument`):
   * конверт → цепочка миграций → перезапись при `changed` → разбор. Точек вызова у одного и того же кода
   * две, потому что до черновика в браузере сервер не дотягивается (ADR 0021, «Что важно знать»).
   *
   * Ошибок наружу не бросает: всё нечитаемое — это «черновика нет». Модалки «восстановить?» на демо тоже
   * нет — возврат на роут поднимает черновик молча (спека 10, принято по reference).
   */
  const read = (): PlannerDocument | null => {
    const storage = local();
    if (!storage) return null;

    let raw: string | null;
    try {
      raw = storage.getItem(PLANNER_DEMO_DRAFT_KEY);
    } catch {
      return null;
    }
    if (raw === null) return null;

    const record = readRecord(raw);
    // Не JSON, не запись черновика — чинить нечем: ключ снимается, чтобы не остаться вечной ошибкой.
    if (!record) {
      drop();
      return null;
    }

    const migrated = migrateWith(record.document, migrations);
    if (!migrated.ok) {
      /**
       * `corrupt` — тот же «битый черновик», ключ снимается. `unsupported-version` — наоборот: черновик
       * записан **более новым** бандлом, и снимать его нельзя, иначе устаревшая вкладка уничтожила бы
       * работу свежей. Вечной ошибкой он не станет — ближайший тик этой сессии перезапишет ключ своим.
       */
      if (migrated.error.kind === 'corrupt') drop();
      return null;
    }

    if (migrated.value.changed) {
      try {
        // Перезапись служебная: метка времени черновика от неё не двигается — ровно как `updated_at` на сервере.
        write(JSON.stringify(migrated.value.document), record.savedAt);
      } catch {
        // Не легло — черновик всё равно открывается: мигрировать заново придётся при следующем чтении.
      }
    }

    const parsed = parse(migrated.value.document);
    if (!parsed.ok) {
      if (parsed.error.kind === 'corrupt') drop();
      return null;
    }
    return parsed.value;
  };

  return {
    loadDraft: () => Promise.resolve(read()),

    saveDraft: async (document: PlannerDocument): Promise<void> => {
      const json = serialize(document);
      // Diff-guard: при простое реального `setItem` не происходит вовсе (спека 10).
      if (json === written) return;
      write(json, Date.now());
    },

    /**
     * Снятие ключа — обязанность платформы (ADR 0021): зовётся при переносе демо-проекта в аккаунт (`0065`)
     * и при удалении проекта из галереи. Сопоставлять ключ с конкретным проектом нечем — `projectId` в нём
     * нет, — поэтому очистка безусловная. Повтор на пустом ключе безопасен: `removeItem` этого не замечает.
     */
    clearDraft: () => {
      drop();
      return Promise.resolve();
    },
  };
};

/**
 * Черновик демо поверх настоящего `localStorage` — то, что демо-роут отдаст пропом `storage` (`0064`).
 * Глобал читается **лениво**, внутри вызова: в SSR-бандле хранилища нет вовсе, а в приватном режиме
 * обращение к нему бросает синхронно.
 */
export const demoDraftStorage: DemoDraftStorage = createDemoDraftStorage({
  getStorage: () => globalThis.localStorage,
});
