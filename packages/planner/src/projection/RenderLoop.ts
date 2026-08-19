/**
 * Бюджет кадров по умолчанию (ADR 0015 A7, аудит keep «RenderUpdater»): один `invalidate()` даёт столько
 * подряд идущих кадров, после чего луп засыпает. Переопределяется `createPlanner({ frameBudget })`.
 */
export const FRAME_BUDGET = 5;

export interface RenderLoopParams {
  /** Отрисовать один кадр. */
  render: () => void;
  /** Целое ≥ 1; дефолт `FRAME_BUDGET`. */
  frameBudget?: number;
  /** Планировщик кадров — `window.requestAnimationFrame` в браузере, фейк в тестах. */
  requestAnimationFrame: (callback: () => void) => number;
  cancelAnimationFrame: (handle: number) => void;
}

/**
 * Render-on-demand (ADR 0015 A7): `invalidate()` выставляет бюджет кадров, луп через `requestAnimationFrame`
 * декрементирует бюджет на каждом кадре и **самозавершается** — в покое ни одного `rAF` не запланировано.
 * Повторный `invalidate()` во время лупа только пополняет бюджет (второго лупа нет). Без `three` и DOM —
 * планировщик приходит параметром, поэтому класс тестируется в Jest с фейковым `rAF`.
 */
export class RenderLoop {
  private readonly render: () => void;
  private readonly frameBudget: number;
  private readonly requestFrame: RenderLoopParams['requestAnimationFrame'];
  private readonly cancelFrame: RenderLoopParams['cancelAnimationFrame'];

  private budget = 0;
  private handle: number | null = null;
  private disposed = false;

  constructor({ render, frameBudget = FRAME_BUDGET, requestAnimationFrame, cancelAnimationFrame }: RenderLoopParams) {
    if (!Number.isInteger(frameBudget) || frameBudget < 1) {
      throw new RangeError(`@uyutno/planner: frameBudget must be an integer >= 1, got ${String(frameBudget)}`);
    }
    this.render = render;
    this.frameBudget = frameBudget;
    this.requestFrame = requestAnimationFrame;
    this.cancelFrame = cancelAnimationFrame;
  }

  /** Есть ли запланированный кадр (луп активен). В покое — `false`. */
  get isRunning(): boolean {
    return this.handle !== null;
  }

  /** Пополняет бюджет до `frameBudget` и запускает луп, если он спит. После `dispose()` — no-op. */
  invalidate(): void {
    if (this.disposed) return;
    this.budget = this.frameBudget;
    if (this.handle === null) this.schedule();
  }

  /** Отменяет запланированный кадр; дальнейшие `invalidate()` игнорируются. Повторный вызов — no-op. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.handle !== null) this.cancelFrame(this.handle);
    this.handle = null;
    this.budget = 0;
  }

  private schedule(): void {
    this.handle = this.requestFrame(this.tick);
  }

  private readonly tick = (): void => {
    this.handle = null;
    if (this.disposed) return;
    this.budget -= 1;
    this.render();
    // `render()` мог сам вызвать `invalidate()` (пополнил бюджет и уже запланировал кадр) — второй не нужен.
    if (this.budget > 0 && this.handle === null) this.schedule();
  };
}
