import type { WritableDraft } from 'immer';

import type { Id } from '../document/id';
import type { PlannerDocument } from '../document/PlannerDocument';

/**
 * Производное состояние этажа — результат rebuild, живёт в движке и не сериализуется (ADR 0016, таблица
 * «Хранится / выводится»). Пересоздаётся целиком на каждой транзакции содержимого, стабильных id между
 * пересборками нет (Q3/Q35). Стены-тела, комнаты, оси, триангуляция появятся в ADR C (шаг 2), меши — ADR G.
 * Только plain-значения: ссылки на узлы замороженного снимка допустимы, узлы черновика — нет.
 */
export interface DerivedFloor {
  readonly id: Id;
}

export interface DerivedState {
  readonly floors: readonly DerivedFloor[];
}

/**
 * Нормализация хранимого — первая фаза rebuild, часть транзакции фасада (ADR 0015 A2, ADR 0016 B4):
 * получает черновик документа **после** мутации команды и правит хранимое (ужать полы, дописать авто-полы,
 * удалить зоны без опоры и проёмы без оси, переписать `anchor` — шаг 2), чтобы снимок undo уже содержал
 * пересобранный документ. Шаг 1: нормализовать нечего.
 */
export const normalize = (_document: WritableDraft<PlannerDocument>): void => {};

/**
 * Построение производного — вторая фаза rebuild: чистая функция от **финализированного** (замороженного)
 * снимка, поэтому в `DerivedState` не могут утечь прокси immer. Вызывается только для транзакций содержимого;
 * `view` ничего не пересобирает. Шаг 1: по одной пустой записи на этаж.
 */
export const rebuild = (document: PlannerDocument): DerivedState => ({
  floors: document.floors.map(floor => ({ id: floor.id })),
});
