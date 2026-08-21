import type { Handler } from 'mitt';

import { createEmptyDocument } from '../document/createEmptyDocument';
import { type PlannerDocument } from '../document/PlannerDocument';
import { DocumentNamespace } from './DocumentNamespace';
import { HistoryNamespace } from './HistoryNamespace';
import { PersistenceNamespace, type PlannerStorage, type SaveTarget } from './PersistenceNamespace';
import { createPlannerBus, type PlannerBus, type PlannerEvents, type PlannerEventType } from './PlannerBus';
import { PlannerStore } from './PlannerStore';
import { ToolsNamespace } from './tools/ToolsNamespace';
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
  /** Начальный документ; по умолчанию — пустой проект. Путь открытия проекта через `storage.load` — `0085`. */
  document?: PlannerDocument;
  /**
   * DI-транспорт сохранения (ADR 0015 A8, ADR 0021). Необязателен: без него `persistence` отвечает `no-storage`
   * и таймеров не заводит — планер поднимается и работает как прежде.
   */
  storage?: PlannerStorage;
  /**
   * Куда сохраняет автосейв: `'server'` (по умолчанию) — обычный проект, раз в 60 с; `'draft'` — демо-роут,
   * где сервера нет вовсе и пишется только локальный черновик (`0083`). Читается при подъёме планера: режим
   * редактора по ходу его жизни не меняется.
   */
  saveTarget?: SaveTarget;
}

/**
 * Фасад движка (ADR 0015 A2): владеет документом, публичный API нарезан неймспейсами по доменам —
 * `document`, `view`, `history` (шаг 1; история реальная — 0055, ADR 0018), `tools` (автомат инструментов
 * конструктора — 0057, ADR 0019), `persistence` (механика сохранения — 0081, ADR 0021); `selection` (мебель,
 * ADR I) добавится своим шагом. UI и проекции документ не мутируют — только зовут команды; читают через
 * `get()`-снимки и подписываются через `subscribe`/`on`.
 * Шина наружу не отдаётся. Глобалов и синглтонов нет: один экземпляр на `createPlanner`.
 */
export class PlannerManager {
  readonly projectId: string;
  readonly document: DocumentNamespace;
  readonly view: ViewNamespace;
  readonly history: HistoryNamespace;
  readonly tools: ToolsNamespace;
  readonly persistence: PersistenceNamespace;

  private readonly bus: PlannerBus;
  /**
   * DI-логгер платформы (ADR 0015 A8). Публичный, потому что отказ команды — это `Result`, а не исключение:
   * скину нужно куда-то записать `!result.ok`, иначе нажатая кнопка молча ничего не делает. Инструменты движка
   * пишут отказы тем же способом (`engine/tools/*.ts`, `ctx.logger.debug('… rejected', …)`).
   */
  readonly logger: PlannerLogger;

  constructor({ projectId, logger, document = createEmptyDocument(), storage, saveTarget }: PlannerManagerParams) {
    this.projectId = projectId;
    this.logger = logger;
    this.bus = createPlannerBus();

    const store = new PlannerStore(this.bus, document, {
      warn: message => this.logger.warn(`@uyutno/planner: ${message}`, { projectId }),
      // Хук ADR 0018 D9: перед restore undo/redo и `load` — отмена жеста/рисования и сброс hover/выделения
      // конструктора (`tools.interrupt()`); позже сюда же встанет `selection.clear()` (ADR I). Стрелка — ленивое
      // обращение: `tools` создаётся после `store`.
      hooks: { beforeReplace: () => this.tools.interrupt() },
    });
    this.document = new DocumentNamespace(store);
    this.view = new ViewNamespace(store);
    this.history = new HistoryNamespace(store);
    this.tools = new ToolsNamespace(store, this.bus, this.logger);
    // Последним: читает автомат инструментов (факт «идёт жест») — `tools` к этому моменту уже создан.
    this.persistence = new PersistenceNamespace(store, this.bus, {
      projectId,
      storage,
      saveTarget,
      getToolState: () => this.tools.get(),
    });

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

  /**
   * Снимает всех подписчиков (включая внутренние подписки `tools` и `persistence`); команды после `dispose()`
   * событий не порождают.
   */
  dispose(): void {
    this.persistence.dispose();
    this.tools.dispose();
    this.bus.all.clear();
    this.logger.debug('@uyutno/planner: PlannerManager disposed', { projectId: this.projectId });
  }
}
