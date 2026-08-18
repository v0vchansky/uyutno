import { freeze } from 'immer';

import {
  DOCUMENT_FORMAT,
  DOCUMENT_VERSION,
  UNITS,
  type DocumentSettings,
  type PlannerDocument,
} from '../document/PlannerDocument';
import type { PlannerStore } from './PlannerStore';
import { err, ok, type Result } from './Result';
import type { DerivedState } from './rebuild';

export type LoadError =
  | { kind: 'unsupported-format'; format: unknown }
  | { kind: 'unsupported-version'; version: unknown; supported: number };

export type SetSettingsError =
  { kind: 'invalid-units'; units: unknown } | { kind: 'invalid-wall-height'; wallHeight: unknown };

/**
 * Неймспейс `document` фасада (ADR 0015 A2): снимок документа и производного, загрузка, команды-мутации
 * содержимого (`floors`, `settings`). Каждая команда — одна транзакция `PlannerStore` → одно событие.
 * Команды инструментов (контуры, точки) появятся в шаге 2 (ADR C/E) здесь же.
 */
export class DocumentNamespace {
  constructor(private readonly store: PlannerStore) {}

  /** Замороженный снимок документа. */
  get(): PlannerDocument {
    return this.store.getDocument();
  }

  /** Замороженный результат последнего rebuild — для проекций (ADR G); UI его не трогает. */
  getDerived(): DerivedState {
    return this.store.getDerived();
  }

  /**
   * Заменяет документ целиком (шаг 3 подключит сюда `storage.load`). Проверяет только `format`/`version` —
   * структурная валидация (zod) и миграции — ADR F. Документ становится собственностью движка и замораживается.
   */
  load(document: PlannerDocument): Result<void, LoadError> {
    if (typeof document !== 'object' || document === null || document.format !== DOCUMENT_FORMAT) {
      return err({ kind: 'unsupported-format', format: document?.format });
    }
    if (!Number.isInteger(document.version) || document.version < 1 || document.version > DOCUMENT_VERSION) {
      return err({ kind: 'unsupported-version', version: document.version, supported: DOCUMENT_VERSION });
    }
    const frozen = freeze(document, true);
    this.store.transact(() => frozen);
    return ok(undefined);
  }

  /** Меняет настройки документа: `units` — из `UNITS`, `wallHeight` — конечное число > 0. */
  setSettings(patch: Partial<DocumentSettings>): Result<void, SetSettingsError> {
    const { units, wallHeight } = patch;
    if (units !== undefined && !UNITS.includes(units)) return err({ kind: 'invalid-units', units });
    if (wallHeight !== undefined && !(Number.isFinite(wallHeight) && wallHeight > 0)) {
      return err({ kind: 'invalid-wall-height', wallHeight });
    }
    // Поля присваиваются поимённо: `undefined` в документ не попадает (plain-JSON, ADR 0016 B5).
    this.store.transact(draft => {
      if (units !== undefined) draft.settings.units = units;
      if (wallHeight !== undefined) draft.settings.wallHeight = wallHeight;
    });
    return ok(undefined);
  }
}
