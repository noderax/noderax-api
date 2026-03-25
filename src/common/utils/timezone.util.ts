import { BadRequestException } from '@nestjs/common';

export const DEFAULT_TIMEZONE = 'UTC';

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[];
};

const intlWithSupportedValues = Intl as IntlWithSupportedValues;

const SUPPORTED_TIMEZONES = new Set(
  typeof intlWithSupportedValues.supportedValuesOf === 'function'
    ? intlWithSupportedValues.supportedValuesOf('timeZone')
    : [DEFAULT_TIMEZONE],
);

export function isValidTimeZone(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  if (SUPPORTED_TIMEZONES.has(normalized)) {
    return true;
  }

  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: normalized,
    }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function assertValidTimeZone(value: string): string {
  const normalized = value.trim();

  if (!isValidTimeZone(normalized)) {
    throw new BadRequestException(
      `${value || 'Timezone'} is not a valid IANA timezone.`,
    );
  }

  return normalized;
}
