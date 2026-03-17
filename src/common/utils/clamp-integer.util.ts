export function clampInteger(
  value: unknown,
  options: {
    min: number;
    max: number;
  },
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsedValue =
    typeof value === 'number'
      ? Math.trunc(value)
      : Number.parseInt(String(value), 10);

  if (!Number.isFinite(parsedValue)) {
    return Number.NaN;
  }

  return Math.min(options.max, Math.max(options.min, parsedValue));
}
