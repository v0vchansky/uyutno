import { PlannerManager, type PlannerLogger } from './PlannerManager';

// Предупреждения ядра моделируются подменой `rebuild`: настоящий пайплайн на нормализованном документе их не даёт.
jest.mock('./rebuild', () => {
  const actual = jest.requireActual<typeof import('./rebuild')>('./rebuild');
  return {
    ...actual,
    rebuild: (document: Parameters<typeof actual.rebuild>[0], options?: Parameters<typeof actual.rebuild>[1]) => {
      options?.warn?.('rebuild: synthetic warning');
      return actual.rebuild(document, options);
    },
  };
});

describe('PlannerManager — предупреждения ядра', () => {
  it('warn-sink PlannerStore заведён в DI-логгер с префиксом пакета и projectId', () => {
    const warn = jest.fn();
    const logger: PlannerLogger = { debug() {}, info() {}, warn, error() {} };
    new PlannerManager({ projectId: 'p-9', logger });
    expect(warn).toHaveBeenCalledWith('@uyutno/planner: rebuild: synthetic warning', { projectId: 'p-9' });
  });
});
