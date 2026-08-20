import type { Id } from '../id';
import {
  type ContourKind,
  createDefaultView,
  DEFAULT_WALL_HEIGHT,
  DOCUMENT_FORMAT,
  DOCUMENT_VERSION,
  type PlannerDocument,
} from '../PlannerDocument';

/** Детерминированный генератор id для фикстур и тестов: `p1, p2, …` (ADR 0017 C10). */
export const createSequentialIds = (prefix: string): (() => Id) => {
  let counter = 0;
  return () => `${prefix}${++counter}`;
};

/**
 * Билдер документов для тестов ядра: один этаж `f1`, точки `p*`, контуры `c*`, записи комнат `r*`,
 * полы `cv*`, зоны `ar*`.
 * Точки с одинаковыми координатами **не** сливаются автоматически — вызывающий сам переиспользует id
 * (так строятся квады ленты с общими вершинами, ADR 0017 C1).
 */
export interface PlanBuilder {
  point(x: number, y: number): Id;
  contour(kind: ContourKind, points: readonly Id[]): Id;
  /** Прямоугольный `outer`-квад по углам `(x0, y0)–(x1, y1)`; вершины — новые точки. */
  rect(kind: ContourKind, x0: number, y0: number, x1: number, y1: number): Id;
  /**
   * Замкнутое кольцо стен толщиной `width` вокруг прямоугольника — 4 митрованных квада с общими вершинами,
   * как коммитит инструмент «Стены». Возвращает id угловых точек: внешние `outer[4]`, внутренние `inner[4]`
   * в порядке (x0,y0) → (x1,y0) → (x1,y1) → (x0,y1).
   */
  ring(x0: number, y0: number, x1: number, y1: number, width: number): { outer: Id[]; inner: Id[]; contours: Id[] };
  room(anchor: readonly Id[], name?: string, ceilingHeight?: number): Id;
  /** Хранимый пол (`cv*`): `outer` — пол, `inner` — пол-вычитание (дырка); `ceilingHidden` по умолчанию `false`. */
  cover(kind: ContourKind, points: readonly Id[], opts?: { ceilingHidden?: boolean }): Id;
  /** Хранимая зона (`ar*`) с высотой в см. */
  area(points: readonly Id[], height: number): Id;
  document(): PlannerDocument;
}

export const createPlanBuilder = (): PlanBuilder => {
  const nextPoint = createSequentialIds('p');
  const nextContour = createSequentialIds('c');
  const nextRoom = createSequentialIds('r');
  const nextCover = createSequentialIds('cv');
  const nextArea = createSequentialIds('ar');
  const doc: PlannerDocument = {
    format: DOCUMENT_FORMAT,
    version: DOCUMENT_VERSION,
    settings: { units: 'cm', wallHeight: DEFAULT_WALL_HEIGHT },
    view: createDefaultView(),
    floors: [
      {
        id: 'f1',
        layout: { points: {}, contours: [], covers: [], areas: [], cuts: [], rooms: [] },
        scene: { items: [], rulers: [], hidden: [] },
      },
    ],
  };
  const layout = doc.floors[0]!.layout;

  const builder: PlanBuilder = {
    point(x, y) {
      const id = nextPoint();
      layout.points[id] = { id, x, y };
      return id;
    },
    contour(kind, points) {
      const id = nextContour();
      layout.contours.push({ id, kind, points: [...points] });
      return id;
    },
    rect(kind, x0, y0, x1, y1) {
      return builder.contour(kind, [
        builder.point(x0, y0),
        builder.point(x1, y0),
        builder.point(x1, y1),
        builder.point(x0, y1),
      ]);
    },
    ring(x0, y0, x1, y1, width) {
      const outer = [builder.point(x0, y0), builder.point(x1, y0), builder.point(x1, y1), builder.point(x0, y1)];
      const inner = [
        builder.point(x0 + width, y0 + width),
        builder.point(x1 - width, y0 + width),
        builder.point(x1 - width, y1 - width),
        builder.point(x0 + width, y1 - width),
      ];
      const contours: Id[] = [];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        contours.push(builder.contour('outer', [outer[i]!, outer[j]!, inner[j]!, inner[i]!]));
      }
      return { outer, inner, contours };
    },
    room(anchor, name = '', ceilingHeight = DEFAULT_WALL_HEIGHT) {
      const id = nextRoom();
      layout.rooms.push({ id, anchor: [...anchor], name, ceilingHeight });
      return id;
    },
    cover(kind, points, { ceilingHidden = false } = {}) {
      const id = nextCover();
      layout.covers.push({ id, kind, points: [...points], ceilingHidden });
      return id;
    },
    area(points, height) {
      const id = nextArea();
      layout.areas.push({ id, points: [...points], height });
      return id;
    },
    document: () => doc,
  };
  return builder;
};
