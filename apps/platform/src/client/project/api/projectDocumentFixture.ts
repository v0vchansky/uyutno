import { DOCUMENT_FORMAT, DOCUMENT_VERSION, type PlannerDocument } from '@uyutno/planner/format';

/**
 * Документ в формате сейва для тестов транспорта (`getProjectDocument`, `saveProjectDocument`,
 * `projectStorage`). Строится литералом, а не `createEmptyDocument`: фабрика пустого проекта в публичный
 * вход пакета не входит (`@uyutno/planner` отдаёт форму документа, но не генератор id), а тестам нужен
 * ещё и **непустой** план — тот, на котором проверяется авто-fit и чистка битых ссылок.
 *
 * Живёт файлом рядом, а не внутри одного из тестов: его читают три `*.test.ts` в двух директориях.
 */
export const emptyDocumentFixture = (): PlannerDocument => ({
  format: DOCUMENT_FORMAT,
  version: DOCUMENT_VERSION,
  settings: { units: 'cm', wallHeight: 280 },
  view: {
    activeView: 'constructor',
    cameras: {
      plan: { x: 0, y: 0, zoom: 0.5 },
      orbit: { x: 0, y: 0, elevation: 110, pan: 45, tilt: 45, zoom: 0.1 },
      walk: { x: 0, y: 0, pan: 0, tilt: 0 },
    },
  },
  floors: [
    {
      id: 'floor-1',
      layout: { points: {}, contours: [], covers: [], areas: [], cuts: [], rooms: [] },
      scene: { items: [], rulers: [], hidden: [] },
    },
  ],
});

/** Тот же документ с одним квадратным контуром: четыре точки и `outer`-контур по ним. */
export const planDocumentFixture = (): PlannerDocument => {
  const document = emptyDocumentFixture();
  const floor = document.floors[0]!;
  floor.layout.points = {
    a: { id: 'a', x: 0, y: 0 },
    b: { id: 'b', x: 400, y: 0 },
    c: { id: 'c', x: 400, y: 300 },
    d: { id: 'd', x: 0, y: 300 },
  };
  floor.layout.contours = [{ id: 'contour-1', kind: 'outer', points: ['a', 'b', 'c', 'd'] }];
  return document;
};
