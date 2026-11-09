'use client';

import useSWR, { mutate as mutateCache } from 'swr';

export const AUTH_API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_ME = `${AUTH_API_BASE}/api/v1/auth/me`;
const API_LOGOUT = `${AUTH_API_BASE}/api/v1/auth/logout`;

export const GLOBAL_USER_KEY = 'global-auth-user';
const WELCOME_STORAGE_KEY = 'futurese-welcome-seen';

async function buscarUtilizador() {
  const response = await fetch(API_ME, {
    credentials: 'include',
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success !== true || !data.data) {
    const error = new Error(data.message || `Falha ao validar a sessão (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }

  return data.data;
}

export function useGlobalAuth() {
  const { data, error, isLoading, mutate } = useSWR(GLOBAL_USER_KEY, buscarUtilizador, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
    dedupingInterval: 30000
  });

  return {
    userInfo: data || null,
    loadingAuth: isLoading,
    authError: error || null,
    setUserInfo: (userInfo) => mutate(userInfo, { revalidate: false }),
    refreshUserInfo: () => mutate()
  };
}

export function clearGlobalUser() {
  return mutateCache(GLOBAL_USER_KEY, undefined, { revalidate: false });
}

export async function logoutGlobalUser() {
  const response = await fetch(API_LOGOUT, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));

  if (response.status !== 401 && (!response.ok || data.success !== true)) {
    throw new Error(data.message || `Não foi possível terminar a sessão (HTTP ${response.status}).`);
  }

  await clearGlobalUser();
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(WELCOME_STORAGE_KEY);
  }
}