import { Check, TriangleAlert, WifiOff } from 'lucide-react';
import type React from 'react';

import type { SaveIndicatorView } from '../../hooks/saveIndicatorState';

/**
 * Цвет ошибки — тот же, что у деструктивных действий платформы в наведении (`#9F3226` в
 * `DeleteProjectModal`), и он же стоит в кадрах `s3` прототипа. Отдельного токена `--danger` в теме нет:
 * HeroUI-переменные его не заводят, а выдумывать имя ради двух состояний шапки незачем.
 */
const DANGER = '#9F3226';

interface Props {
  view: SaveIndicatorView;
}

/**
 * Индикатор состояния сохранения в шапке (задача 0084; handoff
 * `docs/ui/handoffs/planner/planner-editor-ui.md`, «Индикатор состояния сохранения»; прототип
 * `Planner Editor Shell.dc.html`, кадры `s3`).
 *
 * Живёт в слоте шапки слева от кнопки «Сохранить». В покое, во время записи и на демо возвращает `null`,
 * а не пустой элемент: слот стоит внутри группы с `gap: 12px`, и пустой флекс-элемент съел бы лишний
 * промежуток, сдвинув кнопку с аватаром (то же требование записано в `EditorHeader`).
 *
 * `role="status"` — это и есть требуемая макетом живая область `aria-live="polite"` (handoff,
 * «Доступность · оболочка»); `aria-live` продублирован явно, потому что норматив называет именно его.
 * Область появляется вместе с текстом, а не висит пустой, — цена того же правила про `gap`.
 *
 * **Ошибка фонового сохранения — тихая иконка и ничего больше**: ни модалки, ни тоста (принцип «ручное
 * действие → модалка, фоновое → иконка или молчание»). У неё `role="img"` с `aria-label` в дополнение к
 * `title`: тултип по наведению недоступен с клавиатуры.
 */
export const SaveStatusIndicator: React.FC<Props> = ({ view }) => {
  if (view.kind === 'none') return null;

  if (view.kind === 'error') {
    return (
      <span role='status' aria-live='polite' className='inline-flex shrink-0 items-center'>
        <span
          role='img'
          aria-label={view.label}
          title={view.tooltip}
          className='inline-flex size-6 cursor-default items-center justify-center'
          style={{ color: DANGER }}
        >
          <TriangleAlert size={16} aria-hidden='true' />
        </span>
      </span>
    );
  }

  if (view.kind === 'offline') {
    return (
      <span
        role='status'
        aria-live='polite'
        className='inline-flex shrink-0 items-center gap-1.5 text-[12px] whitespace-nowrap'
        style={{ color: DANGER }}
      >
        <WifiOff size={16} aria-hidden='true' />
        {view.label}
      </span>
    );
  }

  return (
    <span
      role='status'
      aria-live='polite'
      className='inline-flex shrink-0 items-center gap-1.5 text-[12px] whitespace-nowrap text-[color:var(--muted)]'
    >
      {/* Иконка одна на оба успеха — различают их слово и её цвет: акцент у ручного, приглушённый у авто. */}
      <Check
        size={16}
        aria-hidden='true'
        className={view.reason === 'manual' ? 'text-[color:var(--accent)]' : undefined}
      />
      {view.label}
    </span>
  );
};
