import type { PlannerManager } from '../../engine/PlannerManager';
import { isEditableTarget, isPanModifierKey, isSaveShortcut, keyToAction } from './keymap';

export interface KeyboardInputOptions {
  /**
   * Нудж, который автомат не взял (`{ handled: false }` — нет выделения): панорамирует вьювер конструктора
   * (ADR 0020 P3). Возвращает `true`, если пан состоялся, — тогда событие считается обработанным.
   */
  onPan(dx: number, dy: number, factor: number): boolean;
  /** Space зажат/отпущен — Space + ЛКМ панорамирует холст (ADR 0020 P3). */
  onPanModifier(pressed: boolean): void;
}

/**
 * **Единственный владелец клавиатуры планера** (ADR 0019 E5, ADR 0020 P6): один `keydown` и один `keyup` на
 * `window`, guard «фокус в `input`/`textarea`/`contentEditable` → не перехватывать», чистый keymap → `KeyAction`.
 * Создаётся в `createPlanner` (не в React); панель инструментов 0061 клавиш не вешает.
 *
 * Маршрут: `tools.key(action)`; если автомат вернул `{ handled: false }` на `nudge` — панорамирует вьювер.
 * `keyup` нужен только для состояния «Space зажат», которое отдаётся Canvas2D-проекции.
 *
 * Ctrl+S / Cmd+S — исключение из маршрута: сохранение не действие автомата, оно уходит прямо в `persistence`
 * (задача `0082`). Владелец клавиатуры один, поэтому и этот перехват живёт здесь, а не в шапке платформы.
 */
export class KeyboardInput {
  private readonly view: Window;
  private readonly manager: PlannerManager;
  private readonly options: KeyboardInputOptions;
  private disposed = false;

  constructor(manager: PlannerManager, view: Window, options: KeyboardInputOptions) {
    this.manager = manager;
    this.view = view;
    this.options = options;
    view.addEventListener('keydown', this.onKeyDown);
    view.addEventListener('keyup', this.onKeyUp);
    view.addEventListener('blur', this.onBlur);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.view.removeEventListener('keydown', this.onKeyDown);
    this.view.removeEventListener('keyup', this.onKeyUp);
    this.view.removeEventListener('blur', this.onBlur);
    this.options.onPanModifier(false);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed || event.defaultPrevented) return;
    // Пока фокус в поле ввода длины, глобальные горячие клавиши не срабатывают вообще (спека 07, решение 20).
    if (isEditableTarget(event.target)) return;

    if (isSaveShortcut(event)) {
      /**
       * Браузерное «сохранить страницу» гасится **всегда**, а не только когда есть что сохранять: диалог
       * сохранения HTML вместо проекта — худший из возможных ответов на Ctrl+S. Дальше решает `persistence`:
       * dirty снят — тихо ничего, идёт жест — Save откладывается до ближайшего сохранения после отпускания
       * (спека 10). Результат здесь не читается: ошибка ложится в состояние, а показывает её шапка (`0084`).
       */
      event.preventDefault();
      void this.manager.persistence.save('manual');
      return;
    }

    if (isPanModifierKey(event)) {
      this.options.onPanModifier(true);
      // Space прокручивал бы страницу — холст занимает экран целиком, прокрутка тут не нужна.
      event.preventDefault();
      return;
    }

    const action = keyToAction(event);
    if (!action) return;

    const { handled } = this.manager.tools.key(action);
    if (handled) {
      event.preventDefault();
      return;
    }
    // Автомат нудж не взял (нет выделения) — двигаем камеру конструктора (ADR 0019 E4, ADR 0020 P3).
    if (action.kind === 'nudge' && this.options.onPan(action.dx, action.dy, action.factor)) {
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.disposed) return;
    if (isPanModifierKey(event)) this.options.onPanModifier(false);
  };

  /**
   * Фокус ушёл из окна — снимаем «Space зажат», иначе он залипнет до следующего `keyup`, которого уже не будет.
   * Сам `tools.blur()` (прерывание жеста, спека 09) зовёт Canvas2D-проекция: `blur` окна — часть её DOM-ввода
   * (ADR 0020 P1), два вызова на одно событие не нужны.
   */
  private readonly onBlur = (): void => {
    if (this.disposed) return;
    this.options.onPanModifier(false);
  };
}
