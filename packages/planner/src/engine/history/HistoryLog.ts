import type { WritableDraft } from 'immer';

import type { Id } from '../../document/id';
import type { FloorLayout, FloorScene, PlannerDocument, ViewKind } from '../../document/PlannerDocument';

/** Зона истории — контейнер, в который пишет транзакция (ADR 0018 D3): планировка или обстановка. */
export type HistoryZone = 'layout' | 'scene';

/**
 * Запись контейнера — ссылки на замороженные поддеревья всех этажей одной зоны (снимок «по ссылке»,
 * ADR 0018 D3): для `layout` — после `normalize` той же транзакции, для `scene` — как есть. Форма — с
 * дискриминантом `zone` поверх скетча ADR (`{ floorId, layout }[]`), чтобы `applyRecord` знал, что подменять.
 */
export type HistoryRecord =
  | { zone: 'layout'; floors: readonly { floorId: Id; layout: FloorLayout }[] }
  | { zone: 'scene'; floors: readonly { floorId: Id; scene: FloorScene }[] };

/** Memento «stack + pointer» одной зоны: `states[0]` — baseline, `pointer` — текущее состояние. */
interface HistoryContainer {
  states: HistoryRecord[];
  pointer: number;
  /** Ключ коалесинга последнего коммита в этот контейнер; `null` — серии нет. */
  lastCommitKey: string | null;
}

export type HistoryError = { kind: 'nothing-to-undo' } | { kind: 'nothing-to-redo' };

/** Снимок истории для UI (`history.get()`) и payload `history:changed`. */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

/** Лимит записей сверх baseline на контейнер (ADR 0018 D6, спека 09): в контейнере до `MAX_HISTORY + 1` состояний. */
export const MAX_HISTORY = 100;

/** Зона активного вида (D4): конструктор правит планировку, остальные виды — обстановку. */
export const zoneOfView = (view: ViewKind): HistoryZone => (view === 'constructor' ? 'layout' : 'scene');

/** Четыре стабильных замороженных снимка — `history.get()` возвращает одну и ту же ссылку при тех же флагах. */
const STATES: Record<`${boolean}:${boolean}`, HistoryState> = {
  'false:false': Object.freeze({ canUndo: false, canRedo: false }),
  'false:true': Object.freeze({ canUndo: false, canRedo: true }),
  'true:false': Object.freeze({ canUndo: true, canRedo: false }),
  'true:true': Object.freeze({ canUndo: true, canRedo: true }),
};

/** Снимок зоны из замороженного документа: ссылки на поддеревья, без копирования. */
export const captureRecord = (document: PlannerDocument, zone: HistoryZone): HistoryRecord =>
  zone === 'layout'
    ? { zone, floors: document.floors.map(floor => ({ floorId: floor.id, layout: floor.layout })) }
    : { zone, floors: document.floors.map(floor => ({ floorId: floor.id, scene: floor.scene })) };

/**
 * Восстановление записи в черновик — замена поддеревьев по `floorId` (D3). Этажи, которых в записи нет,
 * не трогаются (в v0 такого не бывает: этажи меняет только `load`, который чистит историю).
 */
export const applyRecord = (draft: WritableDraft<PlannerDocument>, record: HistoryRecord): void => {
  const byId = new Map(draft.floors.map(floor => [floor.id, floor]));
  if (record.zone === 'layout') {
    for (const { floorId, layout } of record.floors) {
      const floor = byId.get(floorId);
      if (floor && floor.layout !== layout) floor.layout = layout as WritableDraft<FloorLayout>;
    }
    return;
  }
  for (const { floorId, scene } of record.floors) {
    const floor = byId.get(floorId);
    if (floor && floor.scene !== scene) floor.scene = scene as WritableDraft<FloorScene>;
  }
};

const createContainer = (baseline: HistoryRecord): HistoryContainer => ({
  states: [baseline],
  pointer: 0,
  lastCommitKey: null,
});

/**
 * Два контейнера истории и активная зона (ADR 0018 D3–D6) — чистое состояние без документа и шины:
 * кто пишет и когда — `PlannerStore.transact`, кто восстанавливает — `PlannerStore.restore`. Класс ничего
 * не эмитит: `PlannerStore` сравнивает `get()` до и после и сам шлёт `history:changed`.
 */
export class HistoryLog {
  private containers!: Record<HistoryZone, HistoryContainer>;
  private activeZone!: HistoryZone;

  constructor(document: PlannerDocument) {
    this.reset(document);
  }

  /** Флаги активной зоны — стабильный замороженный снимок. */
  get(): HistoryState {
    const { states, pointer } = this.containers[this.activeZone];
    return STATES[`${pointer >= 1}:${pointer < states.length - 1}`];
  }

  getActiveZone(): HistoryZone {
    return this.activeZone;
  }

  /** `load`/создание (D3, D5 `'reset'`): оба контейнера — один baseline, серии нет, зона — по виду документа. */
  reset(document: PlannerDocument): void {
    this.containers = {
      layout: createContainer(captureRecord(document, 'layout')),
      scene: createContainer(captureRecord(document, 'scene')),
    };
    this.activeZone = zoneOfView(document.view.activeView);
  }

  /**
   * Запись после успешной транзакции содержимого (D5): с ключом, совпавшим с последним коммитом, — замена
   * записи на `pointer` (одна запись на серию), иначе push с обрезкой redo-хвоста и лимитом D6. Любой коммит
   * делает свою зону активной и рвёт серию другого ключа/контейнера.
   */
  commit(document: PlannerDocument, zone: HistoryZone, coalesce?: string): void {
    const record = captureRecord(document, zone);
    const container = this.containers[zone];
    const coalesced = coalesce !== undefined && container.lastCommitKey === coalesce;
    this.breakSeries();
    container.lastCommitKey = coalesce ?? null;
    this.activeZone = zone;

    container.states.length = container.pointer + 1;
    if (coalesced) {
      container.states[container.pointer] = record;
      return;
    }
    container.states.push(record);
    container.pointer++;
    if (container.states.length > MAX_HISTORY + 1) {
      container.states.shift();
      container.pointer--;
    }
  }

  /** Сброс серии коалесинга (D5): другой коммит, undo/redo, `load`, смена выделения (`tools`). */
  breakSeries(): void {
    this.containers.layout.lastCommitKey = null;
    this.containers.scene.lastCommitKey = null;
  }

  /** Смена активного вида (D4): активной становится зона вида; серия при этом не рвётся. */
  setViewZone(view: ViewKind): void {
    this.activeZone = zoneOfView(view);
  }

  /** Запись, к которой перейдёт undo активной зоны, или `null`. Указатель не двигает. */
  peekUndo(): HistoryRecord | null {
    const { states, pointer } = this.containers[this.activeZone];
    return pointer >= 1 ? states[pointer - 1]! : null;
  }

  peekRedo(): HistoryRecord | null {
    const { states, pointer } = this.containers[this.activeZone];
    return pointer < states.length - 1 ? states[pointer + 1]! : null;
  }

  /** Сдвиг указателя активной зоны на `step` (±1) после состоявшегося restore; рвёт серию. */
  step(step: -1 | 1): void {
    this.containers[this.activeZone].pointer += step;
    this.breakSeries();
  }
}
