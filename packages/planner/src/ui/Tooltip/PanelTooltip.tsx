import type React from 'react';
import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * Тултип кнопок скина (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Тултипы»): иконка без подписи
 * обязана его иметь — это весь рейл, кнопки истории и группа контролов холста. Формат — две строки: название
 * бытовым языком и пояснение или клавиша.
 *
 * **Почему свой, а не HeroUI.** Бриф прямо говорит: «тултипов, тостов и спиннеров как готовых компонентов в
 * проекте пока нет — если они нужны редактору, их нужно спроектировать» (`docs/ui/briefs/planner-editor.md`,
 * разд. 3); меню, поповеры и нижние листы на платформе тоже написаны вручную. Плюс `@heroui/react` объявляет
 * только ESM-условие в `exports`, поэтому CJS-резолвер Jest (ADR 0014) его не находит — jsdom-тесты скина на нём
 * не поднялись бы вовсе.
 *
 * Геометрия по handoff'у: тёмная плашка `--foreground`, белый текст 12px, радиус 8px, padding 8px 12px,
 * максимум 260px, тень плавающей панели, стрелка в сторону кнопки, задержка появления 400ms, скрытие мгновенное.
 * На `focus-visible` тултип показывается так же, как на наведении.
 *
 * Плашка позиционируется `position: fixed` по `getBoundingClientRect()` кнопки, а не абсолютом внутри обёртки:
 * панель инструментов при нехватке высоты скроллится внутри себя (`overflow-y-auto`), и абсолютная плашка
 * обрезалась бы её рамкой.
 *
 * **Скролл и ресайз плашку прячут.** Координаты снимаются один раз, в момент показа, а дальше плашка живёт в
 * `position: fixed` и за кнопкой не едет: прокрути панель внутри себя или измени размер окна — и она осталась бы
 * висеть на старом месте. Поэтому, пока плашка показана, на окне висят слушатели `scroll` (с `capture: true` —
 * скролл предка не всплывает, его ловят только на фазе перехвата) и `resize`, и любой из них плашку убирает:
 * честнее показать её заново по новому наведению, чем пересчитывать координаты на каждый кадр прокрутки.
 * Слушатели живут ровно столько, сколько плашка, и снимаются в cleanup эффекта. Клавиатурных слушателей здесь
 * нет ни одного и быть не может: единственный владелец клавиатуры — `projection/input/keyboard.ts` (ADR 0019 E5).
 *
 * **Обёртка — `display: contents`, и у `disabled`-кнопок тултипа не будет.** Своего бокса у обёртки нет
 * намеренно: строки инструментов растянуты на всю ширину панели, и реальный бокс вокруг них сломал бы раскладку.
 * Плата за это — pointer-события приходят только от самой кнопки, а выключенная кнопка их не диспатчит вовсе:
 * у `disabled` «Отменить» и «Повторить» тултип не покажется. Это принятый размен, а не недосмотр: раскладка
 * панели дороже подсказки на кнопке, которая всё равно ничего не делает, а что именно делают отмена и повтор,
 * сказано полосой подсказки клавиш.
 *
 * Вторая строка в поставке задана сырым `#D4D4D4` (аудит поставки, «Что осталось» п. 7). Сырой HEX в код не
 * переносится: цвет выводится из самой плашки — `text-white/70` на `--foreground`, то есть роль «приглушённый
 * текст на тёмном», а не новый токен.
 *
 * Тултип и полоса подсказки клавиш не дублируются: тултип объясняет кнопку по наведению, полоса перечисляет
 * клавиши текущего состояния и появляется сама.
 */
export interface PanelTooltipProps {
  /** Первая строка — название бытовым языком. Совпадает с `aria-label` кнопки, поэтому дублем не становится. */
  title: string;
  /** Вторая строка — пояснение или горячая клавиша; без неё тултип однострочный. */
  hint?: string;
  /** Сторона относительно кнопки: рейл — `right`, панель — `bottom`/`right`, контролы холста — `top`. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Ровно один элемент-триггер: пока плашка показана, ему ставится `aria-describedby` на неё — вторая строка
   * достаётся и скринридеру. В покое атрибута нет: ссылаться было бы не на что. */
  children: React.ReactNode;
}

/** Задержка появления по handoff'у; скрытие мгновенное. */
const SHOW_DELAY_MS = 400;
/** Зазор между кнопкой и плашкой, px — половина стрелки плюс воздух. */
const GAP = 8;

interface Anchor {
  left: number;
  top: number;
  translate: string;
  arrow: string;
}

const anchorOf = (box: DOMRect, placement: NonNullable<PanelTooltipProps['placement']>): Anchor => {
  switch (placement) {
    case 'top':
      return {
        left: box.left + box.width / 2,
        top: box.top - GAP,
        translate: 'translate(-50%, -100%)',
        arrow: 'left-1/2 top-full -translate-x-1/2 -translate-y-1/2',
      };
    case 'bottom':
      return {
        left: box.left + box.width / 2,
        top: box.bottom + GAP,
        translate: 'translate(-50%, 0)',
        arrow: 'left-1/2 bottom-full -translate-x-1/2 translate-y-1/2',
      };
    case 'left':
      return {
        left: box.left - GAP,
        top: box.top + box.height / 2,
        translate: 'translate(-100%, -50%)',
        arrow: 'top-1/2 left-full -translate-y-1/2 -translate-x-1/2',
      };
    case 'right':
      return {
        left: box.right + GAP,
        top: box.top + box.height / 2,
        translate: 'translate(0, -50%)',
        arrow: 'top-1/2 right-full -translate-y-1/2 translate-x-1/2',
      };
  }
};

export const PanelTooltip: React.FC<PanelTooltipProps> = ({ title, hint, placement = 'top', children }) => {
  const wrapper = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const id = useId();

  const hide = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setAnchor(null);
  }, []);

  const show = useCallback((): void => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      // Обёртка — `display: contents`, своей геометрии у неё нет: меряется сама кнопка.
      const trigger = wrapper.current?.firstElementChild;
      if (trigger) setAnchor(anchorOf(trigger.getBoundingClientRect(), placement));
    }, SHOW_DELAY_MS);
  }, [placement]);

  useEffect(() => hide, [hide]);

  // Плашка приколота к координатам момента показа: любой сдвиг под ней — прокрутка предка или ресайз окна —
  // делает её ложью, поэтому она просто убирается. Слушатели живут ровно столько, сколько сама плашка.
  useEffect(() => {
    if (anchor === null) return;

    window.addEventListener('scroll', hide, { capture: true });
    window.addEventListener('resize', hide);

    return () => {
      window.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('resize', hide);
    };
  }, [anchor, hide]);

  // `aria-describedby` ставится только вместе с плашкой: без неё элемента с таким `id` в документе нет, и ссылка
  // повисла бы в пустоту — скринридер объявил бы кнопку с оборванным описанием.
  const described =
    isValidElement(children) && anchor !== null
      ? cloneElement(children as React.ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': id })
      : children;

  return (
    <span
      ref={wrapper}
      className='contents'
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={event => {
        // Клавиатурный обход показывает тултип, клик по кнопке — нет: иначе плашка висела бы после нажатия.
        if (event.target instanceof Element && event.target.matches(':focus-visible')) show();
      }}
      onBlur={hide}
    >
      {described}
      {anchor && (
        <span
          id={id}
          role='tooltip'
          style={{ left: anchor.left, top: anchor.top, transform: anchor.translate }}
          className='pointer-events-none fixed z-50 max-w-[260px] rounded-lg bg-[var(--foreground)] px-3 py-2 text-xs leading-4 text-white shadow-[0_2px_8px_rgb(0_0_0/0.10)]'
        >
          <span className={`absolute size-2 rotate-45 bg-[var(--foreground)] ${anchor.arrow}`} />
          <span className='relative block font-medium'>{title}</span>
          {hint ? <span className='relative mt-0.5 block text-white/70'>{hint}</span> : null}
        </span>
      )}
    </span>
  );
};
