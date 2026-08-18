// Единственное место в пакете с Node API (чтение/перезапись фикстур): типы Node подключаются точечно здесь,
// а не в `tsconfig.json` пакета — исходники ядра изоморфны и Node-глобалов знать не должны (ADR 0015).
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import type { PlanPosition } from '../../PlannerDocument';
import type { OffsetSide } from '../predicates/offsetPoint';
import { type StartNeighbourSegments, type WallBlock, blocksFromContour } from './blocksFromContour';

/**
 * Golden-фикстуры ленты (ADR 0017 C10, testing-strategy): spec-derived кейсы в `geometry/fixtures/band-*.json`
 * формата `{ name, input: { points, width, side, closed, startNeighbourSegments? }, expected: квады }`,
 * числа округлены до 1e-6. Любое изменение выхода падает громко; обновление эталона — явный, ревьюируемый шаг:
 * `UPDATE_GOLDEN=1 pnpm test` перезаписывает `expected` текущим выходом (дифф смотреть глазами).
 */
interface BandFixture {
  name: string;
  input: {
    points: PlanPosition[];
    width: number;
    side: OffsetSide;
    closed: boolean;
    startNeighbourSegments?: StartNeighbourSegments;
  };
  expected: WallBlock[];
}

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const FIXTURE_PREFIX = 'band-';
const PRECISION = 1e6;

const round = (value: number): number => {
  // Не-конечное значение в эталон не попадает молча — это баг реализации, а не новый эталон.
  if (!Number.isFinite(value)) throw new Error(`golden: non-finite value ${value}`);
  return Math.round(value * PRECISION) / PRECISION || 0;
};
const roundBlocks = (blocks: readonly WallBlock[]): WallBlock[] =>
  blocks.map(block => block.map(({ x, y }) => ({ x: round(x), y: round(y) })) as unknown as WallBlock);

/** JSON с точками в одну строку — Prettier сохраняет однострочные объекты, файл остаётся читаемым. */
const serializeFixture = (fixture: BandFixture): string =>
  `${JSON.stringify(fixture, null, 2).replace(/\{\s*"x": ([^,]+),\s*"y": ([^}]+?)\s*\}/g, '{ "x": $1, "y": $2 }')}\n`;

const fixtureFiles = fs
  .readdirSync(FIXTURES_DIR)
  .filter(file => file.startsWith(FIXTURE_PREFIX) && file.endsWith('.json'))
  .sort();

describe('blocksFromContour — golden', () => {
  it('набор фикстур на месте (spec-derived кейсы ADR 0017 C10)', () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(8);
  });

  it.each(fixtureFiles)('%s', file => {
    const filePath = path.join(FIXTURES_DIR, file);
    const fixture = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BandFixture;
    const { points, width, side, closed, startNeighbourSegments } = fixture.input;
    const actual = roundBlocks(blocksFromContour(points, width, side, closed, startNeighbourSegments));
    if (process.env.UPDATE_GOLDEN) {
      fs.writeFileSync(filePath, serializeFixture({ ...fixture, expected: actual }));
      return;
    }
    expect(actual).toEqual(fixture.expected);
  });
});
