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

/**
 * Статус для шапки (`0084`). `offline` в этой задаче не выставляется — ветку офлайна заводит `0082`, которая
 * умеет отличить «нет сети» от прочих отказов транспорта; литерал зафиксирован здесь, чтобы UI писался один раз.
 */
export type PersistenceStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

export type SaveError =
  /** Пропа `storage` нет — сохранять некуда. */
  | { kind: 'no-storage' }
  /** Причина `'draft'`, но `storage` не дал draft-методов: черновик существует только на демо-роуте. */
  | { kind: 'no-draft-storage' }
  /** Транспорт отказал: сеть, статус ответа, исключение реализации. Разбор причины — `0082`. */
  | { kind: 'save-failed'; reason: SaveReason; cause: unknown };

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
  /** `updatedAt` последнего успешного серверного сохранения (ADR 0021); черновик его не приносит. */
  updatedAt: string | null;
  lastError: SaveError | null;
  /** Есть несохранённые изменения — зеркало `document.isDirty()` (ADR 0018 D7), чтобы UI читал одно место. */
  dirty: boolean;
}

/** Куда уходит запись: сервер или локальный черновик демо. Схлопывать между собой их нельзя — это разные хранилища. */
type SaveTarget = 'server' | 'draft';

/** Слот очереди: одна ожидающая запись на хранилище и все, кто ждёт её результата. */
interface PendingSlot {
  reason: SaveReason;
  waiters: ((result: Result<SaveOutcome, SaveError>) => void)[];
}

const INITIAL_STATE: PersistenceState = freeze(
  { status: 'idle', savedAt: null, updatedAt: null, lastError: null, dirty: false },
  true,
);

const targetOf = (reason: SaveReason): SaveTarget => (reason === 'draft' ? 'draft' : 'server');

const STATE_KEYS = ['status', 'savedAt', 'updatedAt', 'lastError', 'dirty'] as const;

/**
 * Идёт ли жест, во время которого сохранение откладывается (спека 10 «Крайние случаи (продолжение)»: drag и
 * трансформация). Источник факта — автомат инструментов, своего флага неймспейс не заводит. Проверка «не `editing`»,
 * а не перечисление `dragging-*`: рисование спека гасит наравне с драгом, а новые жесты (линейки, грипы мебели)
 * попадут под правило сами, вместо того чтобы тихо разъехаться с ним при следующем состоянии автомата.
 */
const isGestureActive = (state: ToolState): boolean => state.kind !== 'editing';

/**
 * Неймспейс `persistence` фасада (ADR 0015 A2, ADR 0021): **механика** сохранения — состояние и его событие,
 * одна точка входа с явной причиной, dirty-гейт, очередь запросов и откладывание на drag. Политику поверх неё
 * (таймер 60 с, гейты автосейва, ветки ошибок и офлайна) наливает `0082`, черновик демо — `0083`, шапку — `0084`.
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
      /** Состояние автомата инструментов — источник факта «идёт жест»; читается на каждый запрос, не кешируется. */
      getToolState: () => ToolState;
    },
  ) {
    // Dirty живёт в сторе (ADR 0018 D7), здесь — только зеркало: UI читает одно место, а не два.
    const onDirty = ({ dirty }: { dirty: boolean }): void => this.patch({ dirty });
    bus.on('document:dirty-changed', onDirty);
    this.unsubscribe = () => bus.off('document:dirty-changed', onDirty);
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

  /** Снимает подписку на dirty; команды после `dispose()` состояния уже не меняют. */
  dispose(): void {
    this.unsubscribe();
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
          // Черновик серверной метки не приносит — прежняя остаётся как есть, а не затирается в `null`.
          updatedAt: updatedAt ?? this.state.updatedAt,
          lastError: null,
          dirty: false,
        });
        this.store.markSaved();
      });
      return ok({ kind: 'saved', updatedAt });
    } catch (cause) {
      const error: SaveError = { kind: 'save-failed', reason, cause };
      this.patch({ status: 'error', lastError: error });
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
