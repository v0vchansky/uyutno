import type { DerivedState } from '../../engine/rebuild';

/** Площадь производного — в см²; на показ — м² с запятой и одним знаком (спека 07, решения 18/19). */
const SQUARE_CM_IN_SQUARE_M = 10_000;

const plural = (count: number, one: string, few: string, many: string): string => {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
};

/**
 * Текстовое описание плана для `aria-label` холста конструктора (решение 22, эталон холста «Доступность»):
 * «план: 3 комнаты, 45 м²». Обновляется при изменении геометрии. Пустой план описывается тем же шаблоном,
 * отдельной формулировки для него в поставке нет.
 */
export const planDescription = (derived: DerivedState | null): string => {
  const rooms = derived?.floors[0]?.rooms ?? [];
  const area = rooms.reduce((sum, room) => sum + room.area, 0) / SQUARE_CM_IN_SQUARE_M;
  const areaText = area.toFixed(1).replace('.', ',');
  return `план: ${rooms.length} ${plural(rooms.length, 'комната', 'комнаты', 'комнат')}, ${areaText} м²`;
};
