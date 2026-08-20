import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { REATTACH_GRID } from '../predicates/compareContours';
import { fcParams } from '../testing/arbitraries';
import {
  type AnchoredRecord,
  type DetectedContour,
  MIN_DONOR_POINTS,
  matchAnchoredRecords,
} from './matchAnchoredRecords';

const p = (x: number, y: number): PlanPosition => ({ x, y });
const square = (x0: number, y0: number, s: number): PlanPosition[] => [
  p(x0, y0),
  p(x0 + s, y0),
  p(x0 + s, y0 + s),
  p(x0, y0 + s),
];
const record = (anchorIds: string[], anchor: PlanPosition[]): AnchoredRecord => ({ anchorIds, anchor });
const found = (ids: string[], outline: PlanPosition[]): DetectedContour => ({ ids, outline });

const R0 = record(['a', 'b', 'c', 'd'], square(0, 0, 100));
const R1 = record(['e', 'f', 'g', 'h'], square(200, 0, 100));

/** Квадрат на сетке 50 см: якоря и обводы то пересекаются, то расходятся. */
const arbSquare: fc.Arbitrary<PlanPosition[]> = fc
  .record({
    x: fc.integer({ min: -10, max: 10 }),
    y: fc.integer({ min: -10, max: 10 }),
    size: fc.integer({ min: 1, max: 8 }),
  })
  .map(({ x, y, size }) => square(x * 50, y * 50, size * 50));

/** Записи с попарно различными наборами id: точное совпадение цикла может дать только «своя» запись. */
const arbRecords: fc.Arbitrary<AnchoredRecord[]> = fc
  .array(arbSquare, { minLength: 1, maxLength: 4 })
  .map(anchors => anchors.map((anchor, index) => record([`${index}a`, `${index}b`, `${index}c`, `${index}d`], anchor)));

describe('matchAnchoredRecords', () => {
  it('точное циклическое совпадение id побеждает перекрытие по площади более ранней записи', () => {
    expect(matchAnchoredRecords([R0, R1], [found(['g', 'h', 'e', 'f'], square(10, 10, 80))])).toEqual([1]);
    expect(matchAnchoredRecords([R0, R1], [found(['h', 'g', 'f', 'e'], square(10, 10, 80))])).toEqual([1]);
  });

  it('без совпадения id донор — первая запись, пересекающаяся по площади', () => {
    expect(matchAnchoredRecords([R0, R1], [found(['q', 'r', 's', 't'], square(10, 10, 80))])).toEqual([0]);
    expect(matchAnchoredRecords([R1, R0], [found(['q', 'r', 's', 't'], square(10, 10, 80))])).toEqual([1]);
  });

  it('перекрытия нет — null (донора не выдумываем)', () => {
    expect(matchAnchoredRecords([R0, R1], [found(['q', 'r', 's', 't'], square(500, 500, 50))])).toEqual([null]);
  });

  it('только общая граница перекрытием по площади не считается', () => {
    expect(matchAnchoredRecords([R0], [found(['q', 'r', 's', 't'], square(100, 0, 100))])).toEqual([null]);
  });

  it('порог MIN_DONOR_POINTS: якорь из 3 точек — донор, из 2 — нет', () => {
    expect(MIN_DONOR_POINTS).toBe(3);
    const three = record(['a', 'b', 'c'], [p(0, 0), p(100, 0), p(0, 100)]);
    const two = record(['a', 'b'], [p(0, 0), p(100, 100)]);
    expect(matchAnchoredRecords([three], [found(['q', 'r', 's'], square(0, 0, 100))])).toEqual([0]);
    expect(matchAnchoredRecords([two], [found(['q', 'r', 's'], square(0, 0, 100))])).toEqual([null]);
    // Тот же порог на ветке точного совпадения id.
    expect(matchAnchoredRecords([two], [found(['b', 'a'], square(0, 0, 100))])).toEqual([null]);
  });

  it('донор не расходуется: обе половинки разделённой сущности получают один индекс', () => {
    const left = found(['q', 'r', 's', 't'], [p(0, 0), p(50, 0), p(50, 100), p(0, 100)]);
    const right = found(['u', 'v', 'w', 'x'], [p(50, 0), p(100, 0), p(100, 100), p(50, 100)]);
    expect(matchAnchoredRecords([R0], [left, right])).toEqual([0, 0]);
  });

  it('пустые входы: нет записей — все null; нет сущностей — пустой результат', () => {
    expect(matchAnchoredRecords([], [found(['a', 'b', 'c'], square(0, 0, 100))])).toEqual([null]);
    expect(matchAnchoredRecords([R0], [])).toEqual([]);
  });

  it('вырожденная сущность (пустой обвод без id) донора не получает', () => {
    expect(matchAnchoredRecords([R0], [found([], [])])).toEqual([null]);
  });

  it('порог REATTACH_GRID: обвод, провалившийся между узлами сетки якоря, донора не находит', () => {
    expect(REATTACH_GRID).toBe(10);
    // Сетка строится по bbox якоря: у квадрата 1000×1000 узлы идут через 100 см (0, 100, … 900),
    // и квадрат 510..530 не накрывает ни одного — документированная слепота best-effort теста.
    const wide = record(['a', 'b', 'c', 'd'], square(0, 0, 1000));
    expect(matchAnchoredRecords([wide], [found(['q', 'r', 's', 't'], square(510, 510, 20))])).toEqual([null]);
  });

  it('направление сетки: она строится по якорю записи, не по обводу — зеркальный вход донора находит', () => {
    // Тот же зазор, аргументы наоборот: мелкий якорь семплирует сам себя с шагом 2 см и попадает в обвод.
    const tiny = record(['a', 'b', 'c', 'd'], square(510, 510, 20));
    expect(matchAnchoredRecords([tiny], [found(['q', 'r', 's', 't'], square(0, 0, 1000))])).toEqual([0]);
  });

  it('property: донор — либо `null`, либо индекс существующей записи', () => {
    fc.assert(
      fc.property(arbRecords, fc.array(arbSquare, { maxLength: 3 }), (records, outlines) => {
        const detected = outlines.map((outline, index) => found([`d${index}`, 'x', 'y', 'z'], outline));
        const donors = matchAnchoredRecords(records, detected);
        expect(donors).toHaveLength(detected.length);
        for (const donor of donors) {
          if (donor === null) continue;
          expect(Number.isInteger(donor)).toBe(true);
          expect(donor).toBeGreaterThanOrEqual(0);
          expect(donor).toBeLessThan(records.length);
        }
      }),
      fcParams,
    );
  });

  it('property: совпал цикл id — донор ровно та запись, независимо от геометрии и сдвига', () => {
    fc.assert(
      fc.property(arbRecords, fc.nat(), fc.nat(), arbSquare, (records, pick, shift, outline) => {
        const index = pick % records.length;
        const ids = records[index]!.anchorIds;
        const at = shift % ids.length;
        const rotated = [...ids.slice(at), ...ids.slice(0, at)];
        expect(matchAnchoredRecords(records, [found([...rotated], outline)])).toEqual([index]);
      }),
      fcParams,
    );
  });

  it('вход не мутируется', () => {
    const records = [R0, R1];
    const detected = [found(['q', 'r', 's', 't'], square(10, 10, 80))];
    const snapshot = JSON.stringify({ records, detected });
    matchAnchoredRecords(records, detected);
    expect(JSON.stringify({ records, detected })).toBe(snapshot);
  });
});
