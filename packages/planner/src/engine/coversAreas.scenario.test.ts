import type { Id } from '../document/id';
import type { FloorLayout, PlanPosition } from '../document/PlannerDocument';
import type { PlannerManager } from './PlannerManager';
import type { DerivedFloor } from './rebuild';
import { createTestManager, rectContour, ringContours } from './testing/testManager';

/**
 * Сценарии спеки 02 «Комнаты, полы, потолки» и «Зоны (Areas)» целиком через фасад — слой 2 стратегии тестов
 * (задача 0072): команды зовутся так же, как их зовёт интерфейс, но интерфейса тут нет. Отдельные ветки
 * каждой команды (валидация, коалесинг, события) проверяются в `commands/*.test.ts`; здесь — сквозные цепочки,
 * где важен результат **связки** «команда → normalize → rebuild», который по одной команде не виден:
 * авто-пол приходит сам, зона укорачивает стены, правка стен уносит зону, а undo возвращает всё вместе с
 * тем, чего пользователь не рисовал (снимок берётся после `normalize` — ADR 0018 D3).
 */

const layoutOf = (manager: PlannerManager): FloorLayout => manager.document.get().floors[0]!.layout;
const derivedOf = (manager: PlannerManager): DerivedFloor => manager.document.getDerived().floors[0]!;

/** Координаты точек по их id — `'x,y'`, чтобы читать обводы глазами (id генерятся uuidv7 и в тесте бесполезны). */
const at = (manager: PlannerManager, ids: readonly Id[]): string[] => {
  const layout = layoutOf(manager);
  return ids.map(id => {
    const point = layout.points[id]!;
    return `${point.x},${point.y}`;
  });
};

/** Id точки этажа по координате — так тест адресует углы комнаты, не зная сгенерированных id. */
const pointAt = (manager: PlannerManager, x: number, y: number): Id => {
  const found = Object.values(layoutOf(manager).points).find(point => point.x === x && point.y === y);
  expect(found).toBeDefined();
  return found!.id;
};

const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Комната 400×300 (стены толщиной 10) в чистом документе — коммит инструмента «Стены» одной командой. */
const drawRoom = (): ReturnType<typeof createTestManager> => {
  const tm = createTestManager();
  expect(tm.manager.document.addContours(tm.floorId, ringContours(0, 0, 400, 300, 10)).ok).toBe(true);
  return tm;
};

/** Та же комната, разделённая надвое перегородкой `x ∈ [195, 205]`: две комнаты, два авто-пола. */
const drawSplitRoom = (): ReturnType<typeof createTestManager> => {
  const tm = drawRoom();
  expect(tm.manager.document.addContours(tm.floorId, [rectContour(195, 10, 205, 290)]).ok).toBe(true);
  return tm;
};

/** Зона в левой комнате: два ребра лягут по стенам (наружной и перегородке), диагональ — через интерьер. */
const addLeftArea = (tm: ReturnType<typeof createTestManager>): void => {
  const result = tm.manager.document.addArea(
    tm.floorId,
    [
      { x: 10, y: 10 },
      { x: 195, y: 10 },
      { x: 195, y: 290 },
    ],
    120,
  );
  expect(result).toEqual({ ok: true, value: undefined });
};

/**
 * Перегородку придвинули вплотную к левой стене (драг на `pointerUp` — одна команда на четыре точки):
 * левая комната исчезает, а углы, на которых сидела зона, уходят в толщу стены.
 */
const retractPartition = (tm: ReturnType<typeof createTestManager>): void => {
  const moves = (
    [
      [195, 10, 10],
      [205, 10, 20],
      [205, 290, 20],
      [195, 290, 10],
    ] as const
  ).map(([x, y, to]) => ({ id: pointAt(tm.manager, x, y), x: to, y }));
  expect(tm.manager.document.movePoints(tm.floorId, moves).ok).toBe(true);
};

describe('сценарии спеки 02 через фасад (слой 2, без интерфейса)', () => {
  it('нарисовать комнату → авто-пол и потолок появились сами, точками самой комнаты', () => {
    const tm = createTestManager();
    expect(layoutOf(tm.manager).covers).toEqual([]);
    expect(derivedOf(tm.manager).covers).toEqual([]);

    expect(tm.manager.document.addContours(tm.floorId, ringContours(0, 0, 400, 300, 10)).ok).toBe(true);

    const layout = layoutOf(tm.manager);
    expect(layout.covers).toHaveLength(1);
    const [cover] = layout.covers;
    expect(cover!.kind).toBe('outer');
    expect(cover!.ceilingHidden).toBe(false);
    expect(at(tm.manager, cover!.points)).toEqual(['10,10', '390,10', '390,290', '10,290']);
    // Своих точек у авто-пола нет: он ссылается на углы комнаты (ADR 0016 B4).
    const room = layout.contours.find(contour => contour.kind === 'inner')!;
    expect([...cover!.points].sort()).toEqual([...room.points].sort());

    const derived = derivedOf(tm.manager);
    expect(derived.covers.map(entry => entry.area)).toEqual([380 * 280]);
    expect(derived.covers[0]!.roomId).toBe(layout.rooms[0]!.id);
    // Потолок — ссылкой на пол, высота с комнаты (по умолчанию — высота стен проекта).
    expect(derived.ceilings).toEqual([{ coverId: cover!.id, height: 280, hidden: false }]);
  });

  it('добавить ручной пол: внутри комнаты он сливается с авто-полом, вырез добавляет вторую запись', () => {
    const tm = drawRoom();
    const auto = layoutOf(tm.manager).covers[0]!;

    // Пол внутри уже застеленной комнаты: состав не меняется — слияние по касанию делает `normalize`.
    expect(tm.manager.document.addCover(tm.floorId, rect(100, 100, 300, 200)).ok).toBe(true);
    expect(layoutOf(tm.manager).covers).toHaveLength(1);
    expect(derivedOf(tm.manager).covers.map(entry => entry.area)).toEqual([380 * 280]);
    // Цикл точек пола не изменился — запись пережила пересборку своим id.
    expect(layoutOf(tm.manager).covers[0]!.id).toBe(auto.id);

    // Пол-вычитание: вторая запись, дырка достаётся полу-хозяину, потолок остаётся один и повторяет форму.
    expect(tm.manager.document.addCover(tm.floorId, rect(150, 120, 250, 180), { kind: 'inner' }).ok).toBe(true);
    const layout = layoutOf(tm.manager);
    expect(layout.covers.map(cover => cover.kind)).toEqual(['outer', 'inner']);
    expect(at(tm.manager, layout.covers[1]!.points).sort()).toEqual(
      ['150,120', '150,180', '250,120', '250,180'].sort(),
    );
    const derived = derivedOf(tm.manager);
    expect(derived.covers).toHaveLength(1);
    expect(derived.covers[0]!.holes).toHaveLength(1);
    expect(derived.covers[0]!.area).toBe(380 * 280 - 100 * 60);
    expect(derived.ceilings.map(ceiling => ceiling.coverId)).toEqual([derived.covers[0]!.coverId]);
  });

  it('добавить зону: появились cuts, а грани под её рёбрами укоротились и потеряли верхний плинтус', () => {
    const tm = drawRoom();
    const before = derivedOf(tm.manager);
    expect(before.faces.map(face => face.top)).toEqual([280, 280, 280, 280]);
    expect(before.skirtings).toHaveLength(8);

    const result = tm.manager.document.addArea(
      tm.floorId,
      [
        { x: 10, y: 10 },
        { x: 390, y: 10 },
        { x: 390, y: 290 },
      ],
      100,
    );
    expect(result).toEqual({ ok: true, value: undefined });

    const layout = layoutOf(tm.manager);
    expect(layout.areas).toHaveLength(1);
    // Опора: вершины зоны — те же id, что углы комнаты; новых точек команда не завела.
    expect(at(tm.manager, layout.areas[0]!.points)).toEqual(['10,10', '390,10', '390,290']);
    expect(Object.keys(layout.points)).toHaveLength(8);
    // Два ребра зоны легли по стенам (записи не дают), диагональ идёт через интерьер — одна запись `cuts[]`.
    expect(layout.cuts).toHaveLength(1);
    expect(at(tm.manager, [layout.cuts[0]!.a, layout.cuts[0]!.b]).sort()).toEqual(['10,10', '390,290'].sort());

    const derived = derivedOf(tm.manager);
    expect(derived.areas.map(area => area.height)).toEqual([100]);
    expect(derived.cuts.map(cut => [cut.low, cut.height])).toEqual([[100, 280]]);
    // Стены, совпавшие с рёбрами зоны, укоротились до 100 и остались без верхнего плинтуса; остальные целы.
    expect(derived.faces.map(face => [at(tm.manager, [face.a, face.b]).join('→'), face.top, face.underArea])).toEqual([
      ['10,10→390,10', 100, true],
      ['390,10→390,290', 100, true],
      ['390,290→10,290', 280, false],
      ['10,290→10,10', 280, false],
    ]);
    expect(derived.skirtings).toHaveLength(6);
    expect(derived.skirtings.filter(skirting => skirting.kind === 'top')).toHaveLength(2);
  });

  it('подвинуть стену так, что зона осталась без опоры → зона исчезла вместе со своими cuts', () => {
    const tm = drawSplitRoom();
    expect(layoutOf(tm.manager).covers).toHaveLength(2);

    addLeftArea(tm);
    expect(layoutOf(tm.manager).areas).toHaveLength(1);
    expect(layoutOf(tm.manager).cuts).toHaveLength(1);

    // Опоры у зоны больше нет — она отбраковывается целиком (фаза (3) `normalize`, спека 02 «Зоны»),
    // а её вертикальные грани снимаются следом: `cuts[]` без живой зоны-владельца не существует.
    retractPartition(tm);

    const layout = layoutOf(tm.manager);
    expect(layout.areas).toEqual([]);
    expect(layout.cuts).toEqual([]);
    // Осталась одна комната (левая ушла в стену), и её пол снова один на всю площадь.
    expect(layout.contours.filter(contour => contour.kind === 'inner')).toHaveLength(1);
    expect(layout.covers).toHaveLength(1);
    expect(at(tm.manager, layout.covers[0]!.points)).toEqual(['20,10', '390,10', '390,290', '20,290']);
    const derived = derivedOf(tm.manager);
    expect(derived.areas).toEqual([]);
    expect(derived.cuts).toEqual([]);
    expect(derived.faces.every(face => face.top === 280 && !face.underArea)).toBe(true);
  });

  it('undo возвращает зону, cuts и авто-полы разом (снимок берётся после normalize), redo — уносит', () => {
    const tm = drawSplitRoom();
    addLeftArea(tm);
    const withArea = tm.manager.document.get();
    retractPartition(tm);
    const moved = tm.manager.document.get();

    expect(tm.manager.history.undo()).toEqual({ ok: true, value: undefined });
    // Снимок писался после `normalize`, поэтому в нём и зона с вырезом, и авто-полы, которых никто не рисовал.
    expect(tm.manager.document.get()).toEqual(withArea);
    expect(layoutOf(tm.manager).areas).toHaveLength(1);
    expect(layoutOf(tm.manager).cuts).toHaveLength(1);
    expect(layoutOf(tm.manager).covers).toHaveLength(2);
    expect(derivedOf(tm.manager).cuts.map(cut => [cut.low, cut.height])).toEqual([[120, 280]]);

    expect(tm.manager.history.redo()).toEqual({ ok: true, value: undefined });
    expect(tm.manager.document.get()).toEqual(moved);
    expect(layoutOf(tm.manager).areas).toEqual([]);
    expect(layoutOf(tm.manager).cuts).toEqual([]);

    // Откат до чистого листа: комната, перегородка и зона снимаются по одной записи, полов не остаётся.
    while (tm.manager.history.get().canUndo) tm.manager.history.undo();
    expect(layoutOf(tm.manager).contours).toEqual([]);
    expect(layoutOf(tm.manager).covers).toEqual([]);
    expect(derivedOf(tm.manager).ceilings).toEqual([]);
  });
});
