import type React from 'react';

import { polygonCentroid } from '../../document/geometry/measure/roomAnchor';
import { planToView, type Viewport } from '../../document/geometry/viewport';
import type { Id } from '../../document/id';
import type { FloorLayout, PlanPosition } from '../../document/PlannerDocument';
import type { DerivedFloor } from '../../engine/rebuild';
import { formatArea } from './formatLength';

/**
 * Подписи комнат — имя и площадь в центре комнаты (handoff `docs/ui/handoffs/planner/planner-editor-ui.md`,
 * «Подписи»; спека 07 «Автоматические размеры на стенах»: «независимый DOM-оверлей со своими флагами
 * видимости»). Не поворачиваются, кликов не принимают, площадь всегда в м² и от переключателя единиц не
 * зависит (спека 07 «Единицы измерения»).
 *
 * Комната без имени подписывается только площадью — пустая строка имени в документе означает «имени нет»
 * (`normalize` даёт новым комнатам `name: ''`).
 *
 * **Правило коллизии подписей не реализовано** (handoff «Коллизия»: подпись комнаты уступает подписям сторон,
 * сначала гаснет имя, затем площадь). Оно требует измерения фактических текстовых боксов обеих подписей —
 * это отдельная механика с чтением layout'а DOM; вынесено в Заметки задачи 0060.
 */
export interface RoomLabelsProps {
  layout: FloorLayout;
  derived: DerivedFloor | null;
  viewport: Viewport;
  /** Live-позиции точек при драге (`ToolState.pointOverrides`): подпись едет вместе с геометрией. */
  overrides: Readonly<Record<Id, PlanPosition>> | null;
  showName: boolean;
  showArea: boolean;
}

const NAME_STYLE: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: 'var(--foreground)' };
const AREA_STYLE: React.CSSProperties = { fontSize: 12, color: 'var(--muted)' };

/** Запасной якорь, когда площадь вырождена: центр bbox обвода — он определён у любых двух и более точек. */
const boundsCenter = (points: readonly PlanPosition[]): PlanPosition | null => {
  const first = points[0];
  if (!first) return null;
  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  return Number.isFinite(center.x) && Number.isFinite(center.y) ? center : null;
};

export const RoomLabels: React.FC<RoomLabelsProps> = ({ layout, derived, viewport, overrides, showName, showArea }) => {
  if (!derived || (!showName && !showArea)) return null;

  return (
    <>
      {derived.rooms.map(room => {
        const outline: PlanPosition[] = [];
        for (const id of room.outline) {
          const position = overrides?.[id] ?? layout.points[id];
          // Точка пропала — документ и производное разъехались; комната пропускается, как в `drawFrame`.
          if (!position) return null;
          outline.push(position);
        }
        const anchor = polygonCentroid(outline) ?? boundsCenter(outline);
        if (!anchor) return null;

        const name = layout.rooms.find(record => record.id === room.roomId)?.name ?? '';
        const withName = showName && name !== '';
        if (!withName && !showArea) return null;

        const { x, y } = planToView(viewport, anchor);
        return (
          <div
            key={room.roomId}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {withName && <div style={NAME_STYLE}>{name}</div>}
            {showArea && <div style={AREA_STYLE}>{formatArea(room.area)} м²</div>}
          </div>
        );
      })}
    </>
  );
};
