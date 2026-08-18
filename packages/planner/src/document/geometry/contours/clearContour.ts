import type { PlanPosition } from '../../PlannerDocument';
import { contourValid } from '../predicates/contourArea';
import { euclDist } from '../predicates/distance';
import { pointOnSegment } from '../predicates/pointOnSegment';

/** Порог слияния близких вершин контура, см (ADR 0017 C3/C6, `minLen` референса). */
export const CLEAR_CONTOUR_MIN_LEN = 5;

/**
 * Чистка контура (ADR 0017 C6, `clearContour` референса): цепочки подряд идущих вершин ближе
 * `CLEAR_CONTOUR_MIN_LEN` схлопываются — остаётся конец `B`, если начало `A` лежит на прямой `prev–B`
 * (B_EPS), иначе `A`, если `B` лежит на `A–next`, иначе оба (`[A, B]` — короткое ребро торца тонкой стены
 * законно); затем удаляются «иглы» — вершины, чьи соседи ближе порога друг к другу. Проходы повторяются до
 * неподвижной точки, поэтому `clearContour(clearContour(c)) == clearContour(c)` (референс делал один проход
 * и сравнивал индексы исходного массива с индексами уже изменённого — исправлено). Общая коллинеарность
 * **не** трогается: вершина между двумя коллинеарными стенами — законная точка пользователя (спека 01:
 * слияние стен — только явным удалением точки; ADR 0017 «Что важно знать» → правило владельцев, 0054).
 *
 * `null` — контур негоден: меньше 3 вершин, не проходит `contourValid`, нет ни одного ребра длиннее порога
 * (как референс: обход начинается с длинного ребра, чтобы цепочки не переходили через начало) или после
 * чистки осталось меньше 3 вершин. Возвращает подмножество исходных вершин (те же объекты) — новых координат
 * не появляется; порядок обхода сохраняется, начало может сдвинуться (циклический сдвиг).
 */
export const clearContour = <T extends PlanPosition>(input: readonly T[]): T[] | null => {
  if (input.length < 3 || !contourValid(input)) return null;
  let contour: T[] = [...input];
  // Ограничение итераций — страховка от бесконечного цикла: каждый результативный проход убирает вершину.
  for (let pass = 0; pass <= input.length; pass++) {
    const rotated = rotateToLongEdge(contour);
    if (!rotated) return null;
    const merged = mergeChains(rotated);
    if (merged.length < 3) return null;
    const spiked = removeSpikes(merged);
    if (spiked.length < 3) return null;
    if (spiked.length === contour.length) return spiked;
    contour = spiked;
  }
  return contour;
};

/** Сдвиг начала на первое ребро длиной ≥ порога; `null`, если такого нет. */
const rotateToLongEdge = <T extends PlanPosition>(contour: readonly T[]): T[] | null => {
  const n = contour.length;
  for (let i = 0; i < n; i++) {
    if (euclDist(contour[i]!, contour[(i + 1) % n]!) >= CLEAR_CONTOUR_MIN_LEN) {
      return [...contour.slice(i), ...contour.slice(0, i)];
    }
  }
  return null;
};

/** Схлопывание цепочек близких вершин; ребро `0→1` длинное, поэтому цепочки не пересекают начало массива. */
const mergeChains = <T extends PlanPosition>(contour: readonly T[]): T[] => {
  const n = contour.length;
  const result: T[] = [];
  let i = 0;
  while (i < n) {
    if (euclDist(contour[i]!, contour[(i + 1) % n]!) >= CLEAR_CONTOUR_MIN_LEN) {
      result.push(contour[i]!);
      i++;
      continue;
    }
    // Цепочка [i .. j]: все рёбра внутри короче порога, ребро j→j+1 — нет (или j — конец массива и j+1 = 0).
    let j = i + 1;
    while (j < n && euclDist(contour[j]!, contour[(j + 1) % n]!) < CLEAR_CONTOUR_MIN_LEN) j++;
    const a = contour[i]!;
    const b = contour[j % n]!;
    const prev = contour[(i - 1 + n) % n]!;
    const next = contour[(j + 1) % n]!;
    const keepA = !pointOnSegment(a, prev, b);
    const keepB = keepA && pointOnSegment(b, a, next) ? false : true;
    if (j >= n) {
      // Цепочка замкнулась на вершину 0 (`b`), уже стоящую в начале результата: `a` дописывается в конец,
      // `b` при выбывании снимается с начала — порядок обхода и старт сохраняются.
      if (keepA) result.push(a);
      if (!keepB) result.shift();
      break;
    }
    if (keepA) result.push(a);
    if (keepB) result.push(b);
    i = j + 1;
  }
  return result;
};

/** Удаление вершин-«игл»: соседи вершины ближе порога друг к другу. Один проход по текущим индексам. */
const removeSpikes = <T extends PlanPosition>(contour: readonly T[]): T[] => {
  const n = contour.length;
  return contour.filter((_, i) => {
    const prev = contour[(i - 1 + n) % n]!;
    const next = contour[(i + 1) % n]!;
    return euclDist(prev, next) >= CLEAR_CONTOUR_MIN_LEN;
  });
};
