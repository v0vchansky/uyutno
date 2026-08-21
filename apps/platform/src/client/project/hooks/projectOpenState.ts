import type { PlannerDocument } from '@uyutno/planner/format';

import type { ProjectDto } from '../../../shared/projects';
import type { ProjectDocumentResult } from '../api/getProjectDocument';

/** Номер фазы для индикатора «Шаг N из 2» (handoff, «Состояния экрана · оболочка»). */
export type ProjectOpenPhase = 1 | 2;

/**
 * Чем закончилось открытие `/project/:id`. Ровно один экран на состояние — полузагруженного редактора
 * не бывает (спека 10, «Load проекта»).
 */
export type ProjectOpenState =
  | { kind: 'loading'; phase: ProjectOpenPhase }
  /** Чужой, удалённый или несуществующий проект — 404-страница, а не модалка редактора. */
  | { kind: 'not-found' }
  /** Битый документ или отказ транспорта — модалка «Не удалось открыть проект» с повтором. */
  | { kind: 'failed' }
  /** Документ записан более новым бандлом — предложение перезагрузить страницу (ADR 0021). */
  | { kind: 'unsupported-version' }
  /** Можно поднимать сцену; `document === null` — новый проект, пустой холст. */
  | { kind: 'open'; document: PlannerDocument | null };

interface ProjectOpenInput {
  /** Фаза 1 — карточка проекта: имя для шапки и он же признак «проект существует и он ваш». */
  card: { isPending: boolean; isError: boolean; project: ProjectDto | undefined };
  /** Фаза 2 — документ; `isFetching` поднят и на повторе после ошибки, поэтому проверяется первым. */
  document: { isFetching: boolean; isError: boolean; result: ProjectDocumentResult | undefined };
}

/**
 * Свод двух запросов открытия в один экран. Вынесен отдельной чистой функцией: порядок веток здесь —
 * продуктовое правило (что важнее показать), и проверяться он должен без React и без сети.
 *
 * Порядок разбирается сверху вниз и значим целиком:
 * 1. отказ карточки — модалка: без карточки нельзя отличить «нет проекта» от «нет сети»;
 * 2. карточка едет — фаза 1;
 * 3. проекта нет в галерее — 404;
 * 4. документ едет (в том числе **повтор** после ошибки) — фаза 2, индикатор возвращается;
 * 5. дальше — ветки документа один в один по спеке 10.
 */
export const projectOpenState = ({ card, document }: ProjectOpenInput): ProjectOpenState => {
  if (card.isError) return { kind: 'failed' };
  if (card.isPending) return { kind: 'loading', phase: 1 };
  if (!card.project) return { kind: 'not-found' };

  if (document.isFetching) return { kind: 'loading', phase: 2 };
  if (document.isError) return { kind: 'failed' };
  if (document.result === undefined) return { kind: 'loading', phase: 2 };

  switch (document.result.kind) {
    case 'loaded':
      return { kind: 'open', document: document.result.document };
    case 'empty':
      return { kind: 'open', document: null };
    case 'not-found':
      return { kind: 'not-found' };
    case 'unsupported-version':
      return { kind: 'unsupported-version' };
    default:
      return { kind: 'failed' };
  }
};

/**
 * Есть ли что вписывать в кадр. Камера конструктора в документ не пишется (ADR 0020), поэтому при
 * открытии она встаёт авто-fit'ом «в центр» — но **только у непустого плана**: пустому положено остаться
 * на дефолтном зуме (ADR 0021, «Камера при открытии»).
 *
 * Признак — наличие точек, а не контуров: точка есть у любой геометрии плана, и вписывать габариты
 * `fitToContent` умеет именно по точкам этажа.
 */
export const hasPlan = (document: PlannerDocument | null): boolean =>
  document !== null && document.floors.some(floor => Object.keys(floor.layout.points).length > 0);
