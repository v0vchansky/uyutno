import { createPlanBuilder } from '../document/testing/planBuilder';
import { migrate, migrateWith } from './migrate';
import { DOCUMENT_VERSION, type JsonObject, type Migration } from './version';

const rawDocument = (): JsonObject => JSON.parse(JSON.stringify(createPlanBuilder().document())) as JsonObject;

describe('migrate (ADR 0021: заводится сразу, с пустой цепочкой)', () => {
  it('пустая цепочка — тождество с changed: false', () => {
    const raw = rawDocument();
    const result = migrate(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(false);
    expect(result.value.document).toEqual(raw);
  });

  it('повторный прогон результата ничего не меняет (переживает повтор)', () => {
    const first = migrate(rawDocument());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = migrate(first.value.document);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.changed).toBe(false);
    expect(second.value.document).toEqual(first.value.document);
  });

  it('детерминирована: два прогона на одном входе дают равный результат', () => {
    const raw = rawDocument();
    expect(migrate(raw)).toEqual(migrate(raw));
  });

  it('вход не мутируется', () => {
    const raw = rawDocument();
    const snapshot = JSON.stringify(raw);
    migrate(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  describe('фиктивная цепочка — проверка самой механики шагов', () => {
    /** Шаг 1 → 2: переименовывает поле и поднимает `version`. */
    const step: Migration = raw => ({ ...raw, version: 2, renamed: raw['settings'] ?? null });

    it('шаг i поднимает документ с версии i на i + 1 и ставит changed: true', () => {
      const result = migrateWith({ ...rawDocument(), version: 1 }, [step]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.changed).toBe(true);
      expect(result.value.document['version']).toBe(2);
      expect(result.value.document['renamed']).toBeDefined();
    });

    it('повтор на уже мигрированном — changed: false, документ тот же', () => {
      const once = migrateWith({ ...rawDocument(), version: 1 }, [step]);
      expect(once.ok).toBe(true);
      if (!once.ok) return;
      const twice = migrateWith(once.value.document, [step]);
      expect(twice.ok).toBe(true);
      if (!twice.ok) return;
      expect(twice.value.changed).toBe(false);
      expect(twice.value.document).toEqual(once.value.document);
    });

    it('документ проходит всю цепочку целиком, а не один шаг', () => {
      const up =
        (to: number): Migration =>
        raw => ({ ...raw, version: to });
      const result = migrateWith({ ...rawDocument(), version: 1 }, [up(2), up(3), up(4)]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.document['version']).toBe(4);
      expect(result.value.changed).toBe(true);
    });

    it('версия новее цепочки → unsupported-version', () => {
      const result = migrateWith({ ...rawDocument(), version: 5 }, [step]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({ kind: 'unsupported-version', version: 5, supported: 2 });
    });
  });

  it('битый конверт отдаёт corrupt, а не исключение', () => {
    for (const junk of ['не json', 42, null, [], {}, { format: 'uyutno.planner' }]) {
      const result = migrate(junk);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.kind).toBe('corrupt');
    }
  });

  it('версия новее текущей → unsupported-version с текущей в supported', () => {
    const result = migrate({ ...rawDocument(), version: DOCUMENT_VERSION + 3 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: 'unsupported-version',
      version: DOCUMENT_VERSION + 3,
      supported: DOCUMENT_VERSION,
    });
  });
});
