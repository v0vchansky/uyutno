import { createPlanBuilder } from '../document/testing/planBuilder';
import { parse } from './parse';
import { serialize } from './serialize';
import { DOCUMENT_FORMAT, DOCUMENT_VERSION, type JsonObject } from './version';

const validDocument = (): JsonObject => {
  const b = createPlanBuilder();
  const { inner } = b.ring(0, 0, 400, 300, 10);
  b.room(inner, 'Гостиная', 280);
  b.cover('outer', inner, { ceilingHidden: false });
  return JSON.parse(JSON.stringify(b.document())) as JsonObject;
};

describe('parse — ветки разбора (ADR 0021, спека 10 «Ошибочные сценарии»)', () => {
  it('валидный документ разбирается, исключений наружу нет', () => {
    const result = parse(validDocument());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.format).toBe(DOCUMENT_FORMAT);
    expect(result.value.version).toBe(DOCUMENT_VERSION);
    expect(result.value.floors).toHaveLength(1);
  });

  it('валидная JSON-строка разбирается так же, как объект', () => {
    const raw = validDocument();
    const fromString = parse(JSON.stringify(raw));
    const fromObject = parse(raw);
    expect(fromString.ok && fromObject.ok).toBe(true);
    if (!fromString.ok || !fromObject.ok) return;
    expect(fromString.value).toEqual(fromObject.value);
  });

  it('нечитаемый JSON → corrupt', () => {
    const result = parse('{ это не json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('corrupt');
  });

  it.each([
    ['не объект (число)', 42],
    ['не объект (null)', null],
    ['массив вместо объекта', []],
  ])('%s → corrupt', (_name, raw) => {
    const result = parse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('corrupt');
  });

  it.each(['format', 'version', 'floors'])('отсутствует `%s` → corrupt («битый проект»)', key => {
    const raw = validDocument();
    delete raw[key];
    const result = parse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('corrupt');
  });

  it('чужой `format` → corrupt', () => {
    const result = parse({ ...validDocument(), format: 'other.planner' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('corrupt');
  });

  it('version новее поддерживаемой → unsupported-version', () => {
    const result = parse({ ...validDocument(), version: DOCUMENT_VERSION + 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: 'unsupported-version',
      version: DOCUMENT_VERSION + 1,
      supported: DOCUMENT_VERSION,
    });
  });

  it.each([0, -1, 1.5, 'первая'])('version не целое положительное (%p) → corrupt', version => {
    const result = parse({ ...validDocument(), version });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('corrupt');
  });

  it('version ниже текущей уходит в migrate и поднимается до текущей', () => {
    // Цепочка в v0 пуста, поэтому «ниже текущей» версий не существует: единственная поддерживаемая — 1.
    // Проверяем контракт на границе: версия текущая — проходит; всё, что выше, — отказ (тест рядом).
    const raw = { ...validDocument(), version: DOCUMENT_VERSION };
    const result = parse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(DOCUMENT_VERSION);
  });

  it('битые id-ссылки не делают проект битым: запись молча пропускается, остальное читается', () => {
    const raw = validDocument();
    const layout = (raw['floors'] as JsonObject[])[0]!['layout'] as JsonObject;
    const contours = layout['contours'] as JsonObject[];
    const covers = layout['covers'] as JsonObject[];
    const rooms = layout['rooms'] as JsonObject[];
    const before = contours.length;

    contours.push({ id: 'broken-contour', kind: 'inner', points: ['p1', 'нет-такой-точки'] });
    covers.push({ id: 'broken-cover', kind: 'outer', points: ['нет-такой-точки'], ceilingHidden: false });
    rooms.push({ id: 'orphan-room', anchor: ['нет-такой-точки'], name: 'Спальня', ceilingHeight: 280 });
    layout['areas'] = [{ id: 'broken-area', points: ['нет-такой-точки'], height: 240 }];
    layout['cuts'] = [{ id: 'broken-cut', a: 'p1', b: 'нет-такой-точки' }];

    const result = parse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = result.value.floors[0]!.layout;
    expect(parsed.contours).toHaveLength(before);
    expect(parsed.contours.map(c => c.id)).not.toContain('broken-contour');
    expect(parsed.covers.map(c => c.id)).not.toContain('broken-cover');
    expect(parsed.areas).toEqual([]);
    expect(parsed.cuts).toEqual([]);
    // Живые записи на месте — «битым проектом» такое не считается (спека 10).
    expect(Object.keys(parsed.points).length).toBeGreaterThan(0);
  });

  /**
   * Единственное исключение из «битая ссылка → запись пропускается»: `anchor` комнаты — устаревающая
   * подсказка пере-привязки, а не геометрия, и запись несёт введённые пользователем атрибуты. ADR 0021
   * требует не чистить сироты `rooms[]` в v0; фильтрация вдобавок ломала бы идемпотентность пути
   * загрузки (`engine/loadPathIdempotency.test.ts`).
   */
  it('запись-сирота rooms[] переживает загрузку со всеми атрибутами', () => {
    const raw = validDocument();
    const layout = (raw['floors'] as JsonObject[])[0]!['layout'] as JsonObject;
    (layout['rooms'] as JsonObject[]).push({
      id: 'orphan-room',
      anchor: ['нет-такой-точки'],
      name: 'Спальня',
      ceilingHeight: 310,
    });

    const result = parse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const orphan = result.value.floors[0]!.layout.rooms.find(room => room.id === 'orphan-room');
    expect(orphan).toEqual({ id: 'orphan-room', anchor: ['нет-такой-точки'], name: 'Спальня', ceilingHeight: 310 });
  });

  it('структурно негодное поле (points не объект) → corrupt', () => {
    const raw = validDocument();
    ((raw['floors'] as JsonObject[])[0]!['layout'] as JsonObject)['points'] = 'нет';
    const result = parse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('corrupt');
  });

  it('путь загрузки квантован: координаты ложатся на сетку 0.001 см', () => {
    const raw = validDocument();
    const layout = (raw['floors'] as JsonObject[])[0]!['layout'] as JsonObject;
    const points = layout['points'] as Record<string, JsonObject>;
    const first = Object.keys(points)[0]!;
    points[first] = { ...points[first]!, x: 12.34567891, y: -0.0004999 };
    (layout['cuts'] as JsonObject[]) = [];
    const scene = (raw['floors'] as JsonObject[])[0]!['scene'] as JsonObject;
    scene['rulers'] = [{ id: 'rl1', a: { x: 1.23456789, y: 0 }, b: { x: 0, y: 0 } }];
    scene['items'] = [
      { id: 'it1', kind: 'model', catalogId: 'c', x: 9.87654321, y: 0, elevation: 0.00049, rotation: 45 },
    ];

    const result = parse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = result.value.floors[0]!;
    expect(parsed.layout.points[first]).toMatchObject({ x: 12.346, y: 0 });
    expect(parsed.scene.rulers[0]!.a.x).toBe(1.235);
    expect(parsed.scene.items[0]!.x).toBe(9.877);
    expect(parsed.scene.items[0]!.elevation).toBe(0);
  });

  it('parse ничего не бросает на произвольном мусоре', () => {
    for (const junk of [undefined, Symbol('x'), () => 0, new Map(), NaN, '', '[]', '"строка"']) {
      expect(() => parse(junk)).not.toThrow();
      expect(parse(junk).ok).toBe(false);
    }
  });

  it('parse(serialize(x)) === x на собранном документе', () => {
    const raw = validDocument();
    const first = parse(raw);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = parse(serialize(first.value));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value).toEqual(first.value);
  });
});
