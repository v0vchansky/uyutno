// Единственное место в `engine/` с Node API (чтение/перезапись фикстур): типы Node подключаются точечно здесь,
// а не в `tsconfig.json` пакета — исходники движка изоморфны и Node-глобалов знать не должны (ADR 0015).
/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { Immer } from 'immer';

import type { FloorLayout, PlannerDocument } from '../document/PlannerDocument';
import { createSequentialIds } from '../document/testing/planBuilder';
import { migrate } from '../format/migrate';
import { parse } from '../format/parse';
import { serialize } from '../format/serialize';
import type { JsonObject, JsonValue } from '../format/version';
import { type DerivedFloor, normalize, rebuild } from './rebuild';

/**
 * Golden-фикстуры планов (ADR 0017 C10, testing-strategy): `geometry/fixtures/plan-*.json` формата
 * `{ name, input: PlannerDocument, expected: { layout, derived, warnings } }` — `layout` первого этажа после
 * `normalize`, `derived` — `DerivedFloor` от `rebuild`, id новых точек/контуров/записей — `n1, n2, …`
 * (инжектированный генератор), числа округлены до 1e-6. Любое изменение выхода падает громко; обновление
 * эталона — явный, ревьюируемый шаг: `UPDATE_GOLDEN=1 pnpm test` перезаписывает `expected` (дифф смотреть глазами).
 *
 * **`input` — не «просто объект», а конверт сейва** (ADR 0021, «Смежное» → «Golden-фикстуры»). Раннер поднимает
 * его тем же кодом, что и пользовательский документ: `parse` (внутри — конверт → цепочка миграций → схема →
 * чистка битых ссылок). Отсюда три вещи, которых у раннера не было раньше:
 *
 * - фикстура, которую парсер бы не принял (нет `format`, версия новее поддерживаемой, форма мимо схемы),
 *   роняет тест, а не тихо живёт «правильной» только для руками написанного раннера;
 * - фикстура обязана быть записана **в текущей версии формата**: `migrate` на ней — тождество. Подняли версию,
 *   не переснимая фикстуры — красное здесь (чек-лист поднятия версии — в `format/version.ts`);
 * - `UPDATE_GOLDEN=1` переписывает и `input`, прогнав его **той же цепочкой миграций**. В v0 цепочка пуста и
 *   шаг тождественный; ценность в том, что первая смена формата не начинается с проектирования процедуры.
 *
 * Дополнительно на каждой фикстуре проверяются: идемпотентность `normalize` после `parse`, round-trip
 * `parse(serialize(x)) == x`, детерминизм (второй прогон даёт то же самое, `uuidv7` в эталоне нет) и проброс
 * незнакомых схеме полей (`x-*`) через полный круг.
 */
interface PlanFixture {
  name: string;
  input: PlannerDocument;
  expected: { layout: FloorLayout; derived: DerivedFloor; warnings: string[] } | null;
}

const FIXTURES_DIR = path.join(__dirname, '..', 'document', 'geometry', 'fixtures');
const FIXTURE_PREFIX = 'plan-';
const PRECISION = 1e6;

/** Фикстура, чей `input` несёт поля, которых схема не знает (forward-compat, ADR 0021). */
const FORWARD_COMPAT_FIXTURE = 'plan-forward-compat-unknown-fields.json';

/** Префикс незнакомых схеме ключей в фикстурах: наши поля — `camelCase`, столкнуться нельзя. */
const UNKNOWN_PREFIX = 'x-';

/** `uuidv7` в эталоне означает, что генератор id куда-то не прокинут и детерминизм держится на удаче. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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

/** Подъём `input` тем же путём, что и пользовательского сейва. Отказ парсера — падение, а не пропуск. */
const parseFixture = (file: string, raw: unknown): PlannerDocument => {
  const result = parse(raw);
  if (!result.ok) throw new Error(`${file}: parse отверг input фикстуры — ${JSON.stringify(result.error)}`);
  return result.value;
};

/** Переснятие `input` цепочкой миграций — тем же кодом, что поднимает пользовательские сейвы. */
const migrateFixture = (file: string, raw: unknown): { document: JsonObject; changed: boolean } => {
  const result = migrate(raw);
  if (!result.ok) throw new Error(`${file}: migrate отверг input фикстуры — ${JSON.stringify(result.error)}`);
  return result.value;
};

const readFixture = (file: string): PlanFixture =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8')) as PlanFixture;

/** Пути всех незнакомых схеме ключей (`x-*`) с их значениями — обещание forward-compat в проверяемом виде. */
const unknownFields = (value: unknown, at: readonly string[] = []): { path: string[]; value: JsonValue }[] => {
  if (Array.isArray(value)) return value.flatMap((item, index) => unknownFields(item, [...at, String(index)]));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) =>
    key.startsWith(UNKNOWN_PREFIX)
      ? [{ path: [...at, key], value: item as JsonValue }]
      : unknownFields(item, [...at, key]),
  );
};

const readPath = (root: unknown, at: readonly string[]): unknown =>
  at.reduce<unknown>(
    (node, key) => (node === null || typeof node !== 'object' ? undefined : Reflect.get(node, key)),
    root,
  );

const runFixture = (
  input: PlannerDocument,
): { document: PlannerDocument; layout: FloorLayout; derived: DerivedFloor; warnings: string[] } => {
  const warnings: string[] = [];
  const createId = createSequentialIds('n');
  const normalized = immer.produce(input, draft => normalize(draft, { createId, warn: m => warnings.push(m) }));
  const derived = rebuild(normalized, { warn: m => warnings.push(m) });
  return { document: normalized, layout: normalized.floors[0]!.layout, derived: derived.floors[0]!, warnings };
};

const fixtureFiles = fs
  .readdirSync(FIXTURES_DIR)
  .filter(file => file.startsWith(FIXTURE_PREFIX) && file.endsWith('.json'))
  .sort();

describe('normalize/rebuild — golden', () => {
  it('набор фикстур на месте (spec-derived кейсы ADR 0017 C10)', () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(10);
  });

  it('заведена фикстура с незнакомыми схеме полями (forward-compat, ADR 0021)', () => {
    expect(fixtureFiles).toContain(FORWARD_COMPAT_FIXTURE);
    // Поля разложены по уровням конверта (корень, настройки, вид, этаж, раскладка, точка, контур, …),
    // иначе тест держал бы только один способ пронести незнакомое поле.
    expect(unknownFields(readFixture(FORWARD_COMPAT_FIXTURE).input).length).toBeGreaterThanOrEqual(8);
  });

  it.each(fixtureFiles)('%s', file => {
    const filePath = path.join(FIXTURES_DIR, file);
    const fixture = readFixture(file);

    // Фикстура — конверт сейва: парсер её принимает и ничего в ней не правит (иначе она записана в форме,
    // которой пользовательский документ никогда не имеет, и раннер проверял бы не тот вход).
    const parsed = parseFixture(file, fixture.input);
    expect(parsed).toEqual(fixture.input);

    // Записана в текущей версии формата: цепочка миграций для неё — тождество. Красное здесь читается ровно
    // как «версию формата подняли, фикстуры не переснимали» (чек-лист в `format/version.ts`).
    const migrated = migrateFixture(file, fixture.input);
    expect(migrated.changed).toBe(false);
    expect(migrated.document).toEqual(fixture.input);

    // Round-trip пути загрузки: `parse(serialize(x)) == x` — инвариант `load(save(x)) == x` (ADR 0021).
    const reloaded = parseFixture(file, serialize(parsed));
    expect(reloaded).toEqual(parsed);
    expect(serialize(reloaded)).toBe(serialize(parsed));

    const input = immer.produce(parsed, () => {});
    const run = runFixture(input);
    const actual = roundDeep({ layout: run.layout, derived: run.derived, warnings: run.warnings });

    // Детерминизм: повтор даёт то же самое, а `uuidv7` в эталон не попадает вовсе — все новые id приходят
    // из инжектированного генератора.
    const again = runFixture(input);
    expect(roundDeep({ layout: again.layout, derived: again.derived, warnings: again.warnings })).toEqual(actual);
    expect(JSON.stringify(actual)).not.toMatch(UUID);

    // Идемпотентность: повторный normalize нормализованного документа ничего не меняет (тот же объект).
    const normalizedOnce = immer.produce(input, draft => normalize(draft, { createId: createSequentialIds('n') }));
    const normalizedTwice = immer.produce(normalizedOnce, draft =>
      normalize(draft, { createId: createSequentialIds('m') }),
    );
    expect(normalizedTwice).toBe(normalizedOnce);

    // Forward-compat: незнакомые схеме поля переживают полный круг `parse` → `normalize` → `serialize`.
    const circled = parseFixture(file, serialize(run.document));
    for (const field of unknownFields(fixture.input)) {
      expect({ path: field.path, value: readPath(circled, field.path) }).toEqual(field);
    }

    if (process.env.UPDATE_GOLDEN) {
      // `input` переснимается цепочкой миграций, а не переписывается руками: на пустой цепочке это тождество.
      writeFixture({ ...fixture, input: migrated.document as unknown as PlannerDocument, expected: actual }, filePath);
      return;
    }
    expect(actual).toEqual(fixture.expected);
  });
});
