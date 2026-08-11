import { formatUpdatedAt } from './formatUpdatedAt';

describe('formatUpdatedAt', () => {
  it('«изменён сегодня в ЧЧ:ММ», если тот же день', () => {
    const now = new Date('2026-08-11T15:00:00');
    const iso = new Date('2026-08-11T14:32:00').toISOString();
    expect(formatUpdatedAt(iso, now)).toBe('изменён сегодня в 14:32');
  });

  it('«изменён сегодня в 00:05» — сразу после полуночи', () => {
    const now = new Date('2026-08-11T00:10:00');
    const iso = new Date('2026-08-11T00:05:00').toISOString();
    expect(formatUpdatedAt(iso, now)).toBe('изменён сегодня в 00:05');
  });

  it('«изменён вчера», если предыдущий день', () => {
    const now = new Date('2026-08-11T09:00:00');
    const iso = new Date('2026-08-10T21:30:00').toISOString();
    expect(formatUpdatedAt(iso, now)).toBe('изменён вчера');
  });

  it('дата в текущем году без года', () => {
    const now = new Date('2026-08-11T09:00:00');
    const iso = new Date('2026-08-03T18:00:00').toISOString();
    expect(formatUpdatedAt(iso, now)).toBe('изменён 3 августа');
  });

  it('дата в прошлом году показывается с годом', () => {
    const now = new Date('2026-08-11T09:00:00');
    const iso = new Date('2025-03-12T10:00:00').toISOString();
    expect(formatUpdatedAt(iso, now)).toBe('изменён 12 марта 2025');
  });

  it('перелом года: 31 декабря прошлого года — с годом', () => {
    const now = new Date('2026-01-05T10:00:00');
    const iso = new Date('2025-12-31T23:59:00').toISOString();
    expect(formatUpdatedAt(iso, now)).toBe('изменён 31 декабря 2025');
  });

  it('позавчера — уже дата, не «вчера»', () => {
    const now = new Date('2026-08-11T09:00:00');
    const iso = new Date('2026-08-09T09:00:00').toISOString();
    expect(formatUpdatedAt(iso, now)).toBe('изменён 9 августа');
  });
});
