import { createDraft, finishDraft } from 'immer';

import { createEmptyDocument, createEmptyFloor } from '../document/PlannerDocument';
import { normalize, rebuild } from './rebuild';

describe('rebuild (шаг 1: пустой производный слой)', () => {
  it('по одной записи производного на этаж, в порядке этажей', () => {
    const doc = createEmptyDocument();
    doc.floors.push(createEmptyFloor());
    expect(rebuild(doc).floors.map(f => f.id)).toEqual(doc.floors.map(f => f.id));
  });

  it('документ без этажей → пустое производное', () => {
    expect(rebuild({ ...createEmptyDocument(), floors: [] })).toEqual({ floors: [] });
  });

  it('чистая функция: не мутирует вход, производное — новый объект на каждый вызов', () => {
    const doc = Object.freeze(createEmptyDocument());
    const a = rebuild(doc);
    const b = rebuild(doc);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('normalize (шаг 1: нормализовать нечего)', () => {
  it('черновик не меняется', () => {
    const doc = createEmptyDocument();
    const draft = createDraft(doc);
    normalize(draft);
    expect(finishDraft(draft)).toBe(doc);
  });
});
