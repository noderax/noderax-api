function normalizePrefix(prefix: string | undefined): string {
  const trimmedPrefix = prefix?.trim().replace(/^\/+|\/+$/g, '') ?? '';
  return trimmedPrefix ? `/${trimmedPrefix}` : '';
}

export function getApiPrefix(): string {
  return normalizePrefix(process.env.API_PREFIX);
}

export function apiPath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiPrefix()}${normalizedPath}`;
}
