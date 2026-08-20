import type React from 'react';

import type { PlannerDocument } from '../../document/PlannerDocument';
import type { ToolState } from '../../engine/tools/ToolState';
import { usePlannerSelector } from '../usePlannerSelector';

/**
 * Строка первого шага на пустом холсте (решение 1 брифа `docs/ui/briefs/planner-editor.md`, P0.1; handoff
 * `docs/ui/handoffs/planner/planner-editor-ui.md`, «Состояния экрана»): «Чистый холст без сетки плюс строка
 * первого шага по центру… Исчезает после первой поставленной точки. Ни модалки, ни coach-marks».
 *
 * Сетки на чертёжном холсте нет и не будет (она обещала бы привязку к сетке, которой не существует), поэтому
 * пустой холст без этой строки не сообщает пользователю вообще ничего — с неё начинается каждый новый проект.
 * Рисует её DOM, а не Canvas 2D: это элемент интерфейса, а не чертёжная графика (ADR 0020, «Что рисует»).
 */

/**
 * Холст пуст — ни одной точки ни в документе, ни в рисуемом контуре. Чистая функция: «первая поставленная точка»
 * во время рисования живёт в состоянии автомата и попадает в документ только на коммите контура (ADR 0019 E3),
 * поэтому одного документа мало.
 */
export const isCanvasEmpty = (document: PlannerDocument, tools: ToolState): boolean => {
  for (const floor of document.floors) {
    // `for…in` вместо `Object.keys().length`: селектор пересчитывается на каждое событие шины, а `tools:changed`
    // летит на каждый `pointerMove` — массив ключей на план в тысячу точек здесь строился бы на каждый кадр мыши.
    for (const _ in floor.layout.points) return false;
  }
  switch (tools.kind) {
    case 'making-walls':
    case 'making-room':
      return tools.points.length === 0;
    case 'making-rect':
      return tools.origin === null;
    default:
      return true;
  }
};

export const FirstStepHint: React.FC = () => {
  const empty = usePlannerSelector(manager => isCanvasEmpty(manager.document.get(), manager.tools.get()));
  if (!empty) return null;

  return (
    <p className='absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[13px] text-[var(--muted)]'>
      Выберите инструмент и поставьте первую точку
    </p>
  );
};
