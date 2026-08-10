import type React from 'react';
import { Route as RouterRoute, Routes } from 'react-router';

import { RedirectIfAuthenticated } from '@app/auth';
import { HomePage, LoginPage, RegisterPage } from '@app/landing';
import { ProjectPage } from '@app/project';

import { Route } from '../../../../shared/router/routes';

export const Router: React.FC = () => {
  return (
    <Routes>
      <RouterRoute path={Route.Home} element={<HomePage />} />
      <RouterRoute element={<RedirectIfAuthenticated />}>
        <RouterRoute path={Route.Login} element={<LoginPage />} />
        <RouterRoute path={Route.Register} element={<RegisterPage />} />
      </RouterRoute>
      <RouterRoute path={Route.Project} element={<ProjectPage />} />
    </Routes>
  );
};
