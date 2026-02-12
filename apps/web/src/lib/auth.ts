export const AUTH_TOKEN_STORAGE_KEY = 'una.accessToken';

export function getAccessToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

export function setAccessToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

export function clearAccessToken() {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}
