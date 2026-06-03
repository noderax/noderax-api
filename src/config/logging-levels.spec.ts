import { resolveNestLogLevels } from './logging-levels';

describe('resolveNestLogLevels', () => {
  it('keeps only error and warn logs in production', () => {
    expect(resolveNestLogLevels('production')).toEqual(['error', 'warn']);
  });

  it('keeps detailed logs outside production', () => {
    expect(resolveNestLogLevels('development')).toEqual([
      'log',
      'fatal',
      'error',
      'warn',
      'debug',
      'verbose',
    ]);
  });
});
