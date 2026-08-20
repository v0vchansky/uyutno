import { err, ok, type Result } from '../document/Result';
import { readEnvelope } from './envelope';
import type { ParseError } from './errors';
import { MIGRATIONS, type JsonObject, type Migration, versionOf } from './version';

/**
 * Результат подъёма документа до текущей версии формата.
 *
 * `changed` нужен серверу (задача 0080): `GET …/document` мигрирует на чтении и перезаписывает колонку
 * **только если что-то изменилось**. Перезапись служебная — она не двигает `updated_at` и не влияет на
 * dirty (ADR 0021).
 */
export interface Migrated {
  document: JsonObject;
  changed: boolean;
}

/**
 * Прогоняет конверт по цепочке. Шаг с индексом `i` поднимает версию `i + 1` на `i + 2`, то есть документ
 * версии `v` начинает с `migrations[v - 1]`.
 *
 * Детерминированная и переживает повтор — на этом держится безвредность гонки двух одновременных чтений
 * (ADR 0021, «Что важно знать»): два сервера могут мигрировать один документ одновременно и записать
 * один и тот же результат. Вход не мутируется: шаги обязаны возвращать новый объект.
 *
 * Цепочка — параметр, а не только глобальная `MIGRATIONS`: так механику шагов можно проверить тестами,
 * не заводя фиктивную версию формата в продакшн-цепочке.
 */
export const migrateWith = (raw: unknown, migrations: readonly Migration[]): Result<Migrated, ParseError> => {
  const envelope = readEnvelope(raw);
  if (!envelope.ok) return envelope;

  const supported = versionOf(migrations);
  const version = envelope.value['version'] as number;
  if (version > supported) return err({ kind: 'unsupported-version', version, supported });

  let document = envelope.value;
  for (let from = version; from < supported; from++) document = migrations[from - 1]!(document);
  return ok({ document, changed: version !== supported });
};

/** Тот же подъём по боевой цепочке. В v0 она пуста, поэтому это тождество с `changed: false`. */
export const migrate = (raw: unknown): Result<Migrated, ParseError> => migrateWith(raw, MIGRATIONS);
