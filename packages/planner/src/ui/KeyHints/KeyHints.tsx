import type React from 'react';
import { Fragment } from 'react';

import { MouseRightButtonIcon } from '../icons/draftIcons';
import { usePlannerLengthFocus } from '../PlannerOverlayContext';
import { usePlannerSelector } from '../usePlannerSelector';
import { keyHintsFor, keyHintsForFocus, type KeyHint } from './keyHintsFor';

/**
 * Полоса контекстной подсказки горячих клавиш (решение 3 брифа `docs/ui/briefs/planner-editor.md`, P0.9; геометрия —
 * handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Полоса подсказки клавиш»). Показывает, какие клавиши и
 * кнопки мыши осмысленны **прямо сейчас**.
 *
 * **Источников два, приоритет сверху вниз:**
 *
 * 1. `usePlannerLengthFocus()` — фокус в полях длины из общего контекста скина (`ui/PlannerOverlayContext.tsx`,
 *    пишет оверлей 0060): две строки нормативной таблицы, которых автомат не различает. Фокус приоритетнее,
 *    потому что пока курсор в поле, глобальные клавиши редактора не срабатывают вообще, и подсказка обязана
 *    говорить про Tab и Enter, а не про клавиши инструмента;
 * 2. `keyHintsFor(kind)` — состояние автомата инструментов (`tools:changed` через `usePlannerSelector`).
 *
 * Вне провайдера оверлея фокус отдаёт `null`, и полоса показывает подсказки автомата — падать она не должна.
 *
 * Селектор читает **строку** `kind`: `tools:changed` летит на каждый `pointerMove`, поэтому любой новый объект в
 * селекторе означал бы бесконечный ре-рендер (`packages/planner/CLAUDE.md`, «Снимок заморожен и отдаётся как есть»).
 *
 * Клавиатурных слушателей здесь нет и быть не может: единственный владелец клавиатуры — `projection/input/keyboard.ts`
 * (ADR 0019 E5). Полоса ничего не слушает, ни на что не кликается и не является тултипом/тостом/модалкой: не
 * появляется по наведению, не исчезает по таймеру, не копится и не закрывается. Переход между состояниями мгновенный,
 * без анимации.
 *
 * Позиционирование — на родителе (handoff, «Каркас»: по центру снизу, отступ 12px). **Контейнер-обёртка обязана иметь
 * `pointer-events: none`**, чтобы клик мимо подсказки уходил в холст; сама полоса возвращает себе `pointer-events:auto`
 * классом ниже.
 */
/** Высота полосы, CSS px (класс `h-8`). Нужна `ConstructorSkin` для нижнего inset камеры. */
export const KEY_HINTS_HEIGHT = 32;

export const KeyHints: React.FC = () => {
  const kind = usePlannerSelector(manager => manager.tools.get().kind);
  const focus = usePlannerLengthFocus();
  const hints = focus ? keyHintsForFocus(focus) : keyHintsFor(kind);

  /*
   * Контракт состояния «подсказки нет» из handoff'а: полоса не рисуется совсем и места не занимает. Ни одно
   * текущее состояние пустого набора не отдаёт — для `editing` handoff даёт «панорамирование **либо** пусто», и мы
   * выбрали панорамирование. Строка защищает от пустой плашки, если таблица однажды вернёт пустой набор.
   */
  if (hints.length === 0) return null;

  return (
    <div
      aria-live='polite'
      className='pointer-events-auto inline-flex h-8 max-w-[560px] items-center gap-3 overflow-hidden rounded-xl bg-[var(--surface)] px-3 whitespace-nowrap text-[var(--surface-foreground)] shadow-[0_2px_8px_rgb(0_0_0/0.10)]'
    >
      {hints.map((hint, index) => (
        <Fragment key={hint.action}>
          {index > 0 && <span aria-hidden='true' className='h-3 w-px shrink-0 bg-[var(--border)]' />}
          <span className='inline-flex items-center gap-1.5 text-[13px]'>
            {hint.action}
            <KeyHintKey hint={hint} />
          </span>
        </Fragment>
      ))}
    </div>
  );
};

/**
 * Правая половина пары. Клавиша — в рамке без заливки: минимум 22×20px, рамка 1px `--border`, моношрифт 11px.
 *
 * **Радиус 8px, а не 6px из поставки.** Шкала радиусов проекта — 8/12/24 (`docs/ui/guidelines.md`), 6px там нет;
 * аудит поставки (`docs/ui/handoffs/planner/README-audit.md`, «Что осталось» п. 8) требует «либо привести к шкале,
 * либо объявить расхождением» — приводим к шкале.
 *
 * Мышиный жест — иконкой мыши с подсвеченной кнопкой, а не словами «правая кнопка» (handoff, «Что показывает»).
 * Пара без клавиши (формы `+N` / `−N`) рисуется одним текстом действия.
 */
const KeyHintKey: React.FC<{ hint: KeyHint }> = ({ hint }) => {
  if (hint.key === undefined) return null;
  if (typeof hint.key !== 'string') {
    return (
      <>
        <MouseRightButtonIcon size={16} />
        {/* Иконка `aria-hidden`, а полоса — `aria-live`: без текстовой пары скринридер прочитал бы жест как пустоту. */}
        <span className='sr-only'>правая кнопка мыши</span>
      </>
    );
  }
  return (
    <kbd className='inline-flex h-5 min-w-[22px] shrink-0 items-center justify-center rounded-lg border border-[var(--border)] px-1.5 font-mono text-[11px] leading-none'>
      {hint.key}
    </kbd>
  );
};
