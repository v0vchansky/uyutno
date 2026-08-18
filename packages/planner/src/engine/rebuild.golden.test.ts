// Единственное место в `engine/` с Node API (чтение/перезапись фикстур): типы Node подключаются точечно здесь,
// а не в `tsconfig.json` пакета — исходники движка изоморфны и Node-глобалов знать не должны (ADR 0015).
/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { Immer } from 'immer';

import type { FloorLayout, PlannerDocument } from '../document/PlannerDocument';
import { createSequentialIds } from '../document/testing/planBuilder';
import { type DerivedFloor, normalize, rebuild } from './rebuild';

/**
 * Golden-фикстуры планов (ADR 0017 C10, testing-strategy): `geometry/fixtures/plan-*.json` формата
 * `{ name, input: PlannerDocument, expected: { layout, derived, warnings } }` — `layout` первого этажа после
 * `normalize`, `derived` — `DerivedFloor` от `rebuild`, id новых точек/контуров/записей — `n1, n2, …`
 * (инжектированный генератор), числа округлены до 1e-6. Любое изменение выхода падает громко; обновление
 * эталона — явный, ревьюируемый шаг: `UPDATE_GOLDEN=1 pnpm test` перезаписывает `expected` (дифф смотреть глазами).
 * Дополнительно на каждой фикстуре проверяется идемпотентность `normalize`.
 */
interface PlanFixture {
  name: string;
  input: PlannerDocument;
  expected: { layout: FloorLayout; derived: DerivedFloor; warnings: string[] } | null;
}

const FIXTURES_DIR = path.join(__dirname, '..', 'document', 'geometry', 'fixtures');
const FIXTURE_PREFIX = 'plan-';
const PRECISION = 1e6;

const immer = new Immer({ autoFreeze: true });

const roundDeep = <T>(value: T): T => {
  if (typeof value === 'number') {
    // Не-конечное значение в эталон не попадает молча — это баг реализации, а не новый эталон.
    if (!Number.isFinite(value)) throw new Error(`golden: non-finite value ${value}`);
    return (Math.round(value * PRECISION) / PRECISION || 0) as T;
  }
  if (Array.isArray(value)) return value.map(roundDeep) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundDeep(item)])) as T;
  }
  return value;
};

/**
 * Эталон записывается и форматируется Prettier тем же конфигом, что и репозиторий (иначе `pnpm format` красный
 * после `UPDATE_GOLDEN=1`). Prettier — devDep пакета; зовётся как CLI дочерним процессом: его API грузит ESM-ядро
 * динамическим импортом, который Jest без vm-modules не умеет.
 */
const writeFixture = (fixture: PlanFixture, filePath: string): void => {
  fs.writeFileSync(filePath, `${JSON.stringify(fixture)}\n`);
  execFileSync(process.execPath, [require.resolve('prettier/bin/prettier.cjs'), '--write', filePath], {
    stdio: 'ignore',
  });
};

const runFixture = (input: PlannerDocument): { layout: FloorLayout; derived: DerivedFloor; warnings: string[] } => {
  const warnings: string[] = [];
  const createId = createSequentialIds('n');
  const normalized = immer.produce(input, draft => normalize(draft, { createId, warn: m => warnings.push(m) }));
  const derived = rebuild(normalized, { warn: m => warnings.push(m) });
  return { layout: normalized.floors[0]!.layout, derived: derived.floors[0]!, warnings };
};

const fixtureFiles = fs
  .readdirSync(FIXTURES_DIR)
  .filter(file => file.startsWith(FIXTURE_PREFIX) && file.endsWith('.json'))
  .sort();

describe('normalize/rebuild — golden', () => {
  it('набор фикстур на месте (spec-derived кейсы ADR 0017 C10)', () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(10);
  });

  it.each(fixtureFiles)('%s', file => {
    const filePath = path.join(FIXTURES_DIR, file);
    const fixture = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PlanFixture;
    const input = immer.produce(fixture.input, () => {});
    const actual = roundDeep(runFixture(input));

    // Идемпотентность: повторный normalize нормализованного документа ничего не меняет (тот же объект).
    const normalizedOnce = immer.produce(input, draft => normalize(draft, { createId: createSequentialIds('n') }));
    const normalizedTwice = immer.produce(normalizedOnce, draft =>
      normalize(draft, { createId: createSequentialIds('m') }),
    );
    expect(normalizedTwice).toBe(normalizedOnce);

    if (process.env.UPDATE_GOLDEN) {
      writeFixture({ ...fixture, expected: actual }, filePath);
      return;
    }
    expect(actual).toEqual(fixture.expected);
  });
});
