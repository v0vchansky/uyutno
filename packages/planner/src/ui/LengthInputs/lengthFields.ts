import type { FaceRef } from '../../document/geometry/axes/findAxes';
import { rectContours } from '../../document/geometry/contours/rectContours';
import {
  INPUT_MIN_SCREEN_LENGTH,
  LABEL_MIN_SCREEN_LENGTH,
  placeEdgeLabel,
  RECT_INPUT_MIN_SCREEN_LENGTH,
  ringOrientation,
  type EdgePlacement,
} from '../../document/geometry/measure/labelPlacement';
import { euclDist } from '../../document/geometry/predicates/distance';
import type { Viewport } from '../../document/geometry/viewport';
import type { Id } from '../../document/id';
import type { ContourKind, FloorLayout, PlanPosition } from '../../document/PlannerDocument';
import type { DerivedFloor } from '../../engine/rebuild';
import type { ToolState } from '../../engine/tools/ToolState';

/**
 * Сборка подписей и полей ввода длины текущего кадра — **чистая** функция от планировки, производного и
 * состояния автомата инструментов. Ни React, ни DOM: оверлей (`LengthInputsOverlay.tsx`) только рисует то,
 * что здесь собрано, и отправляет введённое в команды фасада.
 *
 * Правила — спека 07 «Автоматические размеры на стенах» / «Правка размера по клику», спека 01 «Ввод размеров
 * с клавиатуры», handoff `docs/ui/handoffs/planner/planner-editor-ui.md` («Поле ввода длины», «Подписи»),
 * ADR 0018 D1 (что делает каждая команда), ADR 0020 P2 (подписи — не канвас, а DOM-оверлей).
 */

/** Кольцо контура, которому принадлежит поле (решение 23): у сегмента их два — внешнее и внутреннее. */
export type FieldRing = 'outer' | 'inner';

/** С трёх вершин у контура появляется знак площади, а значит и сторона «наружу» (`contourArea`, ADR 0017 C4). */
const MIN_ORIENTED_POINTS = 3;

export type LengthFieldTarget =
  /** Живое ребро рисуемой ломаной/комнаты: Enter = постановка точки (`tools.commitPoint`). */
  | { kind: 'draw-current'; from: PlanPosition; towards: PlanPosition }
  /** Первое ребро рисуемого контура (спека 07: «двигать первую точку и отращивать контур с обратной стороны»). */
  | { kind: 'draw-first'; from: PlanPosition; towards: PlanPosition }
  /** Сторона живого прямоугольника: правит противоположный угол, Enter = `tools.commitPoint(угол)`. */
  | {
      kind: 'draw-rect';
      axis: 'x' | 'y';
      ring: FieldRing;
      origin: PlanPosition;
      cursor: PlanPosition;
      wallWidth: number;
    }
  /** Ребро контура документа: `document.setEdgeLength`. */
  | { kind: 'edge'; edge: { a: Id; b: Id }; anchor?: Id }
  /** Ширина выделенной стены: `document.setWallWidth`. */
  | { kind: 'wall-width'; faces: readonly [FaceRef, FaceRef] };

export interface LengthFieldDescriptor {
  /** Стабильный ключ: React-`key`, реестр черновиков и порядок Tab. */
  key: string;
  target: LengthFieldTarget;
  /** Текущее значение, см. */
  value: number;
  placement: EdgePlacement;
  /** Экранная длина ребра дошла до порога — поле редактируемое; иначе это статическая подпись. */
  editable: boolean;
  /** Ключ парного поля другого кольца (решение 24: пассивное пересчитывается на лету). */
  pairKey?: string;
  /** Когда значение уходит в команду: постановка точки — только Enter, правка длины — Enter/blur/Tab. */
  commitOn: 'enter' | 'enter-blur-tab';
  ariaLabel: string;
}

export interface LengthFieldsInput {
  layout: FloorLayout;
  derived: DerivedFloor | null;
  tools: ToolState;
  /** `DEFAULT_WALL_WIDTH` — офсет ленты при рисовании. */
  wallWidth: number;
}

/** Все подписи и поля длины текущего кадра в порядке обхода Tab. */
export const buildLengthFields = ({
  layout,
  derived,
  tools,
  wallWidth,
}: LengthFieldsInput): LengthFieldDescriptor[] => {
  switch (tools.kind) {
    case 'editing':
    case 'dragging-point':
    case 'dragging-wall': {
      // Позиции точек — с учётом live-драга: подписи обновляются на лету, без ретриангуляции (спека 07,
      // ADR 0020 P2; тот же приём, что `overridesOf`/`positionOf` в `projection/canvas2d/drawFrame.ts`).
      const overrides = tools.kind === 'editing' ? null : tools.pointOverrides;
      const selection = tools.selection;
      const fields = edgeFields(tools.viewport, layout, derived, overrides, {
        anchorFrom: tools.kind === 'editing' && selection?.kind === 'point' ? selection.id : null,
        interactive: true,
      });
      if (tools.kind === 'editing' && selection?.kind === 'wall') {
        const width = wallWidthField(tools.viewport, derived, selection.face);
        if (width) fields.push(width);
      }
      return fields;
    }
    case 'making-walls':
    case 'making-room': {
      // Лента «Стен» откладывается на сторону `side`, поэтому подпись уходит на противоположную; у «Комнаты
      // по точкам» ленты нет — подпись ложится наружу обхода (спека 07: «ориентируется относительно нужной
      // стороны стены»). Обход у неё может идти в любую сторону, поэтому знак берётся из самих точек, а не
      // фиксируется: иначе у контура по часовой подписи легли бы внутрь полигона.
      const orientation: 1 | -1 =
        tools.kind === 'making-walls'
          ? tools.side === 'left'
            ? 1
            : -1
          : tools.points.length >= MIN_ORIENTED_POINTS
            ? ringOrientation(tools.points)
            : 1;
      return [
        ...draftFields(tools.viewport, tools.points, tools.cursor, orientation),
        ...drawnLabels(tools.viewport, layout, derived),
      ];
    }
    case 'making-rect':
      return [
        ...rectFields(tools.viewport, tools.origin, tools.cursor, wallWidth),
        ...drawnLabels(tools.viewport, layout, derived),
      ];
  }
};

/**
 * Подписи уже построенной геометрии во время рисования. Автоматические размеры — свойство плана, а не режима:
 * спека 07 «Автоматические размеры на стенах» вешает подпись на **каждый** сегмент и гасит их только тумблером
 * «Размеры» и порогами видимости; handoff «Состояния экрана» → «Идёт рисование» перечисляет их наравне с
 * лентой и гайдами. Поэтому подписи остаются, но **редактируемыми не становятся**: Tab при рисовании обязан
 * ходить по полям рисуемого контура (спека 01 «Между инпутами разных рёбер работает Tab»), а не по десяткам
 * рёбер плана, и правка готового ребра — сценарий `editing` («Правка размера по клику»).
 */
const drawnLabels = (viewport: Viewport, layout: FloorLayout, derived: DerivedFloor | null): LengthFieldDescriptor[] =>
  edgeFields(viewport, layout, derived, null, { anchorFrom: null, interactive: false });

/**
 * Значение поля `key` после применения `pending` (см) к активному полю `activeKey` — «пассивное поле пары
 * пересчитывается на лету, пока печатают в активном» (handoff «Пара полей на сегменте», решение 24).
 *
 * Живой пересчёт виден только на паре прямоугольника: оба его кольца выводятся из одного угла, поэтому
 * внешняя сторона = внутренняя + 2 × ширины стены (сцены 13/14 прототипа). У **готового** контура рёбра
 * внешнего и внутреннего колец геометрически независимы — `setEdgeLength` двигает только точки своего
 * контура (ADR 0018 D1), соседнее кольцо остаётся на месте, — поэтому там пассивное поле показывает
 * собственное значение и до Enter не меняется.
 */
export const previewFieldValue = (
  fields: readonly LengthFieldDescriptor[],
  activeKey: string,
  pending: number,
  key: string,
): number => {
  if (key === activeKey) return pending;
  const queried = fields.find(field => field.key === key);
  if (!queried) return Number.NaN;
  const active = fields.find(field => field.key === activeKey);
  if (
    active &&
    active.target.kind === 'draw-rect' &&
    queried.target.kind === 'draw-rect' &&
    active.target.axis === queried.target.axis
  ) {
    const { wallWidth } = active.target;
    const outer = active.target.ring === 'outer' ? pending : pending + 2 * wallWidth;
    return queried.target.ring === 'outer' ? outer : outer - 2 * wallWidth;
  }
  return queried.value;
};

// ── Геометрия документа: рёбра контуров и ширина выделенной стены ────────────────────────────────────────

const edgeKey = (contourId: Id, a: Id, b: Id): string => `edge:${contourId}:${a}|${b}`;

const faceKey = (face: FaceRef): string => edgeKey(face.contourId, face.a, face.b);

/** Позиция точки документа с учётом live-драга. */
const positionOf = (
  layout: FloorLayout,
  overrides: Readonly<Record<Id, PlanPosition>> | null,
  id: Id,
): PlanPosition | null => overrides?.[id] ?? layout.points[id] ?? null;

/** Грань → противоположная грань той же оси стены (ADR 0017 C8): по ней ищется парное поле сегмента. */
const facePartners = (derived: DerivedFloor | null): Map<string, FaceRef> => {
  const partners = new Map<string, FaceRef>();
  for (const axis of derived?.axes ?? []) {
    partners.set(faceKey(axis.faces[0]), axis.faces[1]);
    partners.set(faceKey(axis.faces[1]), axis.faces[0]);
  }
  return partners;
};

/**
 * Куда сдвигать подпись от своего ребра. Обе подписи сегмента уходят **от тела стены**: у внешнего кольца это
 * наружу здания, у внутреннего — внутрь комнаты (сцена 13 прототипа: внешняя подпись над внешней гранью,
 * внутренняя — под внутренней). Если обе двигать «наружу своего кольца», они встают в ленту стены и на
 * `DEFAULT_WALL_WIDTH = 10` см налезают друг на друга при 100% зума; лента заодно остаётся свободной под поле
 * ширины стены.
 *
 * Внутренность кольца лежит слева от `a → b` при обходе против часовой (`ringOrientation`), поэтому «наружу» —
 * это сама ориентация, а «внутрь» — она же со сменой знака.
 */
const labelSide = (kind: ContourKind, orientation: 1 | -1): 1 | -1 =>
  kind === 'inner' ? (-orientation as 1 | -1) : orientation;

/** Заготовка поля ребра до расстановки пар: сам дескриптор плюс то, что нужно для `pairKey`/`aria-label`. */
interface EdgeEntry {
  field: LengthFieldDescriptor;
  contourKind: ContourKind;
  partner: FaceRef | null;
}

const edgeFields = (
  viewport: Viewport,
  layout: FloorLayout,
  derived: DerivedFloor | null,
  overrides: Readonly<Record<Id, PlanPosition>> | null,
  { anchorFrom, interactive }: { anchorFrom: Id | null; interactive: boolean },
): LengthFieldDescriptor[] => {
  const partners = facePartners(derived);
  const entries: EdgeEntry[] = [];

  for (const contour of layout.contours) {
    const ring = contour.points.map(id => positionOf(layout, overrides, id));
    // Точка пропала — документ и производное разъехались; контур пропускается целиком, как в `drawFrame`.
    if (ring.some(position => position === null)) continue;
    const positions = ring as PlanPosition[];
    const orientation = labelSide(contour.kind, ringOrientation(positions));

    for (let i = 0; i < contour.points.length; i++) {
      const next = (i + 1) % contour.points.length;
      const a = contour.points[i]!;
      const b = contour.points[next]!;
      const placement = placeEdgeLabel(viewport, positions[i]!, positions[next]!, orientation);
      // Сегмент короче порога — подписи нет вовсе (спека 07 «Ограничения и пороги»).
      if (placement.screenLength < LABEL_MIN_SCREEN_LENGTH) continue;

      // `anchor` — id **фиксированного** конца (ADR 0018 D1): выделена вершина ребра → вся дельта уходит на
      // другой конец (спека 07: «двигается только эта точка на полную дельту»).
      const anchor = anchorFrom === a ? b : anchorFrom === b ? a : null;
      entries.push({
        field: {
          key: edgeKey(contour.id, a, b),
          target: anchor === null ? { kind: 'edge', edge: { a, b } } : { kind: 'edge', edge: { a, b }, anchor },
          value: euclDist(positions[i]!, positions[next]!),
          placement,
          editable: interactive && placement.screenLength >= INPUT_MIN_SCREEN_LENGTH,
          commitOn: 'enter-blur-tab',
          ariaLabel: EDGE_LABEL.single,
        },
        contourKind: contour.kind,
        partner: partners.get(faceKey({ contourId: contour.id, a, b })) ?? null,
      });
    }
  }

  return orderedPairs(entries);
};

/** Тексты `aria-label` рёбер (handoff «Доступность»: «длина внешнего ребра»). */
const EDGE_LABEL = {
  single: 'длина ребра',
  outer: 'длина внешнего ребра',
  inner: 'длина внутреннего ребра',
} as const;

/**
 * Порядок обхода Tab и связка пар. Парное поле встаёт **сразу за своим** (handoff: «переключение делает Tab,
 * и оно ничем не отличается от Tab между полями соседних рёбер») — иначе с внешнего кольца Tab уводил бы на
 * соседнее ребро, а до внутреннего пришлось бы обойти весь контур. Порядок внутри пары — как в `contours[]`.
 *
 * `pairKey` проставляется только на **показанное** парное поле: ключ, за которым нет поля, ломал бы и
 * пассивную подсветку, и `previewFieldValue`. `aria-label` наоборот привязан к самой оси стены, а не к
 * видимости партнёра: иначе подпись «внешнее / внутреннее» мигала бы при зуме.
 */
const orderedPairs = (entries: readonly EdgeEntry[]): LengthFieldDescriptor[] => {
  const byKey = new Map(entries.map(entry => [entry.field.key, entry]));
  const emitted = new Set<string>();
  const result: LengthFieldDescriptor[] = [];

  const emit = (entry: EdgeEntry): void => {
    if (emitted.has(entry.field.key)) return;
    emitted.add(entry.field.key);
    const partnerKey = entry.partner === null ? null : faceKey(entry.partner);
    const pair = partnerKey === null ? undefined : byKey.get(partnerKey);
    result.push({
      ...entry.field,
      ...(pair ? { pairKey: pair.field.key } : {}),
      ariaLabel: entry.partner === null ? EDGE_LABEL.single : EDGE_LABEL[entry.contourKind],
    });
    if (pair) emit(pair);
  };

  for (const entry of entries) emit(entry);
  return result;
};

/**
 * Поле ширины выделенной стены (спека 07 «Правка размера по клику»: «выделена стена, редактируется толщина»).
 * Ось адресуется парой граней (ADR 0017 C8), `faces[0]` — сдвигаемая, то есть **выделенная** (ADR 0018 D1).
 *
 * Позицию handoff не задаёт (решение реализации, вынесено в Заметки 0060): середина оси с нулевым офсетом —
 * поле ложится внутрь тела стены, где подписей длин нет, и ни с одной из них не пересекается.
 */
const wallWidthField = (
  viewport: Viewport,
  derived: DerivedFloor | null,
  face: FaceRef,
): LengthFieldDescriptor | null => {
  const key = faceKey(face);
  const axis = derived?.axes.find(
    candidate => faceKey(candidate.faces[0]) === key || faceKey(candidate.faces[1]) === key,
  );
  if (!axis) return null;
  const opposite = faceKey(axis.faces[0]) === key ? axis.faces[1] : axis.faces[0];
  const placement = placeEdgeLabel(viewport, axis.a, axis.b, 1, 0);
  // Порог видимости — общий с подписями длин: на оси короче 30 px поле ввода не разместить (спека 07).
  if (placement.screenLength < LABEL_MIN_SCREEN_LENGTH) return null;
  return {
    key: `wall-width:${face.contourId}:${face.a}|${face.b}`,
    target: { kind: 'wall-width', faces: [face, opposite] },
    value: axis.depth,
    placement,
    editable: placement.screenLength >= INPUT_MIN_SCREEN_LENGTH,
    commitOn: 'enter-blur-tab',
    ariaLabel: 'ширина стены',
  };
};

// ── Рисование: ломаная/комната и прямоугольник ───────────────────────────────────────────────────────────

/**
 * Поля и подписи рисуемого контура. Длина показывается **над каждым ребром** (спека 01 «Ввод размеров с
 * клавиатуры»), но редактируются только два (спека 07 «Правка размера по клику»): живое ребро «последняя
 * точка → курсор» и — когда точек больше двух — первое ребро, которым двигают первую точку и отращивают
 * контур с обратной стороны. Так снимается расхождение двух разделов спеки: «каждое ребро» — про подписи,
 * «два инпута» — про правку.
 *
 * Редактируемые идут первыми: Tab по кругу ходит по ним, а не по подписям (спека 01 «Между инпутами разных
 * рёбер работает Tab»). Все размещаются по направлению обхода контура, чтобы подписи легли на одну сторону
 * ленты; куда поедет геометрия, задаёт `target.from`/`target.towards`, а не направление подписи.
 *
 * Ключи — константы: поле переживает постановку точки, и фокус в нём не теряется (спека 01: «Enter в инпуте
 * текущего ребра — это постановка точки», ставить точки подряд с клавиатуры).
 */
const draftFields = (
  viewport: Viewport,
  points: readonly PlanPosition[],
  cursor: PlanPosition | null,
  orientation: 1 | -1,
): LengthFieldDescriptor[] => {
  const fields: LengthFieldDescriptor[] = [];
  const last = points[points.length - 1];

  if (last && cursor) {
    const placement = placeEdgeLabel(viewport, last, cursor, orientation);
    if (placement.screenLength >= LABEL_MIN_SCREEN_LENGTH) {
      fields.push({
        key: 'draw:current',
        target: { kind: 'draw-current', from: last, towards: cursor },
        value: euclDist(last, cursor),
        placement,
        editable: placement.screenLength >= INPUT_MIN_SCREEN_LENGTH,
        commitOn: 'enter',
        ariaLabel: 'длина текущего ребра',
      });
    }
  }

  const first = points[0];
  const second = points[1];
  if (points.length > 2 && first && second) {
    const placement = placeEdgeLabel(viewport, first, second, orientation);
    if (placement.screenLength >= LABEL_MIN_SCREEN_LENGTH) {
      fields.push({
        key: 'draw:first',
        target: { kind: 'draw-first', from: second, towards: first },
        value: euclDist(first, second),
        placement,
        editable: placement.screenLength >= INPUT_MIN_SCREEN_LENGTH,
        commitOn: 'enter-blur-tab',
        ariaLabel: 'длина первого ребра',
      });
    }
  }

  /*
   * Уже поставленные рёбра контура — подписи (спека 01: «поверх каждого ребра отрисовывается его длина»).
   * Инпутами они не становятся: править можно последнюю точку и первую (спека 07 «Правка размера по клику»
   * перечисляет ровно эти два поля), а середина контура правится уже в `editing`. Первое ребро пропускается,
   * когда его занял `draw:first`, — двух подписей на одном ребре не бывает.
   */
  const firstTaken = fields.some(field => field.key === 'draw:first');
  for (let i = 0; i + 1 < points.length; i++) {
    if (i === 0 && firstTaken) continue;
    const placement = placeEdgeLabel(viewport, points[i]!, points[i + 1]!, orientation);
    if (placement.screenLength < LABEL_MIN_SCREEN_LENGTH) continue;
    fields.push({
      key: `draw:edge:${i}`,
      target: { kind: 'draw-first', from: points[i + 1]!, towards: points[i]! },
      value: euclDist(points[i]!, points[i + 1]!),
      placement,
      editable: false,
      commitOn: 'enter-blur-tab',
      ariaLabel: 'длина ребра',
    });
  }

  return fields;
};

/** `aria-label` сторон прямоугольника: на полой геометрии кольца надо различать (handoff «Доступность»). */
const RECT_LABEL: Readonly<Record<'x' | 'y', { solid: string; outer: string; inner: string }>> = {
  x: {
    solid: 'ширина прямоугольника',
    outer: 'внешняя ширина прямоугольника',
    inner: 'внутренняя ширина прямоугольника',
  },
  y: {
    solid: 'высота прямоугольника',
    outer: 'внешняя высота прямоугольника',
    inner: 'внутренняя высота прямоугольника',
  },
};

/**
 * Поля живого прямоугольника (спека 01 «Rectangle Room», спека 07: «сразу два инпута для ширины и высоты»;
 * на полой геометрии их четыре — по паре на ось, сцена 14 прототипа). Поле оси `x` садится на верхнее по
 * экрану горизонтальное ребро своего кольца, поле оси `y` — на левое вертикальное; офсет — наружу своего
 * кольца.
 *
 * Порог 70 px — общий на оба поля оси и считается по **ведущим** (внешним) сторонам: «пока хотя бы одна
 * короче — инпуты не показываются» (спека 01/07). Своя сторона короче 30 px — поля нет вовсе, как у подписи.
 */
const rectFields = (
  viewport: Viewport,
  origin: PlanPosition | null,
  cursor: PlanPosition | null,
  wallWidth: number,
): LengthFieldDescriptor[] => {
  if (!origin || !cursor) return [];
  const { outer, inner } = rectContours(origin, cursor, wallWidth);
  const editable =
    Math.abs(cursor.x - origin.x) * viewport.scale >= RECT_INPUT_MIN_SCREEN_LENGTH &&
    Math.abs(cursor.y - origin.y) * viewport.scale >= RECT_INPUT_MIN_SCREEN_LENGTH;

  const rings: { ring: FieldRing; corners: readonly [PlanPosition, PlanPosition, PlanPosition, PlanPosition] }[] = [
    { ring: 'outer', corners: outer },
  ];
  if (inner) rings.push({ ring: 'inner', corners: inner });

  const fields: LengthFieldDescriptor[] = [];
  const present = new Set<string>();
  for (const axis of ['x', 'y'] as const) {
    for (const { ring, corners } of rings) {
      // `rectContours` отдаёт углы против часовой при y вверх: [minX,minY], [maxX,minY], [maxX,maxY], [minX,maxY].
      // Верхнее по экрану ребро — `[2] → [3]` (y = maxY), левое — `[3] → [0]` (x = minX).
      const [a, b] = axis === 'x' ? [corners[2], corners[3]] : [corners[3], corners[0]];
      const placement = placeEdgeLabel(viewport, a, b, labelSide(ring, ringOrientation(corners)));
      if (placement.screenLength < LABEL_MIN_SCREEN_LENGTH) continue;
      const key = `rect:${axis}:${ring}`;
      present.add(key);
      fields.push({
        key,
        target: { kind: 'draw-rect', axis, ring, origin, cursor, wallWidth },
        value: euclDist(a, b),
        placement,
        editable,
        commitOn: 'enter',
        ariaLabel: inner ? RECT_LABEL[axis][ring] : RECT_LABEL[axis].solid,
      });
    }
  }

  return fields.map(field => {
    const target = field.target as Extract<LengthFieldTarget, { kind: 'draw-rect' }>;
    const pairKey = `rect:${target.axis}:${target.ring === 'outer' ? 'inner' : 'outer'}`;
    return present.has(pairKey) ? { ...field, pairKey } : field;
  });
};
