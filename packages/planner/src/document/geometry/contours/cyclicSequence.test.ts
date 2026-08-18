import { canonicalCycleKey, sameCycle } from './cyclicSequence';

describe('canonicalCycleKey', () => {
  const base = ['b', 'c', 'a', 'd'];

  it('одинаков для всех циклических сдвигов', () => {
    const key = canonicalCycleKey(base);
    for (let shift = 1; shift < base.length; shift++) {
      expect(canonicalCycleKey([...base.slice(shift), ...base.slice(0, shift)])).toBe(key);
    }
  });

  it('одинаков для обратного порядка (и его сдвигов)', () => {
    const key = canonicalCycleKey(base);
    const reversed = [...base].reverse();
    expect(canonicalCycleKey(reversed)).toBe(key);
    expect(canonicalCycleKey([...reversed.slice(2), ...reversed.slice(0, 2)])).toBe(key);
  });

  it('ключ — минимальный лексикографически сдвиг; разделитель — пробел', () => {
    // Сдвиги base: b·c·a·d, c·a·d·b, a·d·b·c, d·b·c·a; разворота: d·a·c·b, a·c·b·d, … → минимум a·c·b·d.
    expect(canonicalCycleKey(base)).toBe(['a', 'c', 'b', 'd'].join(' '));
    expect(canonicalCycleKey(['a', 'b', 'c', 'd'])).toBe(['a', 'b', 'c', 'd'].join(' '));
  });

  it('различает порядки, не сводимые сдвигом/разворотом', () => {
    expect(canonicalCycleKey(['a', 'b', 'c', 'd'])).not.toBe(canonicalCycleKey(['a', 'c', 'b', 'd']));
  });

  it('различает разные мультимножества', () => {
    expect(canonicalCycleKey(['a', 'b', 'c'])).not.toBe(canonicalCycleKey(['a', 'b', 'd']));
    expect(canonicalCycleKey(['a', 'b'])).not.toBe(canonicalCycleKey(['a', 'b', 'b']));
  });

  it('пустая последовательность → пустая строка; одиночный элемент — сам элемент', () => {
    expect(canonicalCycleKey([])).toBe('');
    expect(canonicalCycleKey(['x'])).toBe('x');
  });

  it('повторяющиеся id: ключ учитывает кратность и порядок', () => {
    expect(canonicalCycleKey(['a', 'a', 'b'])).toBe(['a', 'a', 'b'].join(' '));
    expect(canonicalCycleKey(['a', 'b', 'a'])).toBe(['a', 'a', 'b'].join(' '));
  });

  it('не мутирует вход', () => {
    const input = ['c', 'a', 'b'];
    canonicalCycleKey(input);
    expect(input).toEqual(['c', 'a', 'b']);
  });
});

describe('sameCycle', () => {
  it('true для сдвига, разворота и сдвига разворота', () => {
    expect(sameCycle(['a', 'b', 'c', 'd'], ['c', 'd', 'a', 'b'])).toBe(true);
    expect(sameCycle(['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a'])).toBe(true);
    expect(sameCycle(['a', 'b', 'c', 'd'], ['b', 'a', 'd', 'c'])).toBe(true);
  });

  it('false для разных длин (даже если одна — префикс другой)', () => {
    expect(sameCycle(['a', 'b', 'c'], ['a', 'b', 'c', 'd'])).toBe(false);
    expect(sameCycle([], ['a'])).toBe(false);
  });

  it('false для другого порядка той же длины', () => {
    expect(sameCycle(['a', 'b', 'c', 'd'], ['a', 'c', 'b', 'd'])).toBe(false);
  });

  it('true для двух пустых', () => {
    expect(sameCycle([], [])).toBe(true);
  });
});
