import type React from 'react';
import { Route as RouterRoute, Routes } from 'react-router';

import { Route } from '../../../../shared/router/routes';
import { HomePage, LoginPage, RegisterPage } from '@app/landing';
import { ProjectPage } from '@app/project';

export const Router: React.FC = () => {
  return (
    <Routes>
      <RouterRoute path={Route.Home} element={<HomePage />} />
      <RouterRoute path={Route.Login} element={<LoginPage />} />
      <RouterRoute path={Route.Register} element={<RegisterPage />} />
      <RouterRoute path={Route.Project} element={<ProjectPage />} />
    </Routes>
  );
};
