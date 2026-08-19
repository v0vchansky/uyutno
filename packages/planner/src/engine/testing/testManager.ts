import type { PlannerDocument } from '../../document/PlannerDocument';
import { createPlanBuilder } from '../../document/testing/planBuilder';
import type { PlannerEventType } from '../PlannerBus';
import { PlannerManager, type PlannerLogger } from '../PlannerManager';

export const silentLogger: PlannerLogger = { debug() {}, info() {}, warn() {}, error() {} };

export interface TestManager {
  manager: PlannerManager;
  /** Журнал событий шины в порядке эмита; `events.length = 0` — очистить перед проверяемым шагом. */
  events: PlannerEventType[];
  /** Id единственного этажа документа. */
  floorId: string;
}

/** Фасад над документом (по умолчанию — пустой этаж `f1` билдера) с журналом всех событий шины; `logger` — для шпионов. */
export const createTestManager = (
  document: PlannerDocument = createPlanBuilder().document(),
  logger: PlannerLogger = silentLogger,
): TestManager => {
  const manager = new PlannerManager({ projectId: 'p-test', logger, document });
  const events: PlannerEventType[] = [];
  for (const type of [
    'document:changed',
    'document:dirty-changed',
    'view:changed',
    'history:changed',
    'tools:changed',
  ] as const) {
    manager.on(type, () => events.push(type));
  }
  return { manager, events, floorId: manager.document.get().floors[0]!.id };
};

/** Документ билдера с замкнутым кольцом стен 400×300, толщина 10: после normalize — `outer` + `inner`, одна комната. */
export const ringDocument = (): PlannerDocument => {
  const b = createPlanBuilder();
  b.ring(0, 0, 400, 300, 10);
  return b.document();
};

/** Прямоугольный квад ленты стены как «сырой» контур инструмента (`outer`), углы `(x0,y0)–(x1,y1)`. */
export const rectContour = (x0: number, y0: number, x1: number, y1: number, kind: 'outer' | 'inner' = 'outer') => ({
  kind,
  points: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
});

/** Четыре квада кольца стен вокруг прямоугольника — «сырой» коммит инструмента «Стены» (после normalize — комната). */
export const ringContours = (x0: number, y0: number, x1: number, y1: number, width: number) => {
  const outer = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const inner = [
    { x: x0 + width, y: y0 + width },
    { x: x1 - width, y: y0 + width },
    { x: x1 - width, y: y1 - width },
    { x: x0 + width, y: y1 - width },
  ];
  return [0, 1, 2, 3].map(i => {
    const j = (i + 1) % 4;
    return { kind: 'outer' as const, points: [outer[i]!, outer[j]!, inner[j]!, inner[i]!] };
  });
};
