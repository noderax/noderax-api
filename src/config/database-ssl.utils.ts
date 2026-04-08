import { readFileSync } from 'fs';

type PostgresSslOptionsInput = {
  enabled: boolean;
  caFile?: string | null;
};

export const buildPostgresSslOptions = ({
  enabled,
  caFile,
}: PostgresSslOptionsInput) => {
  if (!enabled) {
    return false;
  }

  const normalizedCaFile =
    typeof caFile === 'string' && caFile.trim().length > 0
      ? caFile.trim()
      : null;

  if (!normalizedCaFile) {
    return {
      rejectUnauthorized: true,
    };
  }

  return {
    rejectUnauthorized: true,
    ca: readFileSync(normalizedCaFile, 'utf8'),
  };
};
