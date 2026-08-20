/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import { DOCUMENT_FORMAT, DOCUMENT_VERSION, MIGRATIONS, type Migration, versionOf } from './version';

describe('версия формата выводится из цепочки миграций (ADR 0021)', () => {
  it('DOCUMENT_FORMAT — строковый идентификатор `uyutno.planner`', () => {
    expect(DOCUMENT_FORMAT).toBe('uyutno.planner');
  });

  it('DOCUMENT_VERSION равна versionOf(MIGRATIONS), а не самостоятельному числу', () => {
    expect(DOCUMENT_VERSION).toBe(versionOf(MIGRATIONS));
  });

  it('в v0 цепочка пуста, версия — 1', () => {
    expect(MIGRATIONS).toHaveLength(0);
    expect(DOCUMENT_VERSION).toBe(1);
  });

  it('фиктивный шаг в цепочке поднимает версию — константу править не требуется', () => {
    const step: Migration = raw => raw;
    expect(versionOf([])).toBe(1);
    expect(versionOf([step])).toBe(2);
    expect(versionOf([step, step])).toBe(3);
  });

  /**
   * Приёмка задачи 0079 требует не только «версия сейчас считается», но и «литералом её задать нельзя».
   * Проверяется по исходнику: единственное присваивание `DOCUMENT_VERSION` идёт через `versionOf`.
   */
  it('в исходнике нет присваивания версии литералом', () => {
    const source = fs.readFileSync(path.join(__dirname, 'version.ts'), 'utf8');
    const assignment = source.match(/export const DOCUMENT_VERSION\s*=\s*([^;]+);/);
    expect(assignment).not.toBeNull();
    expect(assignment![1]!.trim()).toBe('versionOf(MIGRATIONS)');
  });
});
