import * as fc from 'fast-check';

import { fcParams } from '../document/geometry/testing/arbitraries';
import { arbDocument } from '../document/testing/arbDocument';
import { createPlanBuilder } from '../document/testing/planBuilder';
import type { PlannerDocument } from '../document/PlannerDocument';
import { serialize } from './serialize';

const sample = (): PlannerDocument => {
  const b = createPlanBuilder();
  const { inner } = b.ring(0, 0, 400, 300, 10);
  b.room(inner, 'Гостиная', 280);
  return b.document();
};

describe('serialize — детерминированный JSON (от него зависит diff-guard черновика, задача 0083)', () => {
  it('два прогона на одном документе дают идентичную строку', () => {
    const document = sample();
    expect(serialize(document)).toBe(serialize(document));
  });

  it('порядок ключей во входном объекте на результат не влияет', () => {
    const document = sample();
    const shuffled = JSON.parse(
      JSON.stringify({
        floors: document.floors,
        view: document.view,
        settings: document.settings,
        version: document.version,
        format: document.format,
      }),
    ) as PlannerDocument;
    expect(serialize(shuffled)).toBe(serialize(document));
  });

  it('порядок ключей в `points` (Record) на результат не влияет', () => {
    const document = sample();
    const reversed = structuredClone(document);
    const points = reversed.floors[0]!.layout.points;
    reversed.floors[0]!.layout.points = Object.fromEntries(Object.entries(points).reverse());
    expect(serialize(reversed)).toBe(serialize(document));
  });

  it('порядок элементов массивов сохраняется — это данные, а не оформление', () => {
    const document = sample();
    const swapped = structuredClone(document);
    const contours = swapped.floors[0]!.layout.contours;
    [contours[0], contours[1]] = [contours[1]!, contours[0]!];
    expect(serialize(swapped)).not.toBe(serialize(document));
  });

  it('результат — валидный JSON, эквивалентный документу', () => {
    const document = sample();
    expect(JSON.parse(serialize(document))).toEqual(JSON.parse(JSON.stringify(document)));
  });

  it('детерминизм на случайных документах', () => {
    fc.assert(
      fc.property(arbDocument, document => {
        expect(serialize(document)).toBe(serialize(structuredClone(document)));
      }),
      { ...fcParams, numRuns: 100 },
    );
  });
});
