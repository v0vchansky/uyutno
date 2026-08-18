import { freeze, Immer, type WritableDraft } from 'immer';

import type { PlannerDocument } from '../document/PlannerDocument';
import type { PlannerBus } from './PlannerBus';
import { normalize, rebuild, type DerivedState } from './rebuild';

/**
 * Свой экземпляр immer, а не глобальный `produce`: auto-freeze включён **всегда, и в проде** (ADR 0015 A6,
 * ADR 0016 B5) и не зависит от чужих `setAutoFreeze` в приложении-хосте.
 */
const immer = new Immer({ autoFreeze: true });

/**
 * Рецепт транзакции: мутирует черновик документа или возвращает новый документ целиком (`load`).
 * Возвращаемое значение отличное от `undefined` — замена документа (семантика `immer.produce`).
 */
export type TransactionRecipe = (draft: WritableDraft<PlannerDocument>) => void | PlannerDocument;

/**
 * Единственная точка мутации документа (ADR 0015 A2): хранит замороженный снимок, прогоняет транзакцию
 * «мутация → sync rebuild → события», владеет производным состоянием. Неймспейсы фасада — тонкие обёртки
 * над `transact`; ручных commit-точек нет.
 */
export class PlannerStore {
  private document: PlannerDocument;
  private derived: DerivedState;

  constructor(
    private readonly bus: PlannerBus,
    initial: PlannerDocument,
  ) {
    const built = runRebuild(freeze(initial, true));
    this.document = built.document;
    this.derived = built.derived;
  }

  /** Замороженный снимок документа; ссылка стабильна между транзакциями. */
  getDocument(): PlannerDocument {
    return this.document;
  }

  /** Замороженный результат последнего rebuild; меняется только вместе с содержимым документа. */
  getDerived(): DerivedState {
    return this.derived;
  }

  /**
   * Транзакция. Порядок: рецепт → (если изменилось содержимое, т.е. что-то кроме `view`) sync rebuild:
   * нормализация хранимого в том же снимке + производное от финализированного снимка → фиксация → события:
   * `document:changed` при изменении содержимого, `view:changed` при изменении `view` — по одному на
   * изменившийся факт, ни одного при no-op. Состояние обновлено **до** эмита, поэтому подписчики читают
   * уже новый снимок. Исключения подписчиков изолирует фасад (`PlannerManager.subscribe/on`).
   */
  transact(recipe: TransactionRecipe): void {
    const prev = this.document;
    const mutated = immer.produce(prev, recipe);
    if (mutated === prev) return;

    const contentChanged = hasContentChanged(prev, mutated);
    const next = contentChanged ? runRebuild(mutated) : { document: mutated, derived: this.derived };

    this.document = next.document;
    this.derived = next.derived;

    if (contentChanged) this.bus.emit('document:changed', { document: next.document });
    if (next.document.view !== prev.view) this.bus.emit('view:changed', next.document.view);
  }
}

/** Изменилось ли что-то кроме `view` — то, что требует rebuild и события `document:changed`. */
const hasContentChanged = (prev: PlannerDocument, next: PlannerDocument): boolean => {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof PlannerDocument>;
  for (const key of keys) {
    if (key !== 'view' && next[key] !== prev[key]) return true;
  }
  return false;
};

/** Две фазы rebuild: нормализация хранимого через черновик, производное — от готового снимка. */
const runRebuild = (base: PlannerDocument): { document: PlannerDocument; derived: DerivedState } => {
  const document = immer.produce(base, normalize);
  return { document, derived: freeze(rebuild(document), true) };
};
