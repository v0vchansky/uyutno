import type { Handler } from 'mitt';

import { createEmptyDocument, type PlannerDocument } from '../document/PlannerDocument';
import { DocumentNamespace } from './DocumentNamespace';
import { HistoryNamespace } from './HistoryNamespace';
import { createPlannerBus, type PlannerBus, type PlannerEvents, type PlannerEventType } from './PlannerBus';
import { PlannerStore } from './PlannerStore';
import { ViewNamespace } from './ViewNamespace';

/** DI-контракт логгера (ADR 0015 A8): реализацию передаёт платформа, пакет знает только форму. */
export interface PlannerLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface PlannerManagerParams {
  projectId: string;
  logger: PlannerLogger;
  /** Начальный документ; по умолчанию — пустой проект. Шаг 3 (ADR F) заменит на `storage.load`. */
  document?: PlannerDocument;
}

/**
 * Фасад движка (ADR 0015 A2): владеет документом, публичный API нарезан неймспейсами по доменам —
 * `document`, `view`, `history` (шаг 1; история реальная — 0055, ADR 0018); `selection`, `tools` добавятся
 * своими шагами. UI и проекции документ
 * не мутируют — только зовут команды; читают через `get()`-снимки и подписываются через `subscribe`/`on`.
 * Шина наружу не отдаётся. Глобалов и синглтонов нет: один экземпляр на `createPlanner`.
 */
export class PlannerManager {
  readonly projectId: string;
  readonly document: DocumentNamespace;
  readonly view: ViewNamespace;
  readonly history: HistoryNamespace;

  private readonly bus: PlannerBus;
  private readonly logger: PlannerLogger;

  constructor({ projectId, logger, document = createEmptyDocument() }: PlannerManagerParams) {
    this.projectId = projectId;
    this.logger = logger;
    this.bus = createPlannerBus();

    const store = new PlannerStore(this.bus, document, {
      warn: message => this.logger.warn(`@uyutno/planner: ${message}`, { projectId }),
      // Хук ADR 0018 D9: перед restore undo/redo и `load`. Сюда встанет `tools.interrupt()` (0057) и позже
      // `selection.clear()` (ADR I); до них — no-op.
      hooks: { beforeReplace: () => {} },
    });
    this.document = new DocumentNamespace(store);
    this.view = new ViewNamespace(store);
    this.history = new HistoryNamespace(store);

    this.logger.debug('@uyutno/planner: PlannerManager created', { projectId });
  }

  /**
   * Подписка на любое событие шины (wildcard `*`, ADR 0015 A4) — контракт `useSyncExternalStore` и
   * `RenderLoop.invalidate()`. Возвращает отписку. Стрелочное поле: ссылка стабильна и не требует `bind`,
   * её можно передавать в `useSyncExternalStore` как есть.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    const handler = (): void => this.guarded(listener);
    this.bus.on('*', handler);
    return () => this.bus.off('*', handler);
  };

  /** Типизированная подписка на одно событие — для проекций. Возвращает отписку. Тоже стрелочное поле. */
  readonly on = <K extends PlannerEventType>(type: K, handler: Handler<PlannerEvents[K]>): (() => void) => {
    const guarded: Handler<PlannerEvents[K]> = event => this.guarded(() => handler(event));
    this.bus.on(type, guarded);
    return () => this.bus.off(type, guarded);
  };

  /**
   * Изоляция подписчиков: `mitt` зовёт хендлеры синхронно и без защиты — упавший подписчик иначе выбросил бы
   * исключение из `Result`-команды (ADR A2 «исключений наружу нет») и оборвал бы доставку остальным.
   * Ошибка уходит в DI-логгер, транзакция и остальные подписчики не страдают.
   */
  private guarded(run: () => void): void {
    try {
      run();
    } catch (error) {
      this.logger.error('@uyutno/planner: subscriber threw', error);
    }
  }

  /** Снимает всех подписчиков; команды после `dispose()` событий не порождают. */
  dispose(): void {
    this.bus.all.clear();
    this.logger.debug('@uyutno/planner: PlannerManager disposed', { projectId: this.projectId });
  }
}
