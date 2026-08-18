/**
 * Каноническая форма циклической последовательности строк (id точек контура, ADR 0017 C1 «контур сохраняет id,
 * если последовательность id совпала с прежней с точностью до циклического сдвига»): минимальный по
 * лексикографическому сравнению из всех сдвигов **и обеих ориентаций** — тождество контура не зависит ни от
 * точки старта, ни от направления обхода (нормализация ориентации не должна менять id).
 * Строится через `join(' ')` — id пробелов не содержат (uuid / детерминированные `p1`).
 */
export const canonicalCycleKey = (sequence: readonly string[]): string => {
  const n = sequence.length;
  if (n === 0) return '';
  let best: string | null = null;
  const consider = (items: readonly string[]): void => {
    for (let shift = 0; shift < n; shift++) {
      const rotated = [...items.slice(shift), ...items.slice(0, shift)].join(' ');
      if (best === null || rotated < best) best = rotated;
    }
  };
  consider(sequence);
  consider([...sequence].reverse());
  return best!;
};

/** Две циклические последовательности равны с точностью до сдвига и ориентации. */
export const sameCycle = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && canonicalCycleKey(a) === canonicalCycleKey(b);
