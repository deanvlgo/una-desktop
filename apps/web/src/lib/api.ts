import { getAccessToken } from './auth';

const DEFAULT_API_BASE = 'http://localhost:8081';

function readApiBaseUrl() {
  const raw = import.meta.env.VITE_UNA_API_BASE_URL;
  if (!raw) {
    return DEFAULT_API_BASE;
  }
  return raw.replace(/\/$/, '');
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, '');
}

function toApiUrl(path: string, baseUrl?: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const resolvedBase = baseUrl ? normalizeBaseUrl(baseUrl) : readApiBaseUrl();
  return `${resolvedBase}${normalizedPath}`;
}

function withAuthHeaders(init: RequestInit = {}): RequestInit {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return { ...init, headers };
}

export async function apiFetch(input: string, init: RequestInit = {}) {
  return fetch(toApiUrl(input), withAuthHeaders(init));
}

export async function apiFetchWithBase(baseUrl: string, input: string, init: RequestInit = {}) {
  return fetch(toApiUrl(input, baseUrl), withAuthHeaders(init));
}

export function apiUrl(path: string) {
  return toApiUrl(path);
}
