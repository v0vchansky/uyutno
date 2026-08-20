import * as fc from 'fast-check';

import { fcParams } from '../document/geometry/testing/arbitraries';
import { arbDocument, arbRawCoordinate } from '../document/testing/arbDocument';
import { createPlanBuilder } from '../document/testing/planBuilder';
import { quantize } from '../document/quantize';
import { parse } from './parse';
import { serialize } from './serialize';

/**
 * `load(save(x)) == x` — инвариант ADR 0016 B5 и условие приёмки ADR 0021, гоняется на `fast-check`
 * с фиксированным seed (`fcParams`, testing-strategy: контрпример фиксируется отдельным регресс-тестом,
 * а не сменой seed).
 */
describe('round-trip формата — property (fast-check, фиксированный seed)', () => {
  it('parse(serialize(x)) == x', () => {
    fc.assert(
      fc.property(arbDocument, document => {
        const result = parse(serialize(document));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual(document);
      }),
      fcParams,
    );
  });

  it('serialize(parse(serialize(x))) байт в байт равен serialize(x)', () => {
    fc.assert(
      fc.property(arbDocument, document => {
        const text = serialize(document);
        const result = parse(text);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(serialize(result.value)).toBe(text);
      }),
      fcParams,
    );
  });

  it('второй круг ничего не меняет: parse(serialize(parse(serialize(x)))) == parse(serialize(x))', () => {
    fc.assert(
      fc.property(arbDocument, document => {
        const once = parse(serialize(document));
        expect(once.ok).toBe(true);
        if (!once.ok) return;
        const twice = parse(serialize(once.value));
        expect(twice.ok).toBe(true);
        if (!twice.ok) return;
        expect(twice.value).toEqual(once.value);
      }),
      fcParams,
    );
  });

  it('неквантованный вход квантуется, и второй разбор уже неподвижен', () => {
    fc.assert(
      fc.property(fc.array(arbRawCoordinate, { minLength: 8, maxLength: 8 }), coords => {
        const b = createPlanBuilder();
        b.contour('inner', [
          b.point(coords[0]!, coords[1]!),
          b.point(coords[2]!, coords[3]!),
          b.point(coords[4]!, coords[5]!),
          b.point(coords[6]!, coords[7]!),
        ]);
        const once = parse(serialize(b.document()));
        expect(once.ok).toBe(true);
        if (!once.ok) return;
        for (const point of Object.values(once.value.floors[0]!.layout.points)) {
          expect(point.x).toBe(quantize(point.x));
          expect(point.y).toBe(quantize(point.y));
        }
        const twice = parse(serialize(once.value));
        expect(twice.ok).toBe(true);
        if (!twice.ok) return;
        expect(twice.value).toEqual(once.value);
      }),
      fcParams,
    );
  });
});
