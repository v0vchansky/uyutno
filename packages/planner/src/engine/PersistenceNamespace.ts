import { freeze } from 'immer';

import type { PlannerDocument } from '../document/PlannerDocument';
import { err, ok, type Result } from '../document/Result';
import type { PlannerBus } from './PlannerBus';
import type { PlannerStore } from './PlannerStore';
import type { ToolState } from './tools/ToolState';

/**
 * DI-контракт транспорта (ADR 0015 A8, ADR 0021 «Сохранение и конфликты»): **политика — в планере, транспорт и
 * `localStorage` — в платформе**. Планер знает, _когда_ сохранять (dirty, drag, очередь); _куда_ и _чем_ — знает
 * платформа (HTTP-клиент, `localStorage`, авторизация). Форма — дословно из ADR 0021.
 *
 * Проп **необязателен**: без него `persistence` таймеров не заводит, а сохранение отвечает `no-storage`. Так
 * `/project/:id` живёт как сейчас, пока `0085` не подключит загрузку, а headless-тесты движка обходятся без
 * фейкового транспорта.
 *
 * Draft-методы задействует **только демо-роут** (`0083`): у обычного проекта локальной копии нет вовсе, поэтому
 * они опциональны, и `persistence` зовёт их лишь по причине `'draft'`.
 */
export interface PlannerStorage {
  /** Документ проекта с сервера; `null` — проект создан, но ни разу не сохранён (путь открытия — `0085`). */
  load(projectId: string): Promise<PlannerDocument | null>;
  /** Запись документа целиком; `autosave` сервер в v0 только логирует (ADR 0021), но не теряет. */
  save(projectId: string, document: PlannerDocument, options: { autosave: boolean }): Promise<SaveAck>;
  /** Черновик гостевой сессии из `localStorage` — только демо-роут (`0083`). */
  loadDraft?(): Promise<PlannerDocument | null>;
  saveDraft?(document: PlannerDocument): Promise<void>;
  clearDraft?(): Promise<void>;
}

/** Ответ сервера на запись: метка серверного снимка, на ней стоит будущее предупреждение о конкурентной записи. */
export interface SaveAck {
  updatedAt: string;
}

/**
 * Причина сохранения — единственный разветвитель точки входа, чтобы ветки не расползлись по вызывающим:
 * `manual` — кнопка/Ctrl+S, `autosave` — серверный тик (`0082`), `draft` — локальный черновик демо (`0083`).
 */
export type SaveReason = 'manual' | 'autosave' | 'draft';

/** Статус для шапки (`0084`); `offline` держится, пока сети нет, и снимается первым успешным сохранением. */
export type PersistenceStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

/**
 * Чем именно отказал транспорт. Различить «нет сети» и «проект удалён» может только реализация `storage`:
 * планер про HTTP и axios не знает (ADR 0015 A8), поэтому причину она **объявляет** — бросает ошибку формы
 * `StorageSaveFailure`. Всё остальное, что прилетело из `storage`, — `unknown`: выдавать чужое исключение за
 * офлайн нельзя, иначе шапка обещает «сеть вернётся» там, где сеть ни при чём.
 */
export type SaveFailureKind =
  /** Запроса не случилось: сети нет (спека 10, «Оффлайн»). */
  | 'offline'
  /** Сервер ответил «нет такого проекта» — его удалили во второй вкладке (спека 10, «Крайние случаи»). */
  | 'not-found'
  /** Прочий отказ: статус ответа, откат версии (`0080`), исключение реализации. */
  | 'unknown';

/**
 * Форма отказа с объявленной причиной — то, чем реализация `storage` отвечает планеру вместо голого `Error`.
 * `detail` — **текст сервера** для модалки ручного Save (`0084`); своих формулировок движок не сочиняет, а
 * пустое значение означает «сервер ничего внятного не сказал», и текст подбирает шапка.
 *
 * Это **интерфейс, а не класс**, и читается он структурно: реализация транспорта просто дописывает два поля
 * своему классу ошибки (`class ProjectSaveError extends Error implements StorageSaveFailure`). Так связь
 * остаётся проверяемой компилятором, а value-импорт из пакета транспорту не нужен — иначе адаптер на
 * полтора десятка строк тянул бы за собой весь движок вместе с Three.
 */
export interface StorageSaveFailure {
  readonly failure: SaveFailureKind;
  readonly detail?: string | null;
}

export type SaveError =
  /** Пропа `storage` нет — сохранять некуда. */
  | { kind: 'no-storage' }
  /** Причина `'draft'`, но `storage` не дал draft-методов: черновик существует только на демо-роуте. */
  | { kind: 'no-draft-storage' }
  /** Транспорт отказал: сеть, статус ответа, исключение реализации. */
  | { kind: 'save-failed'; reason: SaveReason; failure: SaveFailureKind; detail: string | null; cause: unknown };

/**
 * Отказ, который обязан увидеть человек: модалку поднимает **только ручной Save** (спека 10), у автосейва
 * ошибка тихая. Снимается явным `dismissAlert()` — фоновый успех модалку из-под пальца не убирает.
 */
export interface SaveAlert {
  kind: SaveFailureKind;
  /** Текст сервера, если он был; `null` — формулировку подбирает шапка (`0084`). */
  detail: string | null;
  /** Часы клиента на момент отказа, мс epoch. */
  at: number;
}

export type SaveOutcome =
  /** Запрос ушёл и вернулся успешно; `updatedAt` — метка сервера (`null` для черновика: сервера там нет). */
  | { kind: 'saved'; updatedAt: string | null }
  /** Гейт не пустил: сохранять нечего либо идёт жест — в обоих случаях молча (спека 10). */
  | { kind: 'skipped'; gate: 'not-dirty' | 'gesture' }
  /** Ручной Save пришёлся на жест: уйдёт на ближайшем тике после отпускания, а не сразу (спека 10). */
  | { kind: 'deferred' };

/** Снимок состояния сохранения — payload события и источник для `usePlannerSelector`; заморожен и стабилен. */
export interface PersistenceState {
  status: PersistenceStatus;
  /** Часы клиента на момент последнего успешного сохранения, мс epoch — из них шапка делает «Сохранено, HH:MM». */
  savedAt: number | null;
  /** Чем был вызван последний успех: «Сохранено, HH:MM» и «Автосохранено, HH:MM» — разные строки (спека 10). */
  savedReason: SaveReason | null;
  /** `updatedAt` последнего успешного серверного сохранения (ADR 0021); черновик его не приносит. */
  updatedAt: string | null;
  lastError: SaveError | null;
  /** Часы клиента на момент последнего отказа — из них тултип «Не удалось сохранить на сервер, HH:MM». */
  failedAt: number | null;
  /** Ждущая модалка ручного Save; у автосейва всегда `null` — его ошибка тихая (спека 10). */
  alert: SaveAlert | null;
  /** Есть несохранённые изменения — зеркало `document.isDirty()` (ADR 0018 D7), чтобы UI читал одно место. */
  dirty: boolean;
}

/** Куда уходит запись: сервер или локальный черновик демо. Схлопывать между собой их нельзя — это разные хранилища. */
export type SaveTarget = 'server' | 'draft';

/**
 * Задержка перед стартом таймеров автосохранения (спека 10: «чтобы не молотить сохранения сразу на
 * инициализации»). Отсчитывается от подъёма планера — он и есть «старт редактора».
 */
export const AUTOSAVE_START_DELAY_MS = 5_000;

/** Период серверного автосейва (спека 10). Первый запрос уходит через `DELAY + INTERVAL` после старта. */
export const AUTOSAVE_INTERVAL_MS = 60_000;

/**
 * Период записи локального черновика на демо-роуте (спека 10, `0083`). Чаще серверного, потому что цена
 * записи другая: `localStorage` синхронный и локальный, сети и очереди на той стороне нет.
 */
export const DRAFT_INTERVAL_MS = 30_000;

/** Слот очереди: одна ожидающая запись на хранилище и все, кто ждёт её результата. */
interface PendingSlot {
  reason: SaveReason;
  waiters: ((result: Result<SaveOutcome, SaveError>) => void)[];
}

const INITIAL_STATE: PersistenceState = freeze(
  {
    status: 'idle',
    savedAt: null,
    savedReason: null,
    updatedAt: null,
    lastError: null,
    failedAt: null,
    alert: null,
    dirty: false,
  },
  true,
);

const targetOf = (reason: SaveReason): SaveTarget => (reason === 'draft' ? 'draft' : 'server');

const STATE_KEYS = [
  'status',
  'savedAt',
  'savedReason',
  'updatedAt',
  'lastError',
  'failedAt',
  'alert',
  'dirty',
] as const;

const FAILURE_KINDS: readonly SaveFailureKind[] = ['offline', 'not-found', 'unknown'];

/**
 * Причина отказа — только та, что транспорт объявил сам (`StorageSaveFailure`). Проверка структурная, а не
 * `instanceof`: реализация `storage` живёт в платформе, и связывать ветку офлайна с идентичностью класса
 * через границу бандла незачем — достаточно, что причина названа одним из известных литералов.
 */
const failureOf = (cause: unknown): { failure: SaveFailureKind; detail: string | null } => {
  if (typeof cause === 'object' && cause !== null) {
    const { failure, detail } = cause as { failure?: unknown; detail?: unknown };
    if (FAILURE_KINDS.includes(failure as SaveFailureKind)) {
      return {
        failure: failure as SaveFailureKind,
        detail: typeof detail === 'string' && detail !== '' ? detail : null,
      };
    }
  }
  // Голое исключение реализации: текст у него технический (`Request failed with status code 500`) — в модалку
  // такое не выносят, поэтому `detail` остаётся пустым и формулировку подбирает шапка.
  return { failure: 'unknown', detail: null };
};

/**
 * Идёт ли жест, во время которого сохранение откладывается (спека 10 «Крайние случаи (продолжение)»: drag и
 * трансформация). Источник факта — автомат инструментов, своего флага неймспейс не заводит. Проверка «не `editing`»,
 * а не перечисление `dragging-*`: рисование спека гасит наравне с драгом, а новые жесты (линейки, грипы мебели)
 * попадут под правило сами, вместо того чтобы тихо разъехаться с ним при следующем состоянии автомата.
 */
const isGestureActive = (state: ToolState): boolean => state.kind !== 'editing';

/**
 * Неймспейс `persistence` фасада (ADR 0015 A2, ADR 0021): **вся политика сохранения** — состояние и его
 * событие, одна точка входа с явной причиной, dirty-гейт, очередь запросов, откладывание на drag (`0081`),
 * таймер серверного автосейва, гейты, ветки отказа и офлайна (`0082`), таймер локального черновика демо
 * (`0083`). Шапка — `0084`.
 *
 * **Серверный автосейв** (спека 10, ADR 0021): раз в 60 с, таймер стартует через 5 с после подъёма планера.
 * Гейтов ровно два — есть `projectId` и поднят dirty («текущий пользователь — владелец» спека выносит как
 * защитный инвариант на будущее, а не как третье условие). Гасителей тика тоже два — режим черновика
 * (демо-роут, `saveTarget: 'draft'`) и активный жест. Ретрая после ошибки нет: следующий тик через 60 с
 * попробует сам, и только если изменения ещё есть. Подписки на `online` и `beforeunload` нет намеренно —
 * «синхронизация возобновляется автоматически» это и есть ближайший тик (решение ADR 0021).
 *
 * **Черновик демо** (спека 10, ADR 0021): в режиме `saveTarget: 'draft'` тот же таймер тикает раз в 30 с и
 * зовёт `save('draft')` — то есть проходит те же dirty-гейт, очередь и гаситель на жесте. Отличий ровно два:
 * период и отсутствие гейта `projectId` (на демо проекта на сервере нет вовсе). Diff-guard живёт **не здесь**:
 * «строка та же, что в прошлый раз» — факт `localStorage`, и знает его реализация `saveDraft` в платформе.
 *
 * Что здесь **не** живёт: знание об эндпоинтах, `localStorage`, сессии и `window` — всё это приходит пропом
 * `storage` (ADR 0015 A8). Исключений наружу нет: `save` возвращает `Result` даже на упавшей реализации транспорта.
 */
export class PersistenceNamespace {
  private state: PersistenceState = INITIAL_STATE;
  /** Последний разосланный снимок — событие идёт ровно на изменение состояния, а не на каждый патч. */
  private emitted: PersistenceState = INITIAL_STATE;
  /** Патчи внутри батча копятся в `state`, а событие уходит одно: завершение сохранения меняет сразу четыре поля. */
  private batching = false;

  /** Ожидающие записи по хранилищу: больше одной на хранилище не бывает — второе сохранение схлопывается в неё. */
  private readonly pending = new Map<SaveTarget, PendingSlot>();
  /** Идёт дренаж очереди — гарантия «один запрос в полёте» (спека 10 «Крайние случаи»). */
  private draining = false;
  /**
   * Ручной Save, пришедшийся на жест: уходит на ближайшем сохранении после отпускания, а не в момент отпускания
   * (спека 10). Флаг, а не очередь: сколько бы раз ни жали Ctrl+S в драге, отложенный Save остаётся один.
   */
  private deferredManual = false;

  private readonly unsubscribe: () => void;

  /** Таймеры автосейва: задержка старта и сам период. `null` — в этом режиме автосейва нет вовсе. */
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: PlannerStore,
    private readonly bus: PlannerBus,
    private readonly options: {
      projectId: string;
      /**
       * Реализация транспорта. Ссылка стабильна на всю жизнь планера: `<Planner />` отдаёт делегат, читающий
       * актуальный проп, поэтому смена `storage` планер не пересоздаёт (то же правило, что у `logger`).
       */
      storage?: PlannerStorage;
      /**
       * Куда сохраняет по таймеру **этот** планер: обычный проект — на сервер (60 с, `0082`), демо-роут —
       * только в локальный черновик (30 с, `0083`). Серверного автосейва в режиме `'draft'` нет вовсе —
       * это гаситель спеки 10, а не «гейт, который всегда не проходит»: таймер там не заводится.
       */
      saveTarget?: SaveTarget;
      /** Состояние автомата инструментов — источник факта «идёт жест»; читается на каждый запрос, не кешируется. */
      getToolState: () => ToolState;
    },
  ) {
    // Dirty живёт в сторе (ADR 0018 D7), здесь — только зеркало: UI читает одно место, а не два.
    const onDirty = ({ dirty }: { dirty: boolean }): void => this.patch({ dirty });
    bus.on('document:dirty-changed', onDirty);
    this.unsubscribe = () => bus.off('document:dirty-changed', onDirty);

    /**
     * Таймер ровно один, и режим выбирает его период: обычный проект пишет на сервер раз в 60 с (`0082`),
     * демо-роут — в локальный черновик раз в 30 с (`0083`). Задержка старта общая — 5 с после подъёма
     * планера (спека 10).
     *
     * Без транспорта таймера нет вовсе: сохранять некуда, а headless-тесты движка не должны ловить чужие
     * тики. Режим черновика проверяет именно `saveDraft`, а не сам проп: `no-draft-storage` — это ответ на
     * явный запрос «сохрани черновик», а не повод будить редактор раз в 30 с ради заведомо той же ошибки.
     */
    const target = options.saveTarget ?? 'server';
    const interval = target === 'draft' ? DRAFT_INTERVAL_MS : AUTOSAVE_INTERVAL_MS;
    if (target === 'draft' ? options.storage?.saveDraft !== undefined : options.storage !== undefined) {
      this.startTimer = setTimeout(() => {
        this.tickTimer = setInterval(() => this.tick(target), interval);
      }, AUTOSAVE_START_DELAY_MS);
    }
  }

  /** Замороженный снимок состояния сохранения; ссылка стабильна, пока состояние не изменилось. */
  getState(): PersistenceState {
    return this.state;
  }

  /**
   * Единственная точка входа сохранения. Порядок гейтов: транспорт → dirty → жест → очередь.
   *
   * - `no-storage` / `no-draft-storage` — сохранять некуда, это типизированная ошибка, а не молчание.
   * - dirty снят — `skipped: 'not-dirty'`. Условие «текущий пользователь — владелец» спека 10 выносит как
   *   защитный инвариант на будущее, а не как третье условие гейта: чужой проект открыть нельзя (`0063`).
   * - идёт жест — ручной Save откладывается (`deferred`), тик таймера пропускается тихо (`skipped: 'gesture'`)
   *   и в очередь **не копится**: следующий тик после отпускания заберёт актуальное состояние сам.
   * - гейты проверяются **на входе**, а не в момент отправки: запрос, уже вставший в очередь, уходит с актуальным
   *   документом, даже если предыдущий ответ успел снять dirty (спека 10 «второй ждёт»).
   */
  save(reason: SaveReason): Promise<Result<SaveOutcome, SaveError>> {
    const storage = this.options.storage;
    if (!storage) return Promise.resolve(err({ kind: 'no-storage' }));
    if (reason === 'draft' && !storage.saveDraft) return Promise.resolve(err({ kind: 'no-draft-storage' }));
    if (!this.store.isDirty()) return Promise.resolve(ok({ kind: 'skipped', gate: 'not-dirty' }));

    if (isGestureActive(this.options.getToolState())) {
      if (reason !== 'manual') return Promise.resolve(ok({ kind: 'skipped', gate: 'gesture' }));
      this.deferredManual = true;
      return Promise.resolve(ok({ kind: 'deferred' }));
    }

    return this.enqueue(this.absorbDeferred(reason));
  }

  /**
   * Снимает модалку отказа ручного Save — единственный способ её закрыть (`0084`). Успешное соседнее
   * сохранение статус ошибки снимает, а модалку оставляет: диалог, исчезающий сам, пользователь не прочтёт.
   */
  dismissAlert(): void {
    this.patch({ alert: null });
  }

  /** Снимает подписку на dirty и таймер автосейва; команды после `dispose()` состояния уже не меняют. */
  dispose(): void {
    this.unsubscribe();
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.startTimer = null;
    this.tickTimer = null;
  }

  /**
   * Тик таймера. Гейт `projectId` — здесь, гейт dirty и гаситель «идёт жест» — в `save`, общие с ручным
   * сохранением и с черновиком. Результат сознательно не читается: ошибка уже легла в состояние, а
   * повторять попытку вне таймера спека запрещает — следующий тик сделает это сам.
   *
   * У черновика гейта `projectId` нет и быть не может: демо-роут — это как раз работа без проекта на
   * сервере, и его собственный ключ идентификатора не несёт (ADR 0021).
   */
  private tick(target: SaveTarget): void {
    if (target === 'draft') {
      void this.save('draft');
      return;
    }
    // «Проект уже сохранён на сервере хотя бы раз» (спека 10) — до первого сохранения id нет.
    if (this.options.projectId === '') return;
    void this.save('autosave');
  }

  /**
   * Отложенный ручной Save забирает ближайшее серверное сохранение: спека 10 требует, чтобы после отпускания
   * мыши save ушёл «на ближайшем тике, не сразу», а ручной Save отличается от автосейва флагом `autosave: false`.
   * Черновик демо его не забирает — это другое хранилище.
   */
  private absorbDeferred(reason: SaveReason): SaveReason {
    if (!this.deferredManual || targetOf(reason) !== 'server') return reason;
    this.deferredManual = false;
    return 'manual';
  }

  /**
   * Очередь: пока запрос в полёте, следующий ждёт в слоте своего хранилища; третий не появляется — он
   * схлопывается в тот же слот и получит результат одного запроса с актуальным состоянием. Явный ручной Save
   * побеждает автосейв в схлопнутом слоте: пользователь просил сохранить, а не подождать тика.
   */
  private enqueue(reason: SaveReason): Promise<Result<SaveOutcome, SaveError>> {
    const target = targetOf(reason);
    const slot = this.pending.get(target) ?? { reason, waiters: [] };
    if (this.pending.has(target)) {
      if (reason === 'manual') slot.reason = 'manual';
    } else {
      this.pending.set(target, slot);
    }
    const result = new Promise<Result<SaveOutcome, SaveError>>(resolve => slot.waiters.push(resolve));
    void this.drain();
    return result;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const next = this.pending.entries().next();
        if (next.done === true) return;
        const [target, slot] = next.value;
        this.pending.delete(target);
        const result = await this.run(slot.reason);
        for (const resolve of slot.waiters) resolve(result);
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * Один запрос: `saving` → транспорт → `markSaved` **только по успеху**. При отказе dirty остаётся поднятым —
   * следующий тик попробует снова (`0082`), а несохранённое не выдаётся за сохранённое. Порядок на успехе —
   * патч состояния до `markSaved`: тот эмитит `document:dirty-changed`, и без батча завершение сохранения давало
   * бы два `persistence:changed` вместо одного.
   */
  private async run(reason: SaveReason): Promise<Result<SaveOutcome, SaveError>> {
    const storage = this.options.storage;
    if (!storage) return err({ kind: 'no-storage' });
    this.patch({ status: 'saving' });

    const document = this.store.getDocument();
    try {
      let updatedAt: string | null = null;
      if (reason === 'draft') {
        await storage.saveDraft?.(document);
      } else {
        const ack = await storage.save(this.options.projectId, document, { autosave: reason === 'autosave' });
        updatedAt = ack.updatedAt;
      }

      this.batch(() => {
        this.patch({
          status: 'saved',
          savedAt: Date.now(),
          savedReason: reason,
          // Черновик серверной метки не приносит — прежняя остаётся как есть, а не затирается в `null`.
          updatedAt: updatedAt ?? this.state.updatedAt,
          // Первый успех снимает и ошибку, и её метку: тихая иконка гаснет (спека 10).
          lastError: null,
          failedAt: null,
          dirty: false,
        });
        this.store.markSaved();
      });
      return ok({ kind: 'saved', updatedAt });
    } catch (cause) {
      const { failure, detail } = failureOf(cause);
      const error: SaveError = { kind: 'save-failed', reason, failure, detail, cause };
      const at = Date.now();
      this.patch({
        // Офлайн — не «ошибка сохранения», а постоянный статус «нет сети»: он держится до первого успеха.
        status: failure === 'offline' ? 'offline' : 'error',
        lastError: error,
        failedAt: at,
        // Модалка — только у ручного Save; у автосейва прежняя не затирается и новая не заводится (спека 10).
        alert: reason === 'manual' ? { kind: failure, detail, at } : this.state.alert,
      });
      return err(error);
    }
  }

  private batch(run: () => void): void {
    this.batching = true;
    try {
      run();
    } finally {
      this.batching = false;
    }
    this.flush();
  }

  private patch(patch: Partial<PersistenceState>): void {
    const next = { ...this.state, ...patch };
    if (STATE_KEYS.every(key => next[key] === this.state[key])) return;
    this.state = freeze(next, true);
    if (!this.batching) this.flush();
  }

  /** Одно событие на изменение состояния (ADR 0015 A5: свершившийся факт, payload — plain-снимок). */
  private flush(): void {
    if (this.state === this.emitted) return;
    this.emitted = this.state;
    this.bus.emit('persistence:changed', { state: this.state });
  }
}
