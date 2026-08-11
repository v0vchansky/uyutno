import type React from 'react';
import { useMemo } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { useRegistry } from '@app/common';

import { buildAuthUrl } from '../../lib/buildAuthUrl';

export const RequireAuth: React.FC = () => {
  const { authManager } = useRegistry();
  const location = useLocation();

  const loginTarget = useMemo(() => {
    const from = `${location.pathname}${location.search}`;
    return buildAuthUrl('/login', from);
  }, [location.pathname, location.search]);

  if (!authManager.getCurrentUser()) {
    return <Navigate to={loginTarget} replace />;
  }

  return <Outlet />;
};
