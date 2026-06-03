import { resolveTypeOrmLoggingOptions } from './typeorm-logging';

describe('resolveTypeOrmLoggingOptions', () => {
  it('keeps only TypeORM error and warn logs in production', () => {
    expect(resolveTypeOrmLoggingOptions('production', true)).toEqual([
      'error',
      'warn',
    ]);
    expect(resolveTypeOrmLoggingOptions('production', false)).toEqual([
      'error',
      'warn',
    ]);
  });

  it('preserves the configured logging flag outside production', () => {
    expect(resolveTypeOrmLoggingOptions('development', true)).toBe(true);
    expect(resolveTypeOrmLoggingOptions('test', false)).toBe(false);
    expect(resolveTypeOrmLoggingOptions(undefined, true)).toBe(true);
  });
});
