type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

type ParsedCorsOrigins = {
  allowAnyOrigin: boolean;
  origins: string[];
};

const normalizeOrigin = (value: string): string => {
  try {
    return new URL(value).origin;
  } catch {
    return value.trim().replace(/\/$/, '');
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
