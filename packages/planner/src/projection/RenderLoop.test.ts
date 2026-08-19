import { FRAME_BUDGET, RenderLoop } from './RenderLoop';

/** Фейковый `requestAnimationFrame`: кадры копятся в очереди и исполняются по одному вызовом `frame()`. */
class FakeFrames {
  private nextHandle = 1;
  private readonly queue = new Map<number, () => void>();
  readonly requestAnimationFrame = jest.fn((callback: () => void): number => {
    const handle = this.nextHandle++;
    this.queue.set(handle, callback);
    return handle;
  });
  readonly cancelAnimationFrame = jest.fn((handle: number): void => {
    this.queue.delete(handle);
  });

  /** Сколько кадров запланировано прямо сейчас (в покое должно быть 0). */
  get pending(): number {
    return this.queue.size;
  }

  /** Исполняет один «тик» — все колбэки, запланированные до его начала (как настоящий rAF). */
  frame(): void {
    const callbacks = [...this.queue.values()];
    this.queue.clear();
    for (const callback of callbacks) callback();
  }

  /** Гоняет тики, пока очередь не опустеет (с предохранителем от бесконечного лупа). */
  drain(limit = 100): number {
    let frames = 0;
    while (this.pending > 0 && frames < limit) {
      this.frame();
      frames += 1;
    }
    return frames;
  }
}

const createLoop = (frameBudget?: number) => {
  const frames = new FakeFrames();
  const render = jest.fn();
  const loop = new RenderLoop({ render, frameBudget, ...frames });
  return { frames, render, loop };
};

describe('RenderLoop — render-on-demand с бюджетом кадров (ADR 0015 A7)', () => {
  it('в покое ничего не планирует и не рендерит', () => {
    const { frames, render, loop } = createLoop();
    expect(loop.isRunning).toBe(false);
    expect(frames.pending).toBe(0);
    expect(render).not.toHaveBeenCalled();
    expect(frames.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('дефолтный бюджет — FRAME_BUDGET = 5: один invalidate() → ровно 5 кадров, затем самозавершение', () => {
    const { frames, render, loop } = createLoop();
    loop.invalidate();
    expect(loop.isRunning).toBe(true);
    const ticks = frames.drain();
    expect(ticks).toBe(FRAME_BUDGET);
    expect(render).toHaveBeenCalledTimes(FRAME_BUDGET);
    expect(loop.isRunning).toBe(false);
    expect(frames.pending).toBe(0);
  });

  it('frameBudget переопределяет бюджет: 1 → ровно один кадр', () => {
    const { frames, render, loop } = createLoop(1);
    loop.invalidate();
    expect(frames.drain()).toBe(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(loop.isRunning).toBe(false);
  });

  it('кадр за кадром: рендер идёт по одному на тик, а не пачкой', () => {
    const { frames, render, loop } = createLoop(3);
    loop.invalidate();
    frames.frame();
    expect(render).toHaveBeenCalledTimes(1);
    expect(loop.isRunning).toBe(true);
    frames.frame();
    expect(render).toHaveBeenCalledTimes(2);
    frames.frame();
    expect(render).toHaveBeenCalledTimes(3);
    expect(loop.isRunning).toBe(false);
    expect(frames.pending).toBe(0);
  });

  it('повторный invalidate() во время лупа только пополняет бюджет, второго лупа нет', () => {
    const { frames, render, loop } = createLoop(3);
    loop.invalidate();
    frames.frame(); // бюджет 3 → 2
    frames.frame(); // 2 → 1
    expect(render).toHaveBeenCalledTimes(2);
    loop.invalidate(); // снова 3, кадр уже запланирован
    expect(frames.pending).toBe(1);
    expect(frames.requestAnimationFrame).toHaveBeenCalledTimes(3);
    expect(frames.drain()).toBe(3);
    expect(render).toHaveBeenCalledTimes(5);
    expect(loop.isRunning).toBe(false);
  });

  it('несколько invalidate() подряд до первого кадра — один луп, бюджет не суммируется', () => {
    const { frames, render, loop } = createLoop(2);
    loop.invalidate();
    loop.invalidate();
    loop.invalidate();
    expect(frames.pending).toBe(1);
    expect(frames.drain()).toBe(2);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('invalidate() из самого render() (реентерабельность) не создаёт второго кадра на тик', () => {
    const frames = new FakeFrames();
    let reentered = false;
    const render = jest.fn(() => {
      if (!reentered) {
        reentered = true;
        loop.invalidate();
      }
    });
    const loop = new RenderLoop({ render, frameBudget: 2, ...frames });
    loop.invalidate();
    frames.frame(); // рендер №1, внутри — invalidate (бюджет снова 2, кадр запланирован в invalidate)
    expect(frames.pending).toBe(1);
    // Дальше обычное затухание: 2 → 1 → 0.
    expect(frames.drain()).toBe(2);
    expect(render).toHaveBeenCalledTimes(3);
    expect(loop.isRunning).toBe(false);
  });

  it('после затухания новый invalidate() запускает луп заново', () => {
    const { frames, render, loop } = createLoop(2);
    loop.invalidate();
    frames.drain();
    expect(render).toHaveBeenCalledTimes(2);
    loop.invalidate();
    expect(loop.isRunning).toBe(true);
    frames.drain();
    expect(render).toHaveBeenCalledTimes(4);
  });

  it('dispose() отменяет запланированный кадр через cancelAnimationFrame и останавливает луп', () => {
    const { frames, render, loop } = createLoop();
    loop.invalidate();
    frames.frame();
    expect(render).toHaveBeenCalledTimes(1);
    loop.dispose();
    expect(frames.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(frames.pending).toBe(0);
    expect(loop.isRunning).toBe(false);
    frames.drain();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('dispose() в покое не зовёт cancelAnimationFrame; повторный dispose() — no-op', () => {
    const { frames, loop } = createLoop();
    loop.dispose();
    loop.dispose();
    expect(frames.cancelAnimationFrame).not.toHaveBeenCalled();
  });

  it('invalidate() после dispose() игнорируется', () => {
    const { frames, render, loop } = createLoop();
    loop.dispose();
    loop.invalidate();
    expect(loop.isRunning).toBe(false);
    expect(frames.pending).toBe(0);
    frames.drain();
    expect(render).not.toHaveBeenCalled();
  });

  it('уже вызванный колбэк кадра после dispose() не рендерит', () => {
    // Колбэк схвачен планировщиком до dispose (cancel не успел) — луп сам проверяет флаг.
    const frames = new FakeFrames();
    const render = jest.fn();
    const loop = new RenderLoop({ render, ...frames });
    loop.invalidate();
    const [callback] = frames.requestAnimationFrame.mock.calls[0]!;
    loop.dispose();
    callback();
    expect(render).not.toHaveBeenCalled();
    expect(loop.isRunning).toBe(false);
  });

  it('исключение из render() останавливает луп до следующего invalidate(), а не крутит его вечно', () => {
    const frames = new FakeFrames();
    const render = jest.fn(() => {
      throw new Error('boom');
    });
    const loop = new RenderLoop({ render, frameBudget: 3, ...frames });
    loop.invalidate();
    expect(() => frames.frame()).toThrow('boom');
    expect(frames.pending).toBe(0);
    expect(loop.isRunning).toBe(false);
    loop.invalidate();
    expect(loop.isRunning).toBe(true);
  });

  it.each([0, -1, 1.5, NaN, Infinity])('невалидный frameBudget (%p) — RangeError при создании', frameBudget => {
    const frames = new FakeFrames();
    expect(() => new RenderLoop({ render: () => {}, frameBudget, ...frames })).toThrow(RangeError);
  });
});
