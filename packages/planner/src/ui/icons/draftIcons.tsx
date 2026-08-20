import type React from 'react';

/**
 * Иконки, которых нет в Lucide: чертёжные инструменты, тумблеры снапа, виды и мышь для полосы подсказок
 * (решение 6 брифа `docs/ui/briefs/planner-editor.md`, handoff «Иконки»). Рисуются **в метрике Lucide**:
 * сетка `24×24`, `stroke-width: 2`, скруглённые концы и стыки, `currentColor`, без заливок — кроме
 * точек-маркеров «Комнаты по точкам» и подсвеченной кнопки мыши, где заливка и есть смысл иконки.
 *
 * **Штрих 2, а не 1.5.** Текст handoff'а закрепляет 1.5, но гайдлайн (`docs/ui/guidelines.md`, «Иконки»)
 * требует «толщина по умолчанию (`strokeWidth={2}`) — оставляем, не крутим», а решение 6 — «та же толщина»,
 * что у Lucide. В одной панели рядом стоят готовые `lucide-react` со штрихом 2 — два веса читались бы как
 * дефект вёрстки. Расхождение зафиксировано в «Заметках» задачи 0061 и в аудите поставки
 * (`docs/ui/handoffs/planner/README-audit.md`, «Что осталось» п. 3).
 *
 * Второго icon-набора это не создаёт: гайдлайн разрешает свои SVG ровно для того, чего в наборе нет.
 */

/** Пропсы совпадают с `lucide-react`: размер одним числом, цвет — через `currentColor`. */
export interface DraftIconProps {
  /** Сторона квадрата в px; по умолчанию 24, как у Lucide. */
  size?: number;
  className?: string;
}

const base = (size: number): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
});

/** Инструмент «Стены»: угол ленты стены — внешняя грань, внутренняя грань и два торца. */
export const WallsToolIcon: React.FC<DraftIconProps> = ({ size = 24, className }) => (
  <svg {...base(size)} className={className}>
    <path d='M4 20V8h12' />
    <path d='M8 20v-8h8' />
    <path d='M4 20h4' />
    <path d='M16 8v4' />
  </svg>
);

/** Инструмент «Прямоугольная комната»: полая комната — внешний и внутренний контуры. */
export const RectRoomToolIcon: React.FC<DraftIconProps> = ({ size = 24, className }) => (
  <svg {...base(size)} className={className}>
    <rect x='3' y='4' width='18' height='16' rx='1' />
    <rect x='7' y='8' width='10' height='8' rx='1' />
  </svg>
);

/** Инструмент «Комната по точкам»: полигон без толщины и маркеры вершин (единственная разрешённая заливка). */
export const PolyRoomToolIcon: React.FC<DraftIconProps> = ({ size = 24, className }) => (
  <svg {...base(size)} className={className}>
    <path d='M5 5l14 3-2 11-13-3z' />
    <circle cx='5' cy='5' r='1.6' fill='currentColor' stroke='none' />
    <circle cx='19' cy='8' r='1.6' fill='currentColor' stroke='none' />
    <circle cx='17' cy='19' r='1.6' fill='currentColor' stroke='none' />
    <circle cx='4' cy='16' r='1.6' fill='currentColor' stroke='none' />
  </svg>
);

/** Тумблер `pointsSnap` — «липнуть к углам»: угол контура и кольцо захвата вокруг вершины. */
export const PointsSnapIcon: React.FC<DraftIconProps> = ({ size = 24, className }) => (
  <svg {...base(size)} className={className}>
    <path d='M6 20V8h12' />
    <circle cx='6' cy='8' r='3' />
  </svg>
);

/** Тумблер `pointsAlign` — «оси через точки»: вертикаль и горизонталь пунктиром через вершину плана. */
export const PointsAlignIcon: React.FC<DraftIconProps> = ({ size = 24, className }) => (
  <svg {...base(size)} className={className}>
    <path d='M12 3v18' strokeDasharray='3 3' />
    <path d='M3 12h18' strokeDasharray='3 3' />
    <circle cx='12' cy='12' r='2' fill='currentColor' stroke='none' />
  </svg>
);

/** Тумблер `orthoAlign` — «ровно по горизонтали и вертикали»: прямой угол с уголковым маркером. */
export const OrthoAlignIcon: React.FC<DraftIconProps> = ({ size = 24, className }) => (
  <svg {...base(size)} className={className}>
    <path d='M5 4v15h15' />
    <path d='M5 13h6v6' />
  </svg>
);

/**
 * Тумблер `bisectorAlign` — «по центру угла»: раскрытый угол и пунктирная биссектриса ровно посередине.
 * Угол раскрыт широко (вершина слева, лучи в противоположные стороны), иначе на 20px три линии из одной точки
 * сливаются в кляксу.
 */
export const BisectorAlignIcon: React.FC<DraftIconProps> = ({ size = 24, className }) => (
  <svg {...base(size)} className={className}>
    <path d='M4 12L20 4' />
    <path d='M4 12l16 8' />
    <path d='M4 12h15' strokeDasharray='3 3' />
  </svg>
);

/** Вид «Конструктор стен»: план с перегородкой и кружком-хендлом на узле. */
export const ConstructorViewIcon: React.FC<DraftIconProps> = ({ size = 24, className }) => (
  <svg {...base(size)} className={className}>
    <rect x='3' y='4' width='18' height='16' rx='1' />
    <path d='M3 11h18' />
    <path d='M11 11v9' />
    <circle cx='11' cy='11' r='2.4' />
  </svg>
);

/** Вид «2D-план»: тот же план сверху, но с мебелью и без хендлов. */
export const PlanViewIcon: React.FC<DraftIconProps> = ({ size = 24, className }) => (
  <svg {...base(size)} className={className}>
    <rect x='3' y='4' width='18' height='16' rx='1' />
    <path d='M3 11h18' />
    <path d='M13 11v9' />
    <rect x='5.5' y='13' width='5' height='4.5' rx='1' fill='currentColor' stroke='none' />
  </svg>
);

/** Полоса подсказок: мышь с подсвеченной правой кнопкой — жест показывается иконкой, а не словом «ПКМ». */
export const MouseRightButtonIcon: React.FC<DraftIconProps> = ({ size = 24, className }) => (
  <svg {...base(size)} className={className}>
    <path d='M12 3a6 6 0 0 1 6 6H12z' fill='currentColor' stroke='none' />
    <rect x='6' y='3' width='12' height='18' rx='6' />
    <path d='M12 3v6' />
    <path d='M6 9h12' />
  </svg>
);
