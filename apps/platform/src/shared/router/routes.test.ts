import { Route, isKnownPagePath, projectRoute } from './routes';

/**
 * `isKnownPagePath` — единственный источник «эта страница существует» для серверной 404-обвязки
 * (`server/application/pageRoutes.ts`). Путь, которого нет в enum `Route`, отдаётся со статусом 404, даже если
 * клиентский роутер что-то на нём рисует, — поэтому регрессия держит связку «enum → матчер», а не сам матчер.
 */
describe('isKnownPagePath', () => {
  it.each([Route.Home, Route.Login, Route.Register, Route.ForgotPassword, Route.ResetPassword, Route.Projects])(
    '%s — известная страница',
    path => {
      expect(isKnownPagePath(path)).toBe(true);
    },
  );

  it('подставленный id в /project/:id матчится', () => {
    expect(isKnownPagePath(projectRoute('01890abc'))).toBe(true);
  });

  it('/demo известен — иначе кнопка «Посмотреть пример» и ссылка подвала ведут в 404 (задача 0092)', () => {
    expect(isKnownPagePath(Route.Demo)).toBe(true);
    expect(isKnownPagePath('/demo')).toBe(true);
  });

  it.each(['/unknown-path', '/project/01890abc/unknown-segment', '/demo/extra'])('%s — не страница', path => {
    expect(isKnownPagePath(path)).toBe(false);
  });
});
