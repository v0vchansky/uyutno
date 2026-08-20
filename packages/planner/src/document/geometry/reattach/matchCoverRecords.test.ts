import type { PlanPosition } from '../../PlannerDocument';
import type { AnchoredRecord } from './matchAnchoredRecords';
import { type DetectedCover, matchCoverRecords } from './matchCoverRecords';

const p = (x: number, y: number): PlanPosition => ({ x, y });
const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  p(x0, y0),
  p(x1, y0),
  p(x1, y1),
  p(x0, y1),
];
const record = (anchorIds: string[], anchor: PlanPosition[]): AnchoredRecord => ({ anchorIds, anchor });
const cover = (ids: string[], outline: PlanPosition[]): DetectedCover => ({ ids, outline });

/** Два пола бок о бок в одной комнате: паркет слева (a-d), плитка справа (e-h). */
const PARQUET = record(['a', 'b', 'c', 'd'], rect(10, 10, 200, 290));
const TILE = record(['e', 'f', 'g', 'h'], rect(200, 10, 390, 290));

describe('matchCoverRecords', () => {
  it('ужатый пол наследует данные своего старого пола по перекрытию площади', () => {
    expect(matchCoverRecords([PARQUET, TILE], [cover(['q', 'r', 's', 't'], rect(210, 10, 390, 290))])).toEqual([1]);
  });

  it('пересборка без изменений идемпотентна: точное совпадение цикла id раньше теста по площади', () => {
    // Обвод лежит внутри паркета, но id — циклический сдвиг id плитки: побеждает плитка.
    expect(matchCoverRecords([PARQUET, TILE], [cover(['c', 'd', 'a', 'b'], rect(10, 10, 200, 290))])).toEqual([0]);
    expect(matchCoverRecords([PARQUET, TILE], [cover(['g', 'h', 'e', 'f'], rect(20, 20, 100, 100))])).toEqual([1]);
  });

  it('пол, разрезанный новой перегородкой, отдаёт свои данные обоим кускам (донор не расходуется)', () => {
    expect(
      matchCoverRecords(
        [PARQUET],
        [cover(['q', 'r', 's', 't'], rect(10, 10, 90, 290)), cover(['u', 'v', 'w', 'x'], rect(110, 10, 200, 290))],
      ),
    ).toEqual([0, 0]);
  });

  it('слияние двух полов в один: донор — первый по порядку обхода полов (флаг «скрыть потолок» берётся от него)', () => {
    const merged = cover(['q', 'r', 's', 't'], rect(10, 10, 390, 290));
    expect(matchCoverRecords([PARQUET, TILE], [merged])).toEqual([0]);
    // Донор — всегда индекс 0, но сущность за ним разная: порядок обхода полов и есть порядок `records`.
    expect(matchCoverRecords([TILE, PARQUET], [merged])).toEqual([0]);
  });

  it('новый пол на пустом месте донора не находит — null (дефолтный материал ставит стадия пересборки)', () => {
    expect(matchCoverRecords([PARQUET, TILE], [cover(['q', 'r', 's', 't'], rect(500, 500, 600, 600))])).toEqual([null]);
  });

  it('старый пол, ни с одним новым не пересёкшийся, донором не становится (его данные уходят)', () => {
    const records = [PARQUET, TILE];
    const donors = matchCoverRecords(records, [cover(['q', 'r', 's', 't'], rect(210, 10, 390, 290))]);
    expect(donors).toEqual([1]);
    // Записи, не ставшие донорами, — сироты: паркет (индекс 0) остался без нового пола.
    const orphans = records.map((_, index) => index).filter(index => !donors.includes(index));
    expect(orphans).toEqual([0]);
  });

  it('якорь короче 3 точек донором быть не может', () => {
    const short = record(['a', 'b'], [p(10, 10), p(200, 10)]);
    expect(matchCoverRecords([short], [cover(['q', 'r', 's', 't'], rect(10, 10, 200, 290))])).toEqual([null]);
  });

  it('пустые входы: нет записей — все null; нет полов — пустой результат', () => {
    expect(matchCoverRecords([], [cover(['q', 'r', 's', 't'], rect(10, 10, 200, 290))])).toEqual([null]);
    expect(matchCoverRecords([PARQUET], [])).toEqual([]);
  });

  it('вырожденный пол (пустой обвод без id) донора не получает', () => {
    expect(matchCoverRecords([PARQUET], [cover([], [])])).toEqual([null]);
  });
});
