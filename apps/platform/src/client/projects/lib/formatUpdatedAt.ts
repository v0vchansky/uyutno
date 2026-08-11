import { format, isSameDay, isSameYear, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';

/**
 * Форматирует ISO-дату «последнее изменение» в человеческий вид согласно
 * `docs/ui/handoffs/projects/projects-screen.md`:
 *
 * - «изменён сегодня в 14:32» — тот же день.
 * - «изменён вчера» — вчера.
 * - «изменён 3 августа» — этот год, не сегодня и не вчера.
 * - «изменён 12 марта 2025» — прошлый год или старше.
 */
export const formatUpdatedAt = (iso: string, now: Date = new Date()): string => {
  const date = new Date(iso);

  if (isSameDay(date, now)) {
    const time = format(date, 'HH:mm', { locale: ru });
    return `изменён сегодня в ${time}`;
  }

  const yesterday = subDays(now, 1);
  if (isSameDay(date, yesterday)) {
    return 'изменён вчера';
  }

  if (isSameYear(date, now)) {
    return `изменён ${format(date, 'd MMMM', { locale: ru })}`;
  }

  return `изменён ${format(date, 'd MMMM yyyy', { locale: ru })}`;
};
