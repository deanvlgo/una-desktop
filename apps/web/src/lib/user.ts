export function userInitials(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0) {
    return '?';
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  const first = parts[0].slice(0, 1);
  const last = parts[parts.length - 1].slice(0, 1);
  return `${first}${last}`.toUpperCase();
}
