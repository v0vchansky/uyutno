import fs from 'node:fs';
import path from 'node:path';

/**
 * Гвард узкого входа со стороны платформы (ADR 0021, приёмка задачи 0080).
 *
 * `packages/planner/src/format/importGraph.test.ts` доказывает, что сам вход `@uyutno/planner/format`
 * свободен от Three и остального движка. Здесь проверяется вторая половина того же обещания: что
 * **серверный процесс ходит именно в него**. Одного импорта из `@uyutno/planner` в любом серверном
 * модуле достаточно, чтобы половина редактора уехала на бэкенд, и гвард в пакете этого не увидит.
 */

const SERVER_ROOT = __dirname;
const NARROW_ENTRY = '@uyutno/planner/format';

const collectFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(full);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : [];
  });

const plannerSpecifiers = (source: string): string[] =>
  [...source.matchAll(/from\s*['"](@uyutno\/planner[^'"]*)['"]/g)].map(match => match[1]!);

describe('серверный процесс и пакет планера', () => {
  const files = collectFiles(SERVER_ROOT);

  it('в серверных модулях есть хотя бы один импорт формата — иначе гвард проверяет пустоту', () => {
    const users = files.filter(file => plannerSpecifiers(fs.readFileSync(file, 'utf8')).length > 0);

    expect(users.length).toBeGreaterThan(0);
  });

  it('сервер импортирует только узкий вход, а не пакет целиком', () => {
    const wrong = files.flatMap(file =>
      plannerSpecifiers(fs.readFileSync(file, 'utf8'))
        .filter(specifier => specifier !== NARROW_ENTRY)
        .map(specifier => `${path.relative(SERVER_ROOT, file)}: ${specifier}`),
    );

    expect(wrong).toEqual([]);
  });

  it('узкий вход резолвится и работает — и не тянет Three в процесс', async () => {
    const format = await import(NARROW_ENTRY);

    expect(format.DOCUMENT_VERSION).toBe(1);
    const migrated = format.migrate({ format: 'uyutno.planner', version: 1, floors: [] });
    expect(migrated.ok).toBe(true);

    const loaded = Object.keys(require.cache);
    // Механика проверки жива: реестр непустой и вход в нём действительно есть.
    expect(loaded.some(file => file.includes(path.join('planner', 'src', 'format')))).toBe(true);
    expect(loaded.filter(file => /[\\/]three[\\/]/.test(file))).toEqual([]);
  });
});
