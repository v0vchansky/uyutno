import type React from 'react';

import {
  type LabelVisibility,
  usePlannerLabelVisibility,
  useSetPlannerLabelVisibility,
} from '../PlannerOverlayContext';

/**
 * Группа «Подписи» панели инструментов (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`, «Панель
 * инструментов»): три переключателя 32px — «Размеры», «Имя комнаты», «Площадь», все включены по умолчанию.
 * Отдаёт только строки: заголовок группы и обёртку рисует `ToolPanel`, чтобы стиль заголовка жил в одном месте.
 *
 * Флаги живут в скине (`ui/PlannerOverlayContext.tsx`), а не в документе: `DocumentSettings` — это
 * `{ units, wallHeight }`, команды под видимость подписей в фасаде нет, а «Персистентность» спеки
 * `docs/product/features/planner/07-measurements.md` ждёт своего шага. Рисует подписи оверлей размеров
 * (`ui/LengthInputs/`), он читает те же флаги — панель их только переключает.
 *
 * Вне `PlannerOverlayProvider` хуки контекста отдают дефолт и no-op-сеттер: группа рисуется включённой, клик
 * ничего не меняет и ничего не роняет.
 */

/** Строка переключателя: видимая подпись — она же доступный ярлык (`role="switch"` берёт имя из содержимого). */
interface LabelRow {
  key: keyof LabelVisibility;
  title: string;
}

/** Порядок — из handoff'а. Четвёртая подпись (например, «Площадь стен») встаёт новым элементом массива. */
const LABEL_ROWS: readonly LabelRow[] = [
  { key: 'dimensions', title: 'Размеры' },
  { key: 'roomName', title: 'Имя комнаты' },
  { key: 'roomArea', title: 'Площадь' },
];

/**
 * Строка 32px, радиус 8px, подпись 14px слева, переключатель справа (handoff). Кольцо фокуса — акцентное, как
 * всюду в редакторе; «наведение» в поставке не задано — добор за дизайн существующей ролью темы
 * `--surface-secondary` (аудит `docs/ui/handoffs/planner/README-audit.md`, «Что осталось» п. 4), тем же, что у
 * остальных строк панели. `cursor-pointer` — явно: preflight Tailwind v4 ставит `button { cursor: default }`,
 * курсор над кликабельным задаётся руками, как всюду на платформе.
 */
const TOGGLE_ROW_CLASS =
  'flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm text-[var(--surface-foreground)] ' +
  'hover:bg-[var(--surface-secondary)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]';

/**
 * Дорожка 32×18px с полем 2px по кругу под ползунок 14px (handoff). Включённая — `--accent`.
 *
 * **Выключенное положение в поставке не задано** (аудит, «Что осталось» п. 5) — добор за дизайн: существующая
 * роль темы `--surface-tertiary`, а не новый цвет. Это заглушка до ответа дизайна, а не норма.
 */
const TRACK_CLASS = 'ml-auto flex h-[18px] w-8 shrink-0 items-center rounded-full p-0.5';
const TRACK_ON_CLASS = 'bg-[var(--accent)]';
const TRACK_OFF_CLASS = 'bg-[var(--surface-tertiary)]';

/** Ползунок 14px белый; сдвиг вправо = 32 − 2 − 2 − 14 = 14px. */
const THUMB_CLASS = 'h-3.5 w-3.5 rounded-full bg-[var(--surface)] transition-transform';

export const LabelToggles: React.FC = () => {
  const visibility = usePlannerLabelVisibility();
  const setVisibility = useSetPlannerLabelVisibility();

  return (
    <>
      {LABEL_ROWS.map(row => {
        const on = visibility[row.key];
        // Клик по строке и клик по дорожке — одно и то же событие: дорожка декоративна, кнопкой является строка.
        const patch: Partial<LabelVisibility> = { [row.key]: !on };
        return (
          <button
            key={row.key}
            type='button'
            role='switch'
            aria-checked={on}
            onClick={() => setVisibility(patch)}
            className={TOGGLE_ROW_CLASS}
          >
            <span className='truncate'>{row.title}</span>
            <span aria-hidden className={`${TRACK_CLASS} ${on ? TRACK_ON_CLASS : TRACK_OFF_CLASS}`}>
              <span className={`${THUMB_CLASS} ${on ? 'translate-x-3.5' : 'translate-x-0'}`} />
            </span>
          </button>
        );
      })}
    </>
  );
};
