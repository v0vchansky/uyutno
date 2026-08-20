import { compareContoursOnePoint } from '../predicates/compareContours';
import { contourValid } from '../predicates/contourArea';
import { sortByArea } from '../predicates/sortByArea';
import type { ContourSet } from '../triangulate/triangulateContours';

export interface CoverHoles {
  /** `holes[i]` — индексы `inner`, доставшиеся `outer[i]` (порядок — порядок `inner`). */
  holes: number[][];
  /** Индексы `inner` без внешнего пола-хозяина: на удаление (спека 02 «Осиротевшие внутренние полы»). */
  orphans: number[];
}

/**
 * Определение вложенности полов — фаза (6) `normalize` (ADR 0017 C6/C9,
 * [спека 02](../../../../../../docs/product/features/planner/02-rooms-floors-ceilings.md) «Внешний контур
 * пола против дырок в полу», «Порядок обработки полов», «Осиротевшие внутренние полы»).
 *
 * Внешние полы обходятся в порядке `sortByArea` (убывание `|площади|`) с последующим `.reverse()` — ровно
 * приём референса (`findCoverHoles`, верифицировано). Обычно это и есть «от меньшего к большему», и порядок
 * принципиален для случая «комната в комнате»: внутренний пол-вычитание лежит внутри обоих полов, и первым
 * его должен забрать меньший (внутренний) пол, иначе вырез съел бы внешний пол целиком. **Гарантии
 * «меньшие строго первыми» нет:** при разнице площадей меньше `SORT_AREA_EPS` (10 см²) `sortByArea` решает
 * не площадью, а tie-break'ом по bbox, и у вложенных контуров с почти равной площадью порядок задаёт он
 * (у вложенного `minX` больше, поэтому на практике он всё равно оказывается первым). Каждый внешний пол
 * забирает ещё не занятые внутренние — донор расходуется, дырка принадлежит ровно одному хозяину.
 * Не доставшиеся никому — сироты: спека удаляет их («пользователь не увидит висящий в воздухе вырез»),
 * само удаление — стадия 0069.
 *
 * Отношение — `compareContoursOnePoint(outer, inner) == 'contain'`: аппроксимация без рёберных пересечений,
 * корректная ровно потому, что вход — результат `rebuildCovers` (обводы разных групп триангуляции рёбрами
 * не пересекаются). `coincide` (обводы совпали) хозяином не делает — это не вложенность. Контур, не прошедший
 * `contourValid`, не участвует **ни одной стороной**: внутренний не получает хозяина (одноточечный контур
 * одноточечный же тест признал бы вложенным, и мусор жил бы вечно вместо удаления — референс отбраковывает
 * такие полы при создании), внешний не становится хозяином (у контура с `NaN`-координатами тест по точке
 * отвечает «внутри», и живая дырка ушла бы мусорному полу вместо валидного соседа или сирот).
 *
 * Индексы — в системе координат входных массивов; вход не мутируется.
 */
export const findCoverHoles = (outer: ContourSet, inner: ContourSet): CoverHoles => {
  const holes: number[][] = outer.map(() => []);
  // Вырожденный контур хозяина не ищет: он не пол, а мусор — уйдёт вместе с сиротами.
  const claimable = inner.map(contour => contourValid(contour));
  // Вырожденный внешний контур и хозяином не становится: дырка достаётся валидному соседу или уходит в сироты.
  const usable = outer.map(contour => contourValid(contour));
  const owned = inner.map(() => false);
  // sortByArea: убывание |площади|, при разнице < SORT_AREA_EPS — tie-break по bbox; reverse — обычно «меньшие первыми».
  const order = sortByArea(outer.map((points, index) => ({ points, kind: 'outer' as const, index }))).reverse();
  for (const { index } of order) {
    if (!usable[index]) continue;
    for (let i = 0; i < inner.length; i++) {
      if (owned[i] || !claimable[i]) continue;
      if (compareContoursOnePoint(outer[index]!, inner[i]!) !== 'contain') continue;
      owned[i] = true;
      holes[index]!.push(i);
    }
  }
  const orphans: number[] = [];
  owned.forEach((taken, i) => {
    if (!taken) orphans.push(i);
  });
  return { holes, orphans };
};
