import * as fc from 'fast-check';

import type { Point } from '../../PlannerDocument';
import type { Id } from '../../id';
import { fcParams } from '../testing/arbitraries';
import { classifyAreaEdges, contourFaces } from './areaEdges';
import { type AreaEdgeSet, type CutEdge, cutKey, reconcileCuts, requiredCuts } from './cutRecords';

interface CutRecord extends CutEdge {
  id: Id;
  material?: string;
}

let counter = 0;
const create = (edge: CutEdge): CutRecord => ({ id: `new-${++counter}`, a: edge.a, b: edge.b });

beforeEach(() => {
  counter = 0;
});

describe('cutKey', () => {
  it('пара неупорядочена: оба порядка дают один ключ', () => {
    expect(cutKey('p1', 'p2')).toBe(cutKey('p2', 'p1'));
  });

  it('разные пары — разные ключи', () => {
    expect(cutKey('p1', 'p2')).not.toBe(cutKey('p1', 'p3'));
  });

  it('разделитель обязателен: без него `a|bc` и `ab|c` склеились бы в одну строку', () => {
    // Пара упорядочена одинаково в обоих случаях, поэтому нормализация порядка тут не помогает —
    // различает ровно разделитель.
    expect(cutKey('a', 'bc')).not.toBe(cutKey('ab', 'c'));
  });
});

describe('requiredCuts', () => {
  it('интерьерные участки дают записи; стеновые до `requiredCuts` не доходят вовсе', () => {
    expect(
      requiredCuts([
        {
          interior: [
            { a: 'p1', b: 'p2' },
            { a: 'p3', b: 'p4' },
          ],
        },
      ]),
    ).toEqual([
      { a: 'p1', b: 'p2' },
      { a: 'p3', b: 'p4' },
    ]);
  });

  it('зона, все рёбра которой по стене, записей не даёт', () => {
    expect(requiredCuts([{ interior: [] }])).toEqual([]);
  });

  it('общий участок двух касающихся зон даёт ровно одну запись — независимо от порядка концов', () => {
    const cuts = requiredCuts([{ interior: [{ a: 'p2', b: 'p3' }] }, { interior: [{ a: 'p3', b: 'p2' }] }]);
    expect(cuts).toEqual([{ a: 'p2', b: 'p3' }]);
  });

  it('порядок детерминирован: первое вхождение в порядке зон и участков', () => {
    const cuts = requiredCuts([
      {
        interior: [
          { a: 'p1', b: 'p2' },
          { a: 'p2', b: 'p3' },
          { a: 'p3', b: 'p1' },
        ],
      },
      {
        interior: [
          { a: 'p3', b: 'p2' },
          { a: 'p2', b: 'p9' },
          { a: 'p9', b: 'p3' },
        ],
      },
    ]);
    expect(cuts.map(edge => cutKey(edge.a, edge.b))).toEqual([
      cutKey('p1', 'p2'),
      cutKey('p2', 'p3'),
      cutKey('p3', 'p1'),
      cutKey('p2', 'p9'),
      cutKey('p9', 'p3'),
    ]);
  });

  it('вырожденные входы: пустой набор зон, зона без участков, участок в одну точку', () => {
    expect(requiredCuts([])).toEqual([]);
    expect(requiredCuts([{ interior: [] }])).toEqual([]);
    expect(requiredCuts([{ interior: [{ a: 'p1', b: 'p1' }] }])).toEqual([]);
  });

  it('один и тот же участок, поданный дважды одной зоной, записи не дублирует', () => {
    expect(
      requiredCuts([
        {
          interior: [
            { a: 'p1', b: 'p2' },
            { a: 'p2', b: 'p1' },
          ],
        },
      ]),
    ).toEqual([{ a: 'p1', b: 'p2' }]);
  });
});

describe('reconcileCuts', () => {
  it('прежняя запись переживает пересборку со своим id и материалом, порядок концов не переписывается', () => {
    const old: CutRecord = { id: 'cut-1', a: 'p2', b: 'p1', material: 'tile' };
    const result = reconcileCuts([old], [{ a: 'p1', b: 'p2' }], create);
    expect(result).toEqual([old]);
    expect(result[0]).toBe(old);
  });

  it('новой паре — новая запись через `create`', () => {
    const result = reconcileCuts<CutRecord>([], [{ a: 'p1', b: 'p2' }], create);
    expect(result).toEqual([{ id: 'new-1', a: 'p1', b: 'p2' }]);
  });

  it('запись, которую больше не держит ни одна зона, отбрасывается', () => {
    const kept: CutRecord = { id: 'cut-1', a: 'p1', b: 'p2' };
    const orphan: CutRecord = { id: 'cut-2', a: 'p3', b: 'p4' };
    expect(reconcileCuts([kept, orphan], [{ a: 'p2', b: 'p1' }], create)).toEqual([kept]);
  });

  it('исчезла одна из двух касающихся зон, но участок остался интерьерным у выжившей — запись жива', () => {
    const shared: CutRecord = { id: 'cut-1', a: 'p2', b: 'p3', material: 'wood' };
    const both = requiredCuts([{ interior: [{ a: 'p2', b: 'p3' }] }, { interior: [{ a: 'p3', b: 'p2' }] }]);
    const alone = requiredCuts([{ interior: [{ a: 'p3', b: 'p2' }] }]);
    expect(reconcileCuts([shared], both, create)[0]).toBe(shared);
    expect(reconcileCuts([shared], alone, create)[0]).toBe(shared);
  });

  it('участок перестал быть интерьерным у всех — запись удаляется', () => {
    const shared: CutRecord = { id: 'cut-1', a: 'p2', b: 'p3' };
    expect(reconcileCuts([shared], requiredCuts([{ interior: [] }]), create)).toEqual([]);
  });

  it('дубли ключа среди хранимых схлопываются: донор — первый', () => {
    const first: CutRecord = { id: 'cut-1', a: 'p1', b: 'p2' };
    const second: CutRecord = { id: 'cut-2', a: 'p2', b: 'p1' };
    expect(reconcileCuts([first, second], [{ a: 'p1', b: 'p2' }], create)).toEqual([first]);
  });

  it('массив всегда новый, ссылочно совпадают только элементы — писать в черновик обязан вызывающий по сравнению', () => {
    const records: CutRecord[] = [
      { id: 'cut-1', a: 'p1', b: 'p2' },
      { id: 'cut-2', a: 'p2', b: 'p3' },
    ];
    const required = records.map(record => ({ a: record.a, b: record.b }));
    const result = reconcileCuts(records, required, create);
    expect(result).not.toBe(records);
    expect(result[0]).toBe(records[0]);
    expect(result[1]).toBe(records[1]);
  });

  it('порядок выхода задаёт `required`, а не порядок хранимых записей', () => {
    const first: CutRecord = { id: 'cut-1', a: 'p1', b: 'p2' };
    const second: CutRecord = { id: 'cut-2', a: 'p2', b: 'p3' };
    const result = reconcileCuts(
      [first, second],
      [
        { a: 'p3', b: 'p2' },
        { a: 'p2', b: 'p1' },
      ],
      create,
    );
    expect(result).toEqual([second, first]);
  });

  it('пустой нужный набор — пустой результат; вход не мутируется', () => {
    const records: CutRecord[] = [{ id: 'cut-1', a: 'p1', b: 'p2' }];
    expect(reconcileCuts(records, [], create)).toEqual([]);
    expect(records).toEqual([{ id: 'cut-1', a: 'p1', b: 'p2' }]);
  });
});

describe('property: набор записей и его перенос', () => {
  const arbId = fc.constantFrom<Id>('p1', 'p2', 'p3', 'p4', 'p5', 'p6');
  const arbCutEdge: fc.Arbitrary<CutEdge> = fc.record({ a: arbId, b: arbId });
  const arbArea: fc.Arbitrary<AreaEdgeSet> = fc.record({ interior: fc.array(arbCutEdge, { maxLength: 6 }) });

  it('`requiredCuts`: без дублей ключа, без вырожденных пар, идемпотентен на своём выходе', () => {
    fc.assert(
      fc.property(fc.array(arbArea, { maxLength: 4 }), areas => {
        const cuts = requiredCuts(areas);
        const keys = cuts.map(edge => cutKey(edge.a, edge.b));
        expect(new Set(keys).size).toBe(keys.length);
        expect(cuts.every(edge => edge.a !== edge.b)).toBe(true);
        // Выход, поданный обратно как единственная зона, даёт ровно себя же — и по составу, и по порядку.
        expect(requiredCuts([{ interior: cuts }])).toEqual(cuts);
      }),
      fcParams,
    );
  });

  it('`reconcileCuts`: повторный прогон на своём выходе ссылочно стабилен поэлементно', () => {
    fc.assert(
      fc.property(fc.array(arbArea, { maxLength: 4 }), fc.array(arbCutEdge, { maxLength: 5 }), (areas, stored) => {
        let counter = 0;
        const make = (edge: CutEdge): CutRecord => ({ id: `gen-${++counter}`, a: edge.a, b: edge.b });
        const existing = stored.filter(edge => edge.a !== edge.b).map(make);
        const required = requiredCuts(areas);
        const first = reconcileCuts(existing, required, make);
        const second = reconcileCuts(first, required, make);
        expect(second).toHaveLength(first.length);
        second.forEach((record, index) => expect(record).toBe(first[index]));
        // Ни одной лишней записи: набор ключей выхода — ровно набор ключей `required`.
        expect(first.map(record => cutKey(record.a, record.b))).toEqual(required.map(edge => cutKey(edge.a, edge.b)));
      }),
      fcParams,
    );
  });
});

describe('классификация участков зоны → нужные записи', () => {
  /** Полость-комната 380 × 280 с id точек — грани приходят с теми же объектами, что и точки зоны. */
  const room: Point[] = [
    { id: 'r1', x: 10, y: 10 },
    { id: 'r2', x: 390, y: 10 },
    { id: 'r3', x: 390, y: 290 },
    { id: 'r4', x: 10, y: 290 },
  ];
  const roomFaces = contourFaces([room]);

  /** Стадия 0069 в миниатюре: интерьерные участки зоны → пары id (концы участков — хранимые точки). */
  const areaCuts = (points: readonly Point[]): AreaEdgeSet => ({
    interior: classifyAreaEdges(points, roomFaces)
      .filter(segment => segment.kind === 'interior')
      .map(segment => ({ a: segment.a.id, b: segment.b.id })),
  });

  it('две касающиеся зоны: общий участок даёт ровно одну запись', () => {
    const p1: Point = { id: 'p1', x: 100, y: 100 };
    const p2: Point = { id: 'p2', x: 200, y: 100 };
    const p3: Point = { id: 'p3', x: 200, y: 200 };
    const p4: Point = { id: 'p4', x: 100, y: 200 };
    const p5: Point = { id: 'p5', x: 300, y: 100 };
    const p6: Point = { id: 'p6', x: 300, y: 200 };
    const cuts = requiredCuts([areaCuts([p1, p2, p3, p4]), areaCuts([p2, p5, p6, p3])]);
    expect(cuts).toHaveLength(7);
    expect(cuts.filter(edge => cutKey(edge.a, edge.b) === cutKey('p2', 'p3'))).toHaveLength(1);
  });

  it('зона, совпавшая с комнатой по всем сторонам: все участки `wall`, записей нет', () => {
    const full = room.map(point => ({ ...point, id: `a${point.id}` }));
    expect(classifyAreaEdges(full, roomFaces).every(segment => segment.kind === 'wall')).toBe(true);
    expect(requiredCuts([areaCuts(full)])).toEqual([]);
  });

  it('зона одной стороной по стене: стеновой участок записи не даёт', () => {
    const points: Point[] = [
      { id: 'p1', x: 10, y: 100 },
      { id: 'p2', x: 200, y: 100 },
      { id: 'p3', x: 200, y: 200 },
      { id: 'p4', x: 10, y: 200 },
    ];
    expect(classifyAreaEdges(points, roomFaces).map(segment => segment.kind)).toEqual([
      'interior',
      'interior',
      'interior',
      'wall',
    ]);
    expect(requiredCuts([areaCuts(points)])).toEqual([
      { a: 'p1', b: 'p2' },
      { a: 'p2', b: 'p3' },
      { a: 'p3', b: 'p4' },
    ]);
  });

  it('ребро по грани с продолжением через интерьер: запись только на интерьерном куске, конец — точка комнаты', () => {
    // L-образная полость: грань x = 200 идёт лишь от y = 150 (точка `r4`) до y = 290.
    const lShaped: Point[] = [
      { id: 'r1', x: 10, y: 10 },
      { id: 'r2', x: 390, y: 10 },
      { id: 'r3', x: 390, y: 150 },
      { id: 'r4', x: 200, y: 150 },
      { id: 'r5', x: 200, y: 290 },
      { id: 'r6', x: 10, y: 290 },
    ];
    const faces = contourFaces([lShaped]);
    const points: Point[] = [
      { id: 'a1', x: 200, y: 290 },
      { id: 'a2', x: 200, y: 50 },
      { id: 'a3', x: 100, y: 50 },
    ];
    const cuts = requiredCuts([
      {
        interior: classifyAreaEdges(points, faces)
          .filter(segment => segment.kind === 'interior')
          .map(segment => ({ a: segment.a.id, b: segment.b.id })),
      },
    ]);
    // Кусок a1 → r4 идёт по стене, кусок r4 → a2 — через интерьер: конец записи — точка комнаты.
    expect(cuts).toEqual([
      { a: 'r4', b: 'a2' },
      { a: 'a2', b: 'a3' },
      { a: 'a3', b: 'a1' },
    ]);
  });
});
