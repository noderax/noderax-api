type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

type ParsedCorsOrigins = {
  allowAnyOrigin: boolean;
  origins: string[];
};

const unquote = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
};

const extractHostCandidate = (value: string) =>
  value
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .split('/')[0]
    ?.trim()
    .toLowerCase() ?? '';

const inferDefaultProtocol = (value: string) => {
  const hostCandidate = extractHostCandidate(value);
  if (
    hostCandidate === 'localhost' ||
    hostCandidate.startsWith('localhost:') ||
    hostCandidate === '127.0.0.1' ||
    hostCandidate.startsWith('127.0.0.1:') ||
    hostCandidate === '[::1]' ||
    hostCandidate.startsWith('[::1]:')
  ) {
    return 'http://';
  }

  return 'https://';
};

const normalizeOrigin = (value: string): string => {
  const normalizedValue = unquote(value).replace(/\/$/, '');
  if (!normalizedValue || normalizedValue === '*') {
    return normalizedValue;
  }

  const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedValue);

  try {
    return new URL(
      hasExplicitScheme
        ? normalizedValue
        : `${inferDefaultProtocol(normalizedValue)}${normalizedValue}`,
    ).origin;
  } catch {
    return normalizedValue;
  }
};

export const parseCorsOrigins = (value?: string | null): ParsedCorsOrigins => {
  const configuredValue = value?.trim() || '*';

  if (configuredValue === '*') {
    return {
      allowAnyOrigin: true,
      origins: [],
    };
  }

  const origins = configuredValue
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(normalizeOrigin);

  return {
    allowAnyOrigin: false,
    origins: Array.from(new Set(origins)),
  };
};

export const createCorsOriginDelegate = (value?: string | null) => {
  const parsed = parseCorsOrigins(value);

  return (origin: string | undefined, callback: CorsOriginCallback) => {
    if (!origin || parsed.allowAnyOrigin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = normalizeOrigin(origin);
    if (parsed.origins.includes(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${normalizedOrigin} is not allowed by CORS`));
  };
};

export const buildCorsOptions = (value?: string | null) => ({
  origin: createCorsOriginDelegate(value),
  credentials: true,
});

export const buildRuntimeSocketCorsOptions = () => ({
  origin: (origin: string | undefined, callback: CorsOriginCallback) =>
    createCorsOriginDelegate(process.env.CORS_ORIGIN)(origin, callback),
  credentials: true,
});

export const isWildcardCorsOrigin = (value?: string | null) =>
  parseCorsOrigins(value).allowAnyOrigin;
