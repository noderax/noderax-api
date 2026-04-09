import { applyFileBackedEnv } from './file-backed-env.utils';

describe('applyFileBackedEnv', () => {
  it('does not reread a file when the target env key is explicitly set to an empty string', () => {
    const env = {
      SMTP_PASSWORD: '',
      SMTP_PASSWORD_FILE: '/root-only/secret',
    } as NodeJS.ProcessEnv;

    expect(() => applyFileBackedEnv(env)).not.toThrow();
    expect(env.SMTP_PASSWORD).toBe('');
  });
});
