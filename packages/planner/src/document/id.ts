import { uuidv7 } from 'uuidv7';

/** Стабильный строковый идентификатор хранимой сущности документа — UUID v7 (ADR 0016 B2). */
export type Id = string;

/** Единственный генератор id в пакете: сортируемые по времени UUID v7 (ADR 0006/0016). */
export const createId = (): Id => uuidv7();
