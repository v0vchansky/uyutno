import type React from 'react';
import { Navigate, Outlet } from 'react-router';

import { useRegistry } from '@app/common';

import { Route } from '../../../../shared/router/routes';

export const RedirectIfAuthenticated: React.FC = () => {
  const { authManager } = useRegistry();

  if (authManager.getCurrentUser()) {
    return <Navigate to={Route.Projects} replace />;
  }

  return <Outlet />;
};
