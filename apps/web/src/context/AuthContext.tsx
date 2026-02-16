import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { clearAccessToken, getAccessToken, setAccessToken } from '../lib/auth';
import { apiFetch, apiUrl } from '../lib/api';
import type { AuthenticatedUser } from '../types/auth';

type AuthContextValue = {
  token: string | null;
  user: AuthenticatedUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(() => {
    clearAccessToken();
    setToken(null);
    setUser(null);
  }, []);

  const loadMe = useCallback(async () => {
    const currentToken = getAccessToken();
    setToken(currentToken);

    if (!currentToken) {
      setUser(null);
      return;
    }

    const res = await apiFetch('/api/auth/me');
    if (res.status === 401) {
      logout();
      return;
    }

    if (!res.ok) {
      throw new Error('Failed to load session');
    }

    const data = await res.json();
    setUser(data.user);
  }, [logout]);

  useEffect(() => {
    (async () => {
      try {
        await loadMe();
      } finally {
        setIsLoading(false);
      }
    })();
  }, [loadMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        throw new Error('Incorrect email or password');
      }

      const data = await res.json();
      if (!data?.access_token) {
        throw new Error('Invalid login response');
      }

      setAccessToken(data.access_token);
      setToken(data.access_token);
      await loadMe();
    },
    [loadMe],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ token, user, isLoading, login, logout }),
    [token, user, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
