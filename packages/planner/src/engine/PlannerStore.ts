import { freeze, Immer, type WritableDraft } from 'immer';

import type { PlannerDocument } from '../document/PlannerDocument';
import {
  applyRecord,
  captureRecord,
  HistoryLog,
  type HistoryError,
  type HistoryRecord,
  type HistoryState,
  type HistoryZone,
} from './history/HistoryLog';
import type { PlannerBus } from './PlannerBus';
import { normalize, rebuild, type DerivedState, type NormalizeOptions, type WarningSink } from './rebuild';
import { err, ok, type Result } from '../document/Result';

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
 * Что транзакция делает с историей (ADR 0018 D5): `'none'` — `view.*`, `settings`, restore undo/redo;
 * `'reset'` — только `document.load` (оба контейнера чистятся, новый baseline); `{ zone, coalesce? }` —
 * запись в контейнер зоны после успешной транзакции содержимого, с ключом — замена записи серии.
 */
export type TransactionMeta = { history: 'none' | 'reset' | { zone: HistoryZone; coalesce?: string } };

/**
 * Внутренние хуки движка (ADR 0018 D9), не события шины: `beforeReplace` зовётся синхронно **до** транзакции
 * замены поддерева/документа мимо команд инструментов (restore undo/redo, `document.load`) и только если
 * замена состоится. `PlannerManager` подключает сюда `tools.interrupt()` (0057) и позже `selection.clear()`.
 */
export interface StoreHooks {
  beforeReplace(): void;
}

/**
 * Единственная точка мутации документа (ADR 0015 A2): хранит замороженный снимок, прогоняет транзакцию
 * «мутация → sync rebuild → запись в историю → события», владеет производным состоянием, историей (ADR 0018 D3)
 * и dirty-флагом (D7). Неймспейсы фасада — тонкие обёртки над `transact`/`restore`; ручных commit-точек нет.
 */
export class PlannerStore {
  private document: PlannerDocument;
  private derived: DerivedState;
  private readonly history: HistoryLog;
  /** Последний разосланный снимок флагов истории — `history:changed` только при смене (D4). */
  private historyState: HistoryState;
  private dirty = false;

  /** Куда уходят предупреждения ядра (soft-fail обхода контуров, нарушенные инварианты нормализации). */
  private readonly warn: WarningSink;
  private readonly hooks: StoreHooks;
  /**
   * Генератор id для новых записей нормализации. В проде не передаётся — по умолчанию это `document/id.ts`
   * (`uuidv7`). Инжектируется тестами, которым нужен воспроизводимый снимок: golden-фикстуры детерминируются
   * тем же способом (ADR 0021, «Смежное» → «Golden-фикстуры»), а путь открытия проекта идёт через стор,
   * поэтому без этой опции детерминизм обрывался бы на границе раннера.
   */
  private readonly createId: NormalizeOptions['createId'];

  constructor(
    private readonly bus: PlannerBus,
    initial: PlannerDocument,
    {
      warn = () => {},
      hooks = { beforeReplace: () => {} },
      createId,
    }: { warn?: WarningSink; hooks?: StoreHooks; createId?: NormalizeOptions['createId'] } = {},
  ) {
    this.warn = warn;
    this.hooks = hooks;
    this.createId = createId;
    const built = this.runRebuild(freeze(initial, true));
    this.document = built.document;
    this.derived = built.derived;
    this.history = new HistoryLog(this.document);
    this.historyState = this.history.get();
  }

  /** Замороженный снимок документа; ссылка стабильна между транзакциями. */
  getDocument(): PlannerDocument {
    return this.document;
  }

  /** Замороженный результат последнего rebuild; меняется только вместе с содержимым документа. */
  getDerived(): DerivedState {
    return this.derived;
  }

  /** Флаги undo/redo активной зоны — стабильный замороженный снимок (D4). */
  getHistoryState(): HistoryState {
    return this.history.get();
  }

  /** Есть ли несохранённые изменения содержимого (D7). */
  isDirty(): boolean {
    return this.dirty;
  }

  /** Успешное сохранение (заглушка до ADR F): снимает флаг, `document:dirty-changed` при смене. */
  markSaved(): void {
    this.setDirty(false);
  }

  /**
   * Разрыв серии коалесинга (ADR 0018 D5) — зовёт `tools` при смене выделения (клик мимо, другой объект, Esc).
   * Внутренний метод движка, не публичный API фасада: документ и записи не меняет, событий нет.
   */
  breakSeries(): void {
    this.history.breakSeries();
  }

  /**
   * Транзакция. Порядок: рецепт → (если изменилось содержимое, т.е. что-то кроме `view`) sync rebuild:
   * нормализация хранимого в том же снимке + производное от финализированного снимка → фиксация → запись
   * в историю по `meta` (снимок уже нормализован — D3) → dirty → события: `document:changed` при изменении
   * содержимого, `view:changed` при изменении `view`, `history:changed` при смене флагов активной зоны (в том
   * числе от смены вида без транзакции содержимого — D4), `document:dirty-changed` при смене флага — по одному
   * на изменившийся факт, ни одного при no-op. Состояние обновлено **до** эмита, поэтому подписчики читают
   * уже новый снимок. Исключения подписчиков изолирует фасад (`PlannerManager.subscribe/on`).
   *
   * Серию коалесинга рвёт только коммит в историю (любой зоны/ключа), undo/redo, `load` и `breakSeries()`;
   * транзакция содержимого с `'none'` (`settings`) и no-op-транзакции серию не трогают: `settings` вне
   * истории (D3), а D5 перечисляет именно коммиты. `'reset'` — только через `load()`.
   */
  transact(recipe: TransactionRecipe, meta: TransactionMeta): void {
    const prev = this.document;
    const mutated = immer.produce(prev, recipe);
    if (mutated === prev) {
      // Документ не изменился, но `'reset'` — это всегда новый baseline (`load` того же снимка), а флаги
      // истории могли смениться и без документа: `restore` двигает указатель до транзакции, и запись, совпавшая
      // с текущим поддеревом по ссылке, даёт no-op-транзакцию.
      if (meta.history === 'reset') this.history.reset(prev);
      this.emitHistoryChanged();
      if (meta.history === 'reset') this.setDirty(false);
      return;
    }

    const contentChanged = hasContentChanged(prev, mutated);
    const next = contentChanged ? this.runRebuild(mutated) : { document: mutated, derived: this.derived };

    this.document = next.document;
    this.derived = next.derived;

    if (meta.history === 'reset') {
      this.history.reset(next.document);
    } else {
      if (contentChanged && meta.history !== 'none') {
        this.history.commit(next.document, meta.history.zone, meta.history.coalesce);
      }
      if (next.document.view.activeView !== prev.view.activeView)
        this.history.setViewZone(next.document.view.activeView);
    }

    if (contentChanged) this.bus.emit('document:changed', { document: next.document });
    if (next.document.view !== prev.view) this.bus.emit('view:changed', next.document.view);
    this.emitHistoryChanged();
    // `load` сбрасывает флаг после своей транзакции; любая другая транзакция содержимого — ставит.
    if (meta.history === 'reset') this.setDirty(false);
    else if (contentChanged) this.setDirty(true);
  }

  /**
   * Restore undo/redo активной зоны (ADR 0018 D3/D9): хук `beforeReplace` → сдвиг указателя → транзакция
   * замены поддеревьев `floors[i].layout` / `.scene` с `history: 'none'` → обычный `normalize`/`rebuild`
   * (идемпотентен, C10: ссылка поддерева после restore совпадает с записью) → одно `document:changed`,
   * `history:changed`, dirty. На пустом стеке — ошибка без вызова хука. Запись, совпавшая с текущими
   * поддеревьями по ссылке (штатными командами недостижимо: записи рождаются только из изменившегося
   * содержимого), — замена не состоится: без хука и без `document:changed`, но указатель и dirty — как обычно.
   */
  restore(direction: 'undo' | 'redo'): Result<void, HistoryError> {
    const record = direction === 'undo' ? this.history.peekUndo() : this.history.peekRedo();
    if (record === null) return err({ kind: direction === 'undo' ? 'nothing-to-undo' : 'nothing-to-redo' });
    if (!sameRecord(record, captureRecord(this.document, record.zone))) this.hooks.beforeReplace();
    this.history.step(direction === 'undo' ? -1 : 1);
    this.transact(draft => applyRecord(draft, record), { history: 'none' });
    // Restore — транзакция содержимого по смыслу (D7), даже если запись совпала с текущим снимком по ссылке.
    this.setDirty(true);
    return ok(undefined);
  }

  /**
   * Замена документа целиком (`document.load`, ADR 0018 D3/D5/D7/D9): хук `beforeReplace` (только если замена
   * состоится — не тот же снимок) → транзакция `'reset'` (оба контейнера — новый baseline из нормализованного
   * документа, `lastCommitKey = null`, активная зона — по виду) → dirty снят. Единственный путь к `'reset'`.
   */
  load(document: PlannerDocument): void {
    const frozen = freeze(document, true);
    if (frozen !== this.document) this.hooks.beforeReplace();
    this.transact(() => frozen, { history: 'reset' });
  }

  /** Две фазы rebuild: нормализация хранимого через черновик, производное — от готового снимка. */
  private runRebuild(base: PlannerDocument): { document: PlannerDocument; derived: DerivedState } {
    const document = immer.produce(base, draft => normalize(draft, { warn: this.warn, createId: this.createId }));
    return { document, derived: freeze(rebuild(document, { warn: this.warn }), true) };
  }

  /** `history:changed` — ровно при смене флагов активной зоны (D4). */
  private emitHistoryChanged(): void {
    const state = this.history.get();
    if (state === this.historyState) return;
    this.historyState = state;
    this.bus.emit('history:changed', state);
  }

  private setDirty(dirty: boolean): void {
    if (this.dirty === dirty) return;
    this.dirty = dirty;
    this.bus.emit('document:dirty-changed', { dirty });
  }
}

/** Запись совпадает с текущими поддеревьями по ссылке — restore был бы no-op. */
const sameRecord = (a: HistoryRecord, b: HistoryRecord): boolean =>
  a.zone === b.zone &&
  a.floors.length === b.floors.length &&
  a.floors.every((floor, index) => {
    const other = b.floors[index]!;
    return floor.floorId === other.floorId && subtreeOf(floor) === subtreeOf(other);
  });

const subtreeOf = (floor: HistoryRecord['floors'][number]): unknown => ('layout' in floor ? floor.layout : floor.scene);

/** Изменилось ли что-то кроме `view` — то, что требует rebuild и события `document:changed`. */
const hasContentChanged = (prev: PlannerDocument, next: PlannerDocument): boolean => {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof PlannerDocument>;
  for (const key of keys) {
    if (key !== 'view' && next[key] !== prev[key]) return true;
  }
  return false;
};
