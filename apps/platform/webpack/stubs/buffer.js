/**
 * Стаб Node-модуля `buffer` для клиентского бандла (ADR 0017 C2, задача 0054): `clean-pslg` тянет `buffer`
 * через `typedarray-pool`/`bn.js`, но в браузере использует только `Buffer.isBuffer` как проверку типа —
 * ни один вызов не создаёт буферы. Стаб весит 0 KiB против ~26 KiB полифилла; появится другой потребитель
 * `buffer` (реальные `Buffer.from`/`alloc`) — заменить на полифилл `buffer` и убрать alias.
 */
export const Buffer = { isBuffer: () => false };
