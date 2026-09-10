import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore, ApiError } from '../api/client';
import type { AuthUser } from '../api/types';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_STORAGE_KEY = 'shortlink_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  });
  // Only true while we haven't yet confirmed whether a stored session is
  // still valid — used to avoid a flash of the logged-out UI on refresh.
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // On load, if we have a user cached but no way to verify the access
    // token is still fresh, a real request will naturally 401 -> refresh
    // -> either succeed (session restored) or clear (session expired).
    // We don't need a dedicated "whoami" call for this; the first
    // authenticated request the app makes will settle it.
    setIsLoading(false);
  }, []);

  const persistSession = useCallback((accessToken: string, refreshToken: string, authUser: AuthUser) => {
    tokenStore.set(accessToken, refreshToken);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(authUser));
    setUser(authUser);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email, password);
      persistSession(res.accessToken, res.refreshToken, res.user);
    },
    [persistSession]
  );

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const res = await api.register(email, password, displayName);
      persistSession(res.accessToken, res.refreshToken, res.user);
    },
    [persistSession]
  );

  const logout = useCallback(() => {
    // Fire the server-side revocation BEFORE clearing local tokens — it
    // needs the (still valid) access token to authenticate the request.
    // Best-effort: the UI logs out immediately regardless of whether this
    // succeeds, since the local tokens are being discarded either way.
    api.logoutAll().catch(() => void 0);
    tokenStore.clear();
    localStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/** Extracts a human-readable message from any error thrown by the API client. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}
