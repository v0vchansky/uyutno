/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import * as fc from 'fast-check';
import { Immer, freeze } from 'immer';

import { fcParams } from '../document/geometry/testing/arbitraries';
import { arbDocument, arbRawCoordinate } from '../document/testing/arbDocument';
import { createPlanBuilder, createSequentialIds } from '../document/testing/planBuilder';
import type { PlannerDocument } from '../document/PlannerDocument';
import { quantize } from '../document/quantize';
import { parse } from '../format/parse';
import { serialize } from '../format/serialize';
import { createPlannerBus } from './PlannerBus';
import { PlannerStore } from './PlannerStore';
import { normalize } from './rebuild';

/**
 * Идемпотентность **пути загрузки** (ADR 0021, парковка build-order «(шаг 3, из разведки 2026-08-20 →
 * ADR F)»): путь загрузки — единственный вход документа без квантования, и это тот же круг пересборки,
 * который дал дефект задачи 0073 (`normalize(normalize(x)) != normalize(x)`). Проверяется **до** того,
 * как парсером начнут пользоваться.
 *
 * Живёт в `engine/`, а не в `format/`: `normalize` — движковый, а `format/` его не видит по правилу слоёв
 * (и override линтера запрещает такой импорт в самих тестах слоя тоже).
 */

const immer = new Immer({ autoFreeze: true });

const FIXTURES = path.join(__dirname, '..', 'document', 'geometry', 'fixtures');

const normalized = (document: PlannerDocument, prefix = 'n'): PlannerDocument =>
  immer.produce(freeze(document, true), draft => normalize(draft, { createId: createSequentialIds(prefix) }));

/** Документ, прошедший полный путь загрузки: запись → разбор. */
const loaded = (document: PlannerDocument): PlannerDocument => {
  const result = parse(serialize(document));
  if (!result.ok) throw new Error(`parse не должен падать на своём же выходе: ${JSON.stringify(result.error)}`);
  return result.value;
};

describe('путь загрузки квантован и идемпотентен', () => {
  it('normalize после parse неподвижен (property)', () => {
    fc.assert(
      fc.property(arbDocument, document => {
        const once = normalized(loaded(document));
        // Второй прогон обязан вернуть **тот же объект**: immer не пишет в черновик без фактического изменения.
        expect(normalized(once, 'm')).toBe(once);
      }),
      { ...fcParams, numRuns: 100 },
    );
  });

  /**
   * Главный случай, ради которого путь загрузки вообще квантуется: документ с координатами **не** на
   * сетке 0.001 см. Такой приезжает от чужого писателя или от нашего же более старого бандла, а внутри
   * движка неквантованная координата ломает сварку точек по `coordinateKey` — тот же механизм, что дал
   * дефект задачи 0073. Сгенерированный `arbDocument` квантован по построению и этот класс не покрывает.
   */
  it('неквантованный вход: после загрузки координаты на сетке, а normalize неподвижен (property)', () => {
    fc.assert(
      fc.property(fc.array(arbRawCoordinate, { minLength: 12, maxLength: 12 }), coords => {
        const b = createPlanBuilder();
        const at = (i: number): string => b.point(coords[i * 2]!, coords[i * 2 + 1]!);
        b.contour('inner', [at(0), at(1), at(2)]);
        b.contour('outer', [at(3), at(4), at(5)]);
        const document = loaded(b.document());
        for (const point of Object.values(document.floors[0]!.layout.points)) {
          expect(point.x).toBe(quantize(point.x));
          expect(point.y).toBe(quantize(point.y));
        }
        const once = normalized(document);
        expect(normalized(once, 'm')).toBe(once);
      }),
      { ...fcParams, numRuns: 100 },
    );
  });

  it('круг «нормализовать → сохранить → загрузить → нормализовать» сходится за один оборот (property)', () => {
    fc.assert(
      fc.property(arbDocument, document => {
        const first = normalized(loaded(document));
        const second = normalized(loaded(first), 'm');
        expect(second).toEqual(first);
      }),
      { ...fcParams, numRuns: 100 },
    );
  });

  /**
   * Golden-планы геометрии (`document/geometry/fixtures/plan-*.json`, поле `input`) — конверты сейва
   * с `format`/`version`, на которых уже ловились дефекты пересборки. Их прогон через круг
   * «сохранить → загрузить → нормализовать» — вторая половина требования приёмки, рядом с property.
   */
  const planFixtures = fs.readdirSync(FIXTURES).filter(name => name.startsWith('plan-') && name.endsWith('.json'));

  it('golden-планы найдены', () => {
    expect(planFixtures.length).toBeGreaterThan(5);
  });

  it.each(planFixtures)('%s: normalize(parse(serialize(x))) идемпотентен', file => {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')) as { input: PlannerDocument };
    const once = normalized(loaded(fixture.input));
    expect(normalized(once, 'm')).toBe(once);
  });

  /**
   * На golden-планах проверяется **неподвижность** круга, а не дословное равенство входу: часть фикстур
   * писалась без необязательных секций (`covers`/`areas`/`cuts`/`rooms`), и схема их дефолтит — это
   * штатный «режим совместимости» спеки 10, а не потеря данных. Дословное `load(save(x)) == x` держит
   * property-тест на полных документах (`format/roundtrip.property.test.ts`).
   */
  it.each(planFixtures)('%s: круг записи-чтения неподвижен', file => {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')) as { input: PlannerDocument };
    const once = loaded(fixture.input);
    expect(loaded(once)).toEqual(once);
    expect(serialize(loaded(once))).toBe(serialize(once));
  });
});

/**
 * Детерминизм **пути открытия проекта** (ADR 0021, «Смежное» → «Golden-фикстуры»). Golden-раннер инжектирует
 * генератор id прямо в `normalize`, но открытие проекта идёт не мимо стора: `PlannerStore` зовёт `normalize`
 * сам — в конструкторе (начальный документ) и в `load` (замена документа целиком, ADR 0018 D3/D5). Без
 * инжекции туда «детерминизм фикстур» кончался бы ровно на границе раннера, а любой тест открытия проекта
 * получал бы `uuidv7` и был бы вынужден их вычищать руками.
 *
 * В проде опция не передаётся — по умолчанию это тот же `document/id.ts`.
 */
describe('путь открытия проекта детерминизируется инжектированным генератором id', () => {
  /** `uuidv7` в снимке значит, что генератор до `normalize` внутри стора не дошёл. */
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  /** План, на котором `normalize` заводит новые записи (комнату, пол, рез) — иначе проверять нечего. */
  const document = (): PlannerDocument => {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'plan-area-in-room.json'), 'utf8')) as {
      input: PlannerDocument;
    };
    return loaded(fixture.input);
  };

  const opened = (initial: PlannerDocument, prefix: string): PlannerDocument =>
    new PlannerStore(createPlannerBus(), initial, { createId: createSequentialIds(prefix) }).getDocument();

  it('начальный документ: id новых записей — из генератора, `uuidv7` в снимке нет', () => {
    const snapshot = opened(document(), 'n');
    const layout = snapshot.floors[0]!.layout;
    // Контуры, пол и рез пересобраны — их id новые; запись комнаты `r1` в фикстуре уже есть и переживает
    // пересборку по якорю, поэтому её id остаётся прежним (ADR 0016 B3).
    expect(layout.contours.map(contour => contour.id)).toEqual(['n1', 'n2']);
    expect(layout.covers.map(cover => cover.id)).toEqual([expect.stringMatching(/^n\d+$/)]);
    expect(layout.rooms.map(room => room.id)).toEqual(['r1']);
    expect(serialize(snapshot)).not.toMatch(UUID);
    expect(opened(document(), 'n')).toEqual(snapshot);
  });

  /** `document.load` — второй вход того же пути (открытие проекта поверх уже поднятого движка, ADR 0018 D3). */
  const reopened = (prefix: string): PlannerDocument => {
    const store = new PlannerStore(createPlannerBus(), document(), { createId: createSequentialIds(prefix) });
    store.load(document());
    return store.getDocument();
  };

  it('`load`: тот же генератор, тот же снимок', () => {
    const snapshot = reopened('n');
    expect(serialize(snapshot)).not.toMatch(UUID);
    // Счётчик у стора один на жизнь экземпляра, поэтому id второй пересборки — продолжение той же
    // последовательности (`n5…`), а не повтор `n1…`; воспроизводимость от этого не страдает.
    expect(reopened('n')).toEqual(snapshot);
    expect(snapshot.floors[0]!.layout.contours.map(contour => contour.id)).toEqual(['n5', 'n6']);
  });
});
