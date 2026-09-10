import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { tokenStore } from '../api/client';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return null;

  // A cached `user` alone isn't sufficient proof of a live session (the
  // refresh token could have expired since last visit), but requiring
  // BOTH a cached user AND a present refresh token is a reasonable,
  // cheap client-side gate — the API itself is the real authority and
  // will 401 -> redirect-to-login-on-failure for any request that turns
  // out to be stale (see individual pages' error handling).
  if (!user || !tokenStore.getRefresh()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
