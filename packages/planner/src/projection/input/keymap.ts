import type { KeyAction } from '../../engine/tools/ToolState';

/**
 * Раскладка клавиш конструктора — чистая функция (ADR 0019 E5, тестовый контракт E8 слой 1).
 * Маршрут: `keydown` → `keyToAction` → `tools.key(action)`; `{ handled: false }` на `nudge` (нет выделения)
 * → проекция панорамирует (ADR 0020 P3).
 */

/** Множители шага нуджа (ADR 0019 E4, спека 01): Shift — ×10, Shift + Ctrl/Cmd — ×0.1. */
export const NUDGE_FACTOR_FAST = 10;
export const NUDGE_FACTOR_FINE = 0.1;

/** Направления нуджа в осях **плана** (`y` вверх), по `event.key`. */
const NUDGE_KEYS: Readonly<Record<string, { dx: number; dy: number }>> = Object.freeze({
  arrowup: { dx: 0, dy: 1 },
  arrowdown: { dx: 0, dy: -1 },
  arrowleft: { dx: -1, dy: 0 },
  arrowright: { dx: 1, dy: 0 },
  w: { dx: 0, dy: 1 },
  s: { dx: 0, dy: -1 },
  a: { dx: -1, dy: 0 },
  d: { dx: 1, dy: 0 },
});

/** Минимум, который нужен keymap от `KeyboardEvent` — чтобы функция тестировалась без DOM. */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const nudgeFactor = ({ shiftKey, ctrlKey, metaKey }: KeyEventLike): number => {
  if (!shiftKey) return 1;
  return ctrlKey || metaKey ? NUDGE_FACTOR_FINE : NUDGE_FACTOR_FAST;
};

/**
 * Клавиша → действие автомата (ADR 0019 E5): Esc → `cancel`; Ctrl/Cmd+Z → `undo`; Ctrl/Cmd+Y и
 * Ctrl/Cmd+Shift+Z → `redo`; стрелки/WASD → `nudge` (шаг — по `settings.units`, множители — модификаторы);
 * Delete/Backspace → `delete`. Всё остальное — `null`: событие не наше, браузеру не мешаем.
 *
 * Ctrl/Cmd у **стрелок** — не запрет, а часть множителя: точный шаг — это Shift + Ctrl/Cmd + стрелка
 * (ADR 0019 E4). У **WASD** тот же модификатор, наоборот, запрещает перехват — иначе съедались бы браузерные
 * Ctrl+A / Ctrl+W, а Ctrl+S уходил бы нуджем вниз вместо ручного Save (его берёт `isSaveShortcut`).
 * Delete/Backspace с Ctrl/Cmd тоже не наши (удаление слова в тексте).
 * Alt не назначен ни на что в конструкторе.
 */
export const keyToAction = (event: KeyEventLike): KeyAction | null => {
  const key = event.key.toLowerCase();
  const command = event.ctrlKey || event.metaKey;

  if (key === 'escape') return { kind: 'cancel' };
  if (command && key === 'z') return event.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
  if (command && key === 'y') return { kind: 'redo' };
  if (event.altKey) return null;
  if (!command && (key === 'delete' || key === 'backspace')) return { kind: 'delete' };

  const direction = NUDGE_KEYS[key];
  if (!direction) return null;
  if (command && !key.startsWith('arrow')) return null;
  return { kind: 'nudge', dx: direction.dx, dy: direction.dy, factor: nudgeFactor(event) };
};

/**
 * Ctrl+S / Cmd+S — ручной Save (спека 10, задача `0082`). Отдельно от `keyToAction`: сохранение не действие
 * автомата инструментов, оно уходит в `persistence`. Shift и Alt не наши: «Save As» в v0 нет, Alt в
 * конструкторе не назначен, и перехватывать чужие сочетания незачем.
 */
export const isSaveShortcut = (event: KeyEventLike): boolean =>
  (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's';

/** Space (зажат — пан ЛКМ, ADR 0020 P3). Отдельно от `keyToAction`: в автомат Space не уходит. */
export const isPanModifierKey = (event: KeyEventLike): boolean => event.key === ' ' || event.key === 'Spacebar';

/**
 * Переживает ли сочетание фокус в поле ввода (задача `0094`). Guard ниже гасит **голые клавиши**: в поле `s` и
 * `wasd` — это набранные символы, стрелки — курсор в тексте (спека 07, решение автора 20), Enter/Esc/Tab поле
 * обрабатывает само. Сочетание же с Ctrl/Cmd символа не даёт — это команда уровня документа, и запрещать её
 * из-за того, что курсор стоит в поле длины, значит ломать редактор в самом обычном его состоянии.
 *
 * Проходит ровно то, что **не конфликтует с правкой текста**, — сейчас это один Ctrl/Cmd+S: своей команды
 * «сохранить» у текстового поля нет, отнимать нечего, а альтернатива — браузерный диалог сохранения страницы.
 * Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z и Ctrl/Cmd+Y осознанно **не проходят**: у поля есть своя история отмены, и
 * пока человек правит текст, Ctrl+Z обязан откатывать набранные символы, а не последнюю правку геометрии.
 * По той же причине не проходят чужие Ctrl+A/C/V/X — их поле обрабатывает само, планер на них не завязан.
 */
export const survivesEditableFocus = (event: KeyEventLike): boolean => isSaveShortcut(event);

/**
 * Guard «фокус в поле ввода» (ADR 0019 E5): инпуты длины сами обрабатывают Enter/Esc/Tab (спека 07), а Ctrl+Z
 * в поле — это undo текста, не документа. `null` (фокуса нет) — перехватываем. Что именно guard пропускает
 * сквозь себя, решает `survivesEditableFocus`: предикат отвечает только на вопрос «это поле ввода?».
 */
export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof target !== 'object') return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  const tag = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select';
};
