import type React from 'react';
import { Route as RouterRoute, Routes } from 'react-router';

import { RedirectIfAuthenticated, RequireAuth } from '@app/auth';
import { NotFoundScreen } from '@app/common';
import { DemoPage, HomePage, LoginPage, RegisterPage } from '@app/landing';
import { ProjectPage } from '@app/project';
import { ProjectsPage } from '@app/projects';

import { Route } from '../../../../shared/router/routes';

export const Router: React.FC = () => {
  return (
    <Routes>
      <RouterRoute path={Route.Home} element={<HomePage />} />
      {/*
       * Демо — вне обеих веток-гардов намеренно: гостю без него не посмотреть продукт (в этом весь смысл ссылки
       * «Посмотреть пример»), а вошедшего уводить с него тоже незачем — страница показывает ему его же проекты.
       */}
      <RouterRoute path={Route.Demo} element={<DemoPage />} />
      <RouterRoute element={<RedirectIfAuthenticated />}>
        <RouterRoute path={Route.Login} element={<LoginPage />} />
        <RouterRoute path={Route.Register} element={<RegisterPage />} />
        {/* Заглушки под задачу 0014: страницы ещё не готовы, но пути известны — иначе их подхватит `*` ниже. */}
        <RouterRoute path={Route.ForgotPassword} element={<></>} />
        <RouterRoute path={Route.ResetPassword} element={<></>} />
      </RouterRoute>
      <RouterRoute element={<RequireAuth />}>
        <RouterRoute path={Route.Projects} element={<ProjectsPage />} />
        <RouterRoute path={Route.Project} element={<ProjectPage />} />
      </RouterRoute>
      <RouterRoute path='*' element={<NotFoundScreen />} />
    </Routes>
  );
};
