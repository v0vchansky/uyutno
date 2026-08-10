import { normalizeFromParam } from './normalizeFromParam';

describe('normalizeFromParam', () => {
  it('пропускает относительные пути', () => {
    expect(normalizeFromParam('/projects')).toBe('/projects');
    expect(normalizeFromParam('/project/abc-123')).toBe('/project/abc-123');
    expect(normalizeFromParam('/projects?filter=all')).toBe('/projects?filter=all');
    expect(normalizeFromParam('/')).toBe('/');
    expect(normalizeFromParam('/projects?a=1&b=2')).toBe('/projects?a=1&b=2');
    expect(normalizeFromParam('/path/with%20encoded')).toBe('/path/with%20encoded');
  });

  it('отбрасывает protocol-relative URL', () => {
    expect(normalizeFromParam('//evil.com')).toBeNull();
    expect(normalizeFromParam('//evil.com/path')).toBeNull();
  });

  it('отбрасывает абсолютные URL', () => {
    expect(normalizeFromParam('http://evil.com')).toBeNull();
    expect(normalizeFromParam('https://evil.com/path')).toBeNull();
    expect(normalizeFromParam('javascript:alert(1)')).toBeNull();
    expect(normalizeFromParam('data:text/html,<script>')).toBeNull();
  });

  it('отбрасывает пути с обратным слэшем', () => {
    expect(normalizeFromParam('/\\evil.com')).toBeNull();
    expect(normalizeFromParam('/path\\subpath')).toBeNull();
  });

  it('отбрасывает пути не начинающиеся с /', () => {
    expect(normalizeFromParam('projects')).toBeNull();
    expect(normalizeFromParam('projects/1')).toBeNull();
    expect(normalizeFromParam('')).toBeNull();
  });

  it('отбрасывает пути с запрещёнными символами', () => {
    expect(normalizeFromParam('/path with space')).toBeNull();
    expect(normalizeFromParam('/путь')).toBeNull();
    expect(normalizeFromParam('/path<script>')).toBeNull();
    expect(normalizeFromParam('/path#fragment')).toBeNull();
  });

  it('отбрасывает не-строки', () => {
    expect(normalizeFromParam(undefined)).toBeNull();
    expect(normalizeFromParam(null)).toBeNull();
    expect(normalizeFromParam(123)).toBeNull();
    expect(normalizeFromParam({})).toBeNull();
    expect(normalizeFromParam([])).toBeNull();
  });

  it('отбрасывает слишком длинные строки', () => {
    expect(normalizeFromParam('/' + 'a'.repeat(3000))).toBeNull();
  });
});
