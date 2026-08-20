import { z } from 'zod';

import {
  CONTOUR_KINDS,
  createDefaultCamera,
  createDefaultView,
  DEFAULT_WALL_HEIGHT,
  SCENE_ITEM_KINDS,
  UNITS,
  VIEW_KINDS,
  type PlannerDocument,
} from '../document/PlannerDocument';
import { quantize } from '../document/quantize';
import { DOCUMENT_FORMAT } from './version';

/**
 * Zod-схема конверта сейва — единственный источник правды о формате (ADR 0021, «Конверт и схема»).
 * Импортируется и клиентом, и сервером, поэтому в модуле нет ничего, кроме схемы: ни Three, ни движка.
 *
 * **Каждый объект — `looseObject`, и это несущая деталь, а не стиль.** Zod по умолчанию срезает
 * неизвестные ключи; при таком поведении старый бандл, открыв документ, записанный более новым, молча
 * обстругал бы его до своей формы — а добавление необязательного поля версию формата **не двигает**
 * (иначе цепочка миграций забьётся пустыми шагами уже на шагах 5–7). Проброс покрыт отдельным тестом
 * (`forwardCompat.test.ts`); менять `looseObject` на `object` — значит тихо сломать forward-compat.
 *
 * Отсутствующие косметические поля, наоборот, дефолтятся (спека 10: «неизвестные/новые версии пытаются
 * открыться в режиме совместимости»).
 */

/**
 * Выход `looseObject` — форма плюс индексная сигнатура для незнакомых ключей, а типы документа объявлены
 * интерфейсами, у которых неявной индексной сигнатуры нет. Хелпер переводит интерфейс в структурно
 * идентичный анонимный тип, чтобы дефолты можно было брать из `document/PlannerDocument` (один источник
 * правды для дефолтных камер), а не переписывать те же числа литералами рядом со схемой.
 */
type Loose<T> = T extends object ? { [K in keyof T]: Loose<T[K]> } & { [key: string]: unknown } : T;
const loose = <T>(value: T): Loose<T> => value as Loose<T>;

/** Конечное число: `NaN`/`±Infinity` в документе запрещены (ADR 0016 B5). */
const finite = z.number().refine(Number.isFinite, { message: 'ожидалось конечное число' });

/**
 * Координата плана. Здесь и только здесь квантуется путь загрузки: до задачи 0079 это был единственный
 * вход документа без квантования (парковка build-order, «(шаг 3, из разведки 2026-08-20 → ADR F)»),
 * а неквантованный вход ломает идемпотентность `normalize` тем же механизмом, что дефект задачи 0073.
 */
const coordinate = finite.transform(quantize);

/** Углы, зумы и высоты координатами не являются: сетка 0.001 см к ним не относится. */
const planPosition = z.looseObject({ x: coordinate, y: coordinate });

const id = z.string();

const point = z.looseObject({ id, x: coordinate, y: coordinate });

const contour = z.looseObject({ id, kind: z.enum(CONTOUR_KINDS), points: z.array(id) });

const cover = z.looseObject({
  id,
  kind: z.enum(CONTOUR_KINDS),
  points: z.array(id),
  ceilingHidden: z.boolean().default(false),
});

const area = z.looseObject({ id, points: z.array(id), height: finite });

const cut = z.looseObject({ id, a: id, b: id });

const room = z.looseObject({
  id,
  anchor: z.array(id),
  name: z.string().default(''),
  ceilingHeight: finite.default(DEFAULT_WALL_HEIGHT),
});

const layout = z
  .looseObject({
    points: z.record(id, point).default({}),
    contours: z.array(contour).default([]),
    covers: z.array(cover).default([]),
    areas: z.array(area).default([]),
    cuts: z.array(cut).default([]),
    rooms: z.array(room).default([]),
  })
  .default(() => ({ points: {}, contours: [], covers: [], areas: [], cuts: [], rooms: [] }));

const sceneItem = z.looseObject({
  id,
  kind: z.enum(SCENE_ITEM_KINDS),
  catalogId: z.string(),
  x: coordinate,
  y: coordinate,
  elevation: coordinate.default(0),
  rotation: finite.default(0),
});

const ruler = z.looseObject({ id, a: planPosition, b: planPosition });

const scene = z
  .looseObject({
    items: z.array(sceneItem).default([]),
    rulers: z.array(ruler).default([]),
    hidden: z.array(id).default([]),
  })
  .default(() => ({ items: [], rulers: [], hidden: [] }));

const floor = z.looseObject({ id, layout, scene });

/**
 * Камеры видов сохраняются: проект открывается в том ракурсе, в каком закрыт (ADR 0021). Камеры
 * конструктора в конверте нет — она в документ не пишется (ADR 0020).
 */
const cameras = z
  .looseObject({
    plan: z.looseObject({ x: finite, y: finite, zoom: finite }).default(() => loose(createDefaultCamera('plan'))),
    orbit: z
      .looseObject({ x: finite, y: finite, elevation: finite, pan: finite, tilt: finite, zoom: finite })
      .default(() => loose(createDefaultCamera('orbit'))),
    walk: z
      .looseObject({ x: finite, y: finite, pan: finite, tilt: finite })
      .default(() => loose(createDefaultCamera('walk'))),
  })
  .default(() => loose(createDefaultView().cameras));

const view = z
  .looseObject({ activeView: z.enum(VIEW_KINDS).default('constructor'), cameras })
  .default(() => loose(createDefaultView()));

const settings = z
  .looseObject({ units: z.enum(UNITS).default('cm'), wallHeight: finite.default(DEFAULT_WALL_HEIGHT) })
  .default(() => ({ units: 'cm' as const, wallHeight: DEFAULT_WALL_HEIGHT }));

/**
 * Конверт целиком. Метаданных проекта (`name`, даты) здесь нет — это колонки `projects`. Подложки
 * растрового плана здесь тоже нет: конверт её не несёт, поле зарезервировано, лимит размера считается
 * по документу без неё (ADR 0021; расхождение со спекой 11 осознанное и живёт до шага 10).
 */
export const documentSchema = z.looseObject({
  format: z.literal(DOCUMENT_FORMAT),
  version: z.int().min(1),
  settings,
  view,
  floors: z.array(floor),
});

/**
 * Схема обязана описывать ровно ту форму, что объявлена в `document/PlannerDocument.ts`: разъезд между
 * ними — это два источника правды о формате. Проверка компилятором, а не тестом, — она нужна на каждой
 * правке схемы, а не на прогоне.
 */
type SchemaOutput = z.infer<typeof documentSchema>;
const _schemaMatchesDocument = (value: SchemaOutput): PlannerDocument => value;
void _schemaMatchesDocument;
