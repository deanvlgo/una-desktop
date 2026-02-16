import { getAccessToken } from './auth';

const DEFAULT_API_BASE = 'http://localhost:8081';

function readApiBaseUrl() {
  const raw = import.meta.env.VITE_UNA_API_BASE_URL;
  if (!raw) {
    return DEFAULT_API_BASE;
  }
  return raw.replace(/\/$/, '');
}

function toApiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${readApiBaseUrl()}${normalizedPath}`;
}

export async function apiFetch(input: string, init: RequestInit = {}) {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(toApiUrl(input), { ...init, headers });
}

export function apiUrl(path: string) {
  return toApiUrl(path);
}
