import { VIEW_KINDS, type ViewKind } from '../document/PlannerDocument';
import { CANVAS2D_VIEWS, ProjectionGate, THREE_VIEWS } from './ProjectionGate';
import type { RenderLoop } from './RenderLoop';

/** Фейковый луп: от `ProjectionGate` нужен только `invalidate()` — планировщик кадров здесь не участвует. */
const createLoop = () => {
  const loop = { invalidate: jest.fn() };
  return { loop, asRenderLoop: loop as unknown as RenderLoop };
};

const createGate = (views: readonly ViewKind[], activeView: ViewKind) => {
  const { loop, asRenderLoop } = createLoop();
  return { loop, gate: new ProjectionGate(views, asRenderLoop, activeView) };
};

describe('ProjectionGate — взаимная приостановка проекций (ADR 0020 P5)', () => {
  describe('наборы видов', () => {
    it('THREE_VIEWS — plan/orbit/walk, CANVAS2D_VIEWS — только constructor', () => {
      expect(THREE_VIEWS).toEqual(['plan', 'orbit', 'walk']);
      expect(CANVAS2D_VIEWS).toEqual(['constructor']);
    });

    it('наборы не пересекаются', () => {
      expect(THREE_VIEWS.filter(view => CANVAS2D_VIEWS.includes(view))).toEqual([]);
    });

    it('вместе покрывают все VIEW_KINDS документа', () => {
      expect([...THREE_VIEWS, ...CANVAS2D_VIEWS].sort()).toEqual([...VIEW_KINDS].sort());
    });
  });

  describe('активность при создании', () => {
    it.each<ViewKind>(['plan', 'orbit', 'walk'])('Three-гейт активен на своём виде (%s)', view => {
      expect(createGate(THREE_VIEWS, view).gate.isActive).toBe(true);
    });

    it('Three-гейт на виде конструктора неактивен', () => {
      expect(createGate(THREE_VIEWS, 'constructor').gate.isActive).toBe(false);
    });

    it('Canvas2D-гейт активен только на constructor', () => {
      expect(createGate(CANVAS2D_VIEWS, 'constructor').gate.isActive).toBe(true);
      expect(createGate(CANVAS2D_VIEWS, 'plan').gate.isActive).toBe(false);
    });

    it('создание кадров не планирует', () => {
      const { loop } = createGate(CANVAS2D_VIEWS, 'constructor');
      expect(loop.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('invalidate()', () => {
    it('на своём виде проходит в луп', () => {
      const { loop, gate } = createGate(CANVAS2D_VIEWS, 'constructor');
      gate.invalidate();
      gate.invalidate();
      expect(loop.invalidate).toHaveBeenCalledTimes(2);
    });

    it('на чужом виде луп не трогает вовсе', () => {
      const { loop, gate } = createGate(CANVAS2D_VIEWS, 'plan');
      gate.invalidate();
      gate.invalidate();
      gate.invalidate();
      expect(loop.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('setActiveView()', () => {
    it('переключение на свой вид после пропущенных изменений — ровно один кадр', () => {
      const { loop, gate } = createGate(CANVAS2D_VIEWS, 'plan');
      for (let i = 0; i < 50; i += 1) gate.invalidate();
      gate.setActiveView('constructor');
      expect(gate.isActive).toBe(true);
      expect(loop.invalidate).toHaveBeenCalledTimes(1);
    });

    it('вход в свой вид без накопленной грязи — тоже один кадр (состояние могло уйти вперёд)', () => {
      const { loop, gate } = createGate(THREE_VIEWS, 'constructor');
      gate.setActiveView('orbit');
      expect(loop.invalidate).toHaveBeenCalledTimes(1);
    });

    it('переключение на тот же вид — no-op', () => {
      const { loop, gate } = createGate(CANVAS2D_VIEWS, 'constructor');
      gate.setActiveView('constructor');
      expect(loop.invalidate).not.toHaveBeenCalled();
      expect(gate.isActive).toBe(true);
    });

    it('смена вида внутри своего набора (plan → orbit) — no-op', () => {
      const { loop, gate } = createGate(THREE_VIEWS, 'plan');
      gate.setActiveView('orbit');
      gate.setActiveView('walk');
      expect(loop.invalidate).not.toHaveBeenCalled();
      expect(gate.isActive).toBe(true);
    });

    it('уход на чужой вид кадров не планирует', () => {
      const { loop, gate } = createGate(CANVAS2D_VIEWS, 'constructor');
      gate.setActiveView('plan');
      expect(gate.isActive).toBe(false);
      expect(loop.invalidate).not.toHaveBeenCalled();
    });

    it('повторный уход на чужой вид — no-op', () => {
      const { loop, gate } = createGate(CANVAS2D_VIEWS, 'constructor');
      gate.setActiveView('plan');
      gate.setActiveView('orbit');
      gate.setActiveView('walk');
      expect(gate.isActive).toBe(false);
      expect(loop.invalidate).not.toHaveBeenCalled();
    });

    it('каждый возврат на свой вид — ровно один кадр, сколько бы грязи ни накопилось', () => {
      const { loop, gate } = createGate(CANVAS2D_VIEWS, 'constructor');
      gate.setActiveView('plan');
      gate.invalidate();
      gate.setActiveView('constructor');
      expect(loop.invalidate).toHaveBeenCalledTimes(1);
      gate.setActiveView('plan');
      gate.setActiveView('constructor');
      expect(loop.invalidate).toHaveBeenCalledTimes(2);
    });

    it('после возврата на свой вид invalidate() снова идёт в луп', () => {
      const { loop, gate } = createGate(CANVAS2D_VIEWS, 'plan');
      gate.invalidate();
      gate.setActiveView('constructor');
      gate.invalidate();
      expect(loop.invalidate).toHaveBeenCalledTimes(2);
    });
  });
});
