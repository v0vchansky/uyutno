// Единственное место слоя с Node API (чтение собственных исходников): типы Node подключаются точечно,
// как в golden-тесте ленты, а не в `tsconfig.json` пакета.
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

/**
 * Тест-гвард узкого входа `@uyutno/planner/format` (ADR 0021, приёмка задачи 0079).
 *
 * Линтера мало: `no-restricted-imports` видит только те импорты, что написаны прямо в файлах слоя, и
 * молчит про транзитивную протечку — `format/` → `document/foo` → `engine/bar` → `three` он не поймает.
 * Поэтому здесь обходится **реальный граф** импортов от `src/format/index.ts`.
 *
 * Графа два, и различие между ними существенное:
 *
 * - **рантайм-граф** — то, что реально загрузит `node` в серверном процессе. `import type` / `export type`
 *   в него не входят: они стираются компилятором. Именно на нём проверяется «ни `three`, ни `react`, ни
 *   лишних пакетов» — ставка ADR про вес серверного процесса.
 * - **граф ссылок** — вообще все специфаеры, включая типовые. На нём проверяется дисциплина слоёв:
 *   `engine/`/`projection/`/`ui/` не должно быть даже в типовой ссылке («ни в каком виде», задача 0079).
 *
 * Различать обязательно: `document/PlannerDocument.ts` типом ссылается на `document/id.ts`, а тот тянет
 * `uuidv7`. В рантайме этого импорта нет вовсе, и записать `uuidv7` в зависимости серверного входа было бы
 * неправдой — но и делать вид, что типовых ссылок не существует, для слоёв нельзя.
 *
 * `verbatimModuleSyntax: true` (корневой `tsconfig.base.json`) — то, что делает деление честным: стирается
 * только полная форма `import type ... from`, а `import { type A } from` компилятор сохраняет.
 */

const SRC = path.join(__dirname, '..');
const ENTRY = path.join(__dirname, 'index.ts');

/** Слои, которых во входе быть не может ни транзитивно, ни в виде типовой ссылки. */
const FORBIDDEN_LAYERS = ['engine', 'projection', 'ui'];
/** Внешние пакеты, ради которых гвард и существует. */
const FORBIDDEN_PACKAGES = ['three', 'react', 'react-dom'];

/**
 * Внешние зависимости, которые вход тянет в рантайме. Список закрытый: новая строка здесь — сознательное
 * решение «это едет в серверный процесс», а не побочный эффект чужой правки.
 */
const RUNTIME_PACKAGES = ['zod'];

interface Ref {
  specifier: string;
  /** Полная форма `import type ... from` / `export type ... from` — стирается компилятором. */
  typeOnly: boolean;
}

const collectRefs = (source: string): Ref[] => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const refs: Ref[] = [];
  for (const match of code.matchAll(/(?:^|[\s;}])(?:import|export)(\s+type)?\s[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
    refs.push({ specifier: match[2]!, typeOnly: match[1] !== undefined });
  }
  for (const pattern of [
    /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of code.matchAll(pattern)) refs.push({ specifier: match[1]!, typeOnly: false });
  }
  return refs;
};

const resolveRelative = (fromFile: string, specifier: string): string => {
  const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Не разрешается импорт '${specifier}' из ${fromFile}`);
};

interface Graph {
  files: string[];
  packages: string[];
  /** Путь, которым дотянулись до файла — чтобы падение показывало, через что протекло. */
  via: Map<string, string[]>;
}

/** @param includeTypeOnly `false` — рантайм-граф (типовые ссылки не считаются), `true` — граф ссылок. */
const walk = (entry: string, includeTypeOnly: boolean): Graph => {
  const files: string[] = [];
  const packages = new Set<string>();
  const via = new Map<string, string[]>([[entry, [entry]]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (files.includes(file)) continue;
    files.push(file);
    const trail = via.get(file)!;
    for (const ref of collectRefs(fs.readFileSync(file, 'utf8'))) {
      if (ref.typeOnly && !includeTypeOnly) continue;
      if (ref.specifier.startsWith('.')) {
        const resolved = resolveRelative(file, ref.specifier);
        if (!via.has(resolved)) via.set(resolved, [...trail, resolved]);
        queue.push(resolved);
      } else {
        packages.add(ref.specifier.replace(/^(@[^/]+\/[^/]+|[^@/][^/]*).*$/, '$1'));
      }
    }
  }
  return { files, packages: [...packages], via };
};

const relative = (file: string): string => path.relative(SRC, file);
const layerOf = (file: string): string | undefined => relative(file).split(path.sep)[0];
/** Путь протечки словами — иначе падение показывает голый список и не говорит, откуда взялось. */
const trail = (graph: Graph, file: string): string => graph.via.get(file)!.map(relative).join(' → ');

describe('узкий вход @uyutno/planner/format — гвард графа импортов', () => {
  const runtime = walk(ENTRY, false);
  const references = walk(ENTRY, true);

  it('вход вообще собирается: граф непустой и начинается с index.ts', () => {
    expect(runtime.files[0]).toBe(ENTRY);
    expect(runtime.files.length).toBeGreaterThan(1);
  });

  it.each(FORBIDDEN_LAYERS)('в рантайм-графе нет ни одного файла слоя `%s/`', layer => {
    const leaked = runtime.files.filter(file => layerOf(file) === layer);
    expect(leaked.map(file => trail(runtime, file))).toEqual([]);
  });

  it.each(FORBIDDEN_LAYERS)('слоя `%s/` нет даже в типовой ссылке', layer => {
    const leaked = references.files.filter(file => layerOf(file) === layer);
    expect(leaked.map(file => trail(references, file))).toEqual([]);
  });

  it.each(FORBIDDEN_PACKAGES)('в рантайм-графе нет пакета `%s`', pkg => {
    expect(runtime.packages).not.toContain(pkg);
  });

  it.each(FORBIDDEN_PACKAGES)('пакета `%s` нет даже в типовой ссылке', pkg => {
    expect(references.packages).not.toContain(pkg);
  });

  it('в рантайме вход тянет только разрешённые внешние пакеты', () => {
    expect(runtime.packages.filter(pkg => !pkg.startsWith('node:')).sort()).toEqual(RUNTIME_PACKAGES);
  });

  it('из `document/` в рантайм-граф попадают только модули, которые сами ничего не тянут', () => {
    // Инвариант, ради которого `PlannerDocument.ts` оставлен без runtime-импортов, а фабрики пустого
    // проекта вынесены в `createEmptyDocument.ts`: иначе во вход приехал бы `uuidv7`.
    const fromDocument = runtime.files
      .filter(file => layerOf(file) === 'document')
      .map(relative)
      .sort();
    expect(fromDocument).toEqual(
      ['document/PlannerDocument.ts', 'document/Result.ts', 'document/quantize.ts'].map(p =>
        p.split('/').join(path.sep),
      ),
    );
  });

  describe('сам гвард работает — иначе «зелёный» ничего не значит', () => {
    const withBait = (files: Record<string, string>, check: (bait: string) => void): void => {
      const written = Object.keys(files).map(name => path.join(__dirname, name));
      Object.entries(files).forEach(([name, body]) => fs.writeFileSync(path.join(__dirname, name), body));
      try {
        check(written[0]!);
      } finally {
        written.forEach(file => fs.unlinkSync(file));
      }
    };

    it('прямой импорт three ловится', () => {
      withBait({ '__bait_three__.ts': "import { Scene } from 'three';\nexport const x = Scene;\n" }, bait => {
        expect(walk(bait, false).packages).toContain('three');
      });
    });

    it('транзитивная протечка в `engine/` ловится через промежуточный модуль', () => {
      withBait(
        {
          '__bait_engine__.ts': "export { rebuild } from './__bait_mid__';\n",
          '__bait_mid__.ts': "export { rebuild } from '../engine/rebuild';\n",
        },
        bait => {
          const leaky = walk(bait, false);
          // В самом `bait` импорта `engine/` не написано — слой найден только обходом графа.
          expect(leaky.files.some(file => layerOf(file) === 'engine')).toBe(true);
          expect(leaky.packages).toContain('immer');
        },
      );
    });

    it('типовая ссылка на `ui/` не считается рантайм-протечкой, но ловится графом ссылок', () => {
      withBait(
        {
          '__bait_type__.ts':
            "import type { PlannerProps } from '../ui/Planner/Planner';\nexport type P = PlannerProps;\n",
        },
        bait => {
          expect(walk(bait, false).files.some(file => layerOf(file) === 'ui')).toBe(false);
          expect(walk(bait, true).files.some(file => layerOf(file) === 'ui')).toBe(true);
        },
      );
    });
  });
});
