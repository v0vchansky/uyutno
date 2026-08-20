import { err, ok, type Result } from '../document/Result';
import { corrupt, type ParseError } from './errors';
import { DOCUMENT_FORMAT, type JsonObject } from './version';

/**
 * Обязательный минимум конверта — то, без чего документ считается битым (ADR 0021): читаемый JSON,
 * объект, `format`, целая `version >= 1`, массив `floors`. Проверяется **до** схемы и до миграций:
 * миграция старой версии не может опираться на форму, которой в старой версии не было, а вот на эти
 * четыре поля — может, они есть с первого дня (ADR 0016 B6).
 */

/** Принимает и строку из колонки/localStorage, и уже разобранный объект. */
export const toJsonObject = (raw: unknown): Result<JsonObject, ParseError> => {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (error) {
      return err(corrupt('invalid-json', error instanceof Error ? error.message : 'не разбирается как JSON'));
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return err(corrupt('not-an-object', `корень документа — ${Array.isArray(value) ? 'массив' : typeof value}`));
  }
  return ok(value as JsonObject);
};

export const readEnvelope = (raw: unknown): Result<JsonObject, ParseError> => {
  const json = toJsonObject(raw);
  if (!json.ok) return json;
  const document = json.value;

  if (document['format'] !== DOCUMENT_FORMAT) {
    return err(corrupt('missing-format', `format = ${JSON.stringify(document['format'])}`));
  }
  const version = document['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return err(corrupt('missing-version', `version = ${JSON.stringify(version)}`));
  }
  if (!Array.isArray(document['floors'])) {
    return err(corrupt('missing-floors', `floors = ${JSON.stringify(document['floors'])}`));
  }
  return ok(document);
};
