import { createPlanBuilder } from '../document/testing/planBuilder';
import { parse } from './parse';
import { serialize } from './serialize';
import type { JsonObject, JsonValue } from './version';

/**
 * Forward-compat (ADR 0021, «Версии, парсер, миграции»): внутри поддерживаемой версии добавление
 * необязательного поля версию **не двигает**, поэтому старый клиент обязан пронести незнакомое поле
 * через запись нетронутым. Zod по умолчанию делает обратное — молча срезает неизвестные ключи, — так что
 * сквозной проброс задаётся явно и держится вот этим тестом. Без него обещание существует только в ADR.
 */

/** Документ шага 2b со всеми видами записей: точка, контур, пол, зона, вырез, комната, предмет, линейка. */
const fullDocument = (): JsonObject => {
  const b = createPlanBuilder();
  const { inner } = b.ring(0, 0, 400, 300, 10);
  b.room(inner, 'Гостиная', 280);
  b.cover('outer', inner, { ceilingHidden: true });
  b.area([inner[0]!, inner[1]!, inner[2]!], 240);
  const document = b.document();
  const floor = document.floors[0]!;
  floor.layout.cuts.push({ id: 'cut1', a: inner[0]!, b: inner[2]! });
  floor.scene.items.push({ id: 'it1', kind: 'door', catalogId: 'door-1', x: 10, y: 20, elevation: 0, rotation: 90 });
  floor.scene.rulers.push({ id: 'rl1', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
  floor.scene.hidden.push('it1');
  return JSON.parse(JSON.stringify(document)) as JsonObject;
};

const at = (root: JsonValue, path: readonly (string | number)[]): JsonObject => {
  let node: JsonValue = root;
  for (const step of path) {
    node = (node as Record<string | number, JsonValue>)[step]!;
    expect(node).toBeDefined();
  }
  return node as JsonObject;
};

/**
 * Каждый уровень конверта, где у более нового бандла может появиться необязательное поле (список — из
 * приёмки задачи 0079): корень, `settings`, `view`, этаж, записи `layout` и записи `scene`.
 */
const LEVELS: readonly { name: string; path: readonly (string | number)[] }[] = [
  { name: 'корень', path: [] },
  { name: 'settings', path: ['settings'] },
  { name: 'view', path: ['view'] },
  { name: 'view.cameras.plan', path: ['view', 'cameras', 'plan'] },
  { name: 'floor', path: ['floors', 0] },
  { name: 'layout', path: ['floors', 0, 'layout'] },
  { name: 'layout.points[*]', path: ['floors', 0, 'layout', 'points', 'p1'] },
  { name: 'layout.contours[0]', path: ['floors', 0, 'layout', 'contours', 0] },
  { name: 'layout.covers[0]', path: ['floors', 0, 'layout', 'covers', 0] },
  { name: 'layout.areas[0]', path: ['floors', 0, 'layout', 'areas', 0] },
  { name: 'layout.cuts[0]', path: ['floors', 0, 'layout', 'cuts', 0] },
  { name: 'layout.rooms[0]', path: ['floors', 0, 'layout', 'rooms', 0] },
  { name: 'scene', path: ['floors', 0, 'scene'] },
  { name: 'scene.items[0]', path: ['floors', 0, 'scene', 'items', 0] },
  { name: 'scene.rulers[0]', path: ['floors', 0, 'scene', 'rulers', 0] },
];

describe('незнакомые поля переживают parse → serialize', () => {
  it.each(LEVELS)('$name', ({ path }) => {
    const raw = fullDocument();
    const marker = { note: 'из более нового бандла', nested: { deep: [1, 2, 3] } };
    at(raw, path)['futureField'] = marker;

    const parsed = parse(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const written = JSON.parse(serialize(parsed.value)) as JsonObject;
    expect(at(written, path)['futureField']).toEqual(marker);
  });

  it('все уровни сразу — ни одно поле не теряется', () => {
    const raw = fullDocument();
    for (const [i, level] of LEVELS.entries()) at(raw, level.path)[`future${i}`] = `keep-${i}`;

    const parsed = parse(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const written = JSON.parse(serialize(parsed.value)) as JsonObject;
    for (const [i, level] of LEVELS.entries()) {
      expect(at(written, level.path)[`future${i}`]).toBe(`keep-${i}`);
    }
  });

  it('незнакомое поле переживает и повторный круг записи-чтения', () => {
    const raw = fullDocument();
    at(raw, ['floors', 0, 'layout', 'rooms', 0])['futureField'] = 'v2';

    const once = parse(raw);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = parse(JSON.parse(serialize(once.value)) as JsonObject);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;

    const written = JSON.parse(serialize(twice.value)) as JsonObject;
    expect(at(written, ['floors', 0, 'layout', 'rooms', 0])['futureField']).toBe('v2');
  });

  it('отсутствующие косметические поля дефолтятся схемой, а не роняют разбор', () => {
    const raw = fullDocument();
    delete (at(raw, ['floors', 0, 'layout', 'covers', 0]) as Record<string, unknown>)['ceilingHidden'];
    delete (at(raw, ['floors', 0, 'layout', 'rooms', 0]) as Record<string, unknown>)['name'];
    delete (raw as Record<string, unknown>)['settings'];
    delete (raw as Record<string, unknown>)['view'];

    const parsed = parse(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const layout = parsed.value.floors[0]!.layout;
    expect(layout.covers[0]!.ceilingHidden).toBe(false);
    expect(layout.rooms[0]!.name).toBe('');
    expect(parsed.value.settings).toEqual({ units: 'cm', wallHeight: 280 });
    expect(parsed.value.view.activeView).toBe('constructor');
  });
});
