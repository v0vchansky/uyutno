import type { PlanPosition } from '../../PlannerDocument';
import { quantize } from '../../quantize';

/** Ключ тождества координат — тот же, что у дедупа вершин триангуляции и дисциплины id (ADR 0017 C1). */
const supportKey = (point: PlanPosition): string => `${quantize(point.x)}|${quantize(point.y)}`;

/**
 * Опора зоны на граф комнат (спека 02 «Пересечения», решение 2026-08-17; ADR 0017 C9, Q22): точка зоны
 * опёрта, если существует точка комнаты с **той же координатой**. Допуск — шаг квантования координат
 * (0.001 см), а не 10-см снап: снап «точка к углу» работает только при рисовании зоны, а на авто-пересборке
 * зона обязана буквально сидеть на вершинах комнат — «приснапленной к графу».
 *
 * Тождество проверяется **ключом квантованных координат**, а не эпсилоном: третьего эпсилона ядру не нужно
 * (README), а `pointsMatch(…, 0.001)` на этом пороге ещё и врал бы — `10.001 − 10` в double даёт
 * `0.0009999…`, то есть ровно один квант расхождения читался бы как совпадение. Ключ — тот же приём, что
 * у дедупа вершин в `triangulateContours` и у дисциплины id в `normalize`, и он же даёт O(1) поиск.
 *
 * Достаточно одной неопёртой точки, чтобы зона удалялась целиком — частичной подгонки не бывает (спека 02).
 * Пустой контур зоны опоры не имеет (`false`): «держаться не за что» честнее вакуумной истины `every` на
 * пустом наборе. Вход не мутируется, `roomPoints` перебирается один раз.
 */
export const areaSupported = (areaPoints: readonly PlanPosition[], roomPoints: Iterable<PlanPosition>): boolean => {
  if (areaPoints.length === 0) return false;
  const anchors = new Set<string>();
  for (const point of roomPoints) anchors.add(supportKey(point));
  return areaPoints.every(point => anchors.has(supportKey(point)));
};
