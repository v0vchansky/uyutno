/**
 * Слой `engine/` — фасад `PlannerManager`, команды-транзакции, шина событий (ADR 0015).
 * Импортирует только `document/` и внешние либы без Three/DOM/React — энфорсится ESLint.
 *
 * Заглушка: фасад, команды, шина `mitt`, `useSyncExternalStore`-мост — следующие задачи шага 1.
 */

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
}

export class PlannerManager {
  readonly projectId: string;
  private readonly logger: PlannerLogger;

  constructor({ projectId, logger }: PlannerManagerParams) {
    this.projectId = projectId;
    this.logger = logger;
    this.logger.debug('@uyutno/planner: PlannerManager created (stub)', { projectId });
  }

  dispose(): void {
    this.logger.debug('@uyutno/planner: PlannerManager disposed (stub)', { projectId: this.projectId });
  }
}
