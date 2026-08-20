import type { PlanPosition } from '../../PlannerDocument';
import { segmentsOverlay } from '../predicates/segmentsOverlay';
import type { Triangulation } from '../triangulate/triangulateContours';
import { type AreaFace, FACE_COLLINEAR_EPS } from './areaEdges';

/**
 * Индексы fixed-рёбер триангуляции, внесённых **интерьерными** cut-парами зон: ребро лежит вдоль какой-то
 * cut-пары и **не** лежит вдоль грани хранимого контура. Такие рёбра — не барьеры (`rebuildContours`):
 * зона перепартиционирует треугольники комнаты, но новых комнат не порождает (ADR 0017 C6).
 *
 * Сличение — `segmentsOverlay` (коллинеарность + реальный нахлёст), а не «середина на отрезке»: cut-пара,
 * пересечённая гранью стены под прямым углом, серединный тест обманула бы. Порог — `FACE_COLLINEAR_EPS`,
 * а не `L_EPS`: cut-пару дробят `resplitSegments` и `clean-pslg`, и концы под-рёбер (точки T-стыков и
 * пересечений, квантованные до 0.001) лежат на исходной прямой лишь в пределах полукванта по оси.
 * Fixed-рёбра после санитизации PSLG друг друга не пересекают, поэтому «вдоль» здесь однозначно.
 *
 * `faces` — грани хранимых контуров (`contourFaces` от `outer` + `inner`): cut-ребро, совпавшее с гранью,
 * остаётся барьером — это и есть ребро зоны «по стене», настоящая граница комнаты. `bound`/`subtract`
 * (полы) в `faces` не входят: контур пола комнату не делит.
 *
 * Чистая функция, вход не мутируется; пустые `cutPairs` — пустой набор без обхода рёбер.
 */
export const interiorCutEdges = (
  { vertices, edges }: Pick<Triangulation, 'vertices' | 'edges'>,
  cutPairs: readonly (readonly [PlanPosition, PlanPosition])[],
  faces: readonly AreaFace[],
): Set<number> => {
  const result = new Set<number>();
  if (cutPairs.length === 0) return result;
  edges.forEach((edge, index) => {
    if (!edge.fixed) return;
    const a = vertices[edge.a]!;
    const b = vertices[edge.b]!;
    const alongCut = cutPairs.some(([p, q]) => segmentsOverlay(a, b, p, q, FACE_COLLINEAR_EPS));
    if (!alongCut) return;
    const alongFace = faces.some(face => segmentsOverlay(a, b, face.a, face.b, FACE_COLLINEAR_EPS));
    if (!alongFace) result.add(index);
  });
  return result;
};
