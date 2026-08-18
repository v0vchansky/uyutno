import { createId } from './id';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createId', () => {
  it('возвращает UUID v7 в канонической строчной форме (ADR 0016 B2)', () => {
    expect(createId()).toMatch(UUID_V7);
  });

  it('уникален и монотонен по времени в пределах одного процесса', () => {
    const ids = Array.from({ length: 1000 }, () => createId());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
});
