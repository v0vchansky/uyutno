import type { PlanPosition } from '../../PlannerDocument';
import { type AnchoredRecord, type DetectedRoom, matchRoomRecords } from './matchRoomRecords';

const p = (x: number, y: number): PlanPosition => ({ x, y });
const square = (x0: number, y0: number, s: number): PlanPosition[] => [
  p(x0, y0),
  p(x0 + s, y0),
  p(x0 + s, y0 + s),
  p(x0, y0 + s),
];
const record = (anchorIds: string[], anchor: PlanPosition[]): AnchoredRecord => ({ anchorIds, anchor });
const room = (ids: string[], outline: PlanPosition[]): DetectedRoom => ({ ids, outline });

/** R0 — квадрат 0..100 с id a-b-c-d; R1 — квадрат 200..300 с id e-f-g-h. */
const R0 = record(['a', 'b', 'c', 'd'], square(0, 0, 100));
const R1 = record(['e', 'f', 'g', 'h'], square(200, 0, 100));

describe('matchRoomRecords', () => {
  it('точное циклическое совпадение id побеждает, даже если более ранняя запись пересекается по площади', () => {
    // Обвод комнаты лежит внутри R0, но id — сдвиг id R1.
    expect(matchRoomRecords([R0, R1], [room(['g', 'h', 'e', 'f'], square(10, 10, 80))])).toEqual([1]);
  });

  it('точное совпадение работает и для обратного порядка id', () => {
    expect(matchRoomRecords([R0, R1], [room(['h', 'g', 'f', 'e'], square(10, 10, 80))])).toEqual([1]);
  });

  it('иначе — первая по порядку записей запись, пересекающаяся по площади', () => {
    expect(matchRoomRecords([R0, R1], [room(['q', 'r', 's', 't'], square(10, 10, 80))])).toEqual([0]);
    expect(matchRoomRecords([R0, R1], [room(['q', 'r', 's', 't'], square(250, 10, 30))])).toEqual([1]);
  });

  it('две записи пересекаются с комнатой — берётся первая в records', () => {
    const R0dup = record(['i', 'j', 'k', 'l'], square(0, 0, 100));
    expect(matchRoomRecords([R0dup, R0], [room(['q', 'r', 's', 't'], square(10, 10, 80))])).toEqual([0]);
    expect(matchRoomRecords([R0, R0dup], [room(['q', 'r', 's', 't'], square(10, 10, 80))])).toEqual([0]);
  });

  it('пересечения нет → null', () => {
    expect(matchRoomRecords([R0, R1], [room(['q', 'r', 's', 't'], square(500, 500, 50))])).toEqual([null]);
  });

  it('частичное совпадение id (не весь цикл) — не точное: решает площадь', () => {
    // Те же id, но на один больше — не тот же цикл; обвод в R1 → 1.
    expect(matchRoomRecords([R0, R1], [room(['a', 'b', 'c', 'd', 'x'], square(210, 10, 80))])).toEqual([1]);
  });

  it('якорь короче 3 точек донором по площади не становится', () => {
    const shortAnchor = record(['a', 'b'], [p(0, 0), p(100, 0)]);
    const twoPointAnchorFullIds = record(['a', 'b', 'c', 'd'], [p(0, 0), p(100, 100)]);
    expect(
      matchRoomRecords([shortAnchor, twoPointAnchorFullIds], [room(['q', 'r', 's', 't'], square(0, 0, 100))]),
    ).toEqual([null]);
  });

  it('якорь короче 3 живых точек не донор даже при циклическом совпадении id; усечённый якорь с полным списком id — донор', () => {
    const shortAnchor = record(['a', 'b'], [p(0, 0), p(100, 0)]);
    expect(matchRoomRecords([shortAnchor], [room(['b', 'a'], square(0, 0, 100))])).toEqual([null]);
    // Список id ≥ 3 при усечённом якоре (пропавшие точки) — точное совпадение по id срабатывает.
    const truncated = record(['a', 'b', 'c', 'd'], [p(0, 0), p(100, 100)]);
    expect(matchRoomRecords([truncated], [room(['c', 'd', 'a', 'b'], square(500, 500, 10))])).toEqual([0]);
  });

  it('один донор на две половинки разделённой комнаты — тот же индекс дважды', () => {
    const left = room(['q', 'r', 's', 't'], [p(0, 0), p(50, 0), p(50, 100), p(0, 100)]);
    const right = room(['u', 'v', 'w', 'x'], [p(50, 0), p(100, 0), p(100, 100), p(50, 100)]);
    expect(matchRoomRecords([R0], [left, right])).toEqual([0, 0]);
  });

  it('пустые records → все null; пустые rooms → []', () => {
    expect(matchRoomRecords([], [room(['a', 'b', 'c', 'd'], square(0, 0, 100)), room(['x'], [])])).toEqual([
      null,
      null,
    ]);
    expect(matchRoomRecords([R0], [])).toEqual([]);
  });

  it('пустой обвод комнаты без совпадения id → null', () => {
    expect(matchRoomRecords([R0], [room([], [])])).toEqual([null]);
  });

  it('обвод касается якоря только границей (соседняя комната) → нет пересечения по площади', () => {
    expect(matchRoomRecords([R0], [room(['q', 'r', 's', 't'], square(100, 0, 100))])).toEqual([null]);
  });
});
