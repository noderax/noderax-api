import { registerAs } from '@nestjs/config';

export const AUTH_CONFIG_KEY = 'auth';

export const authConfig = registerAs(AUTH_CONFIG_KEY, () => ({
  jwtSecret: process.env.JWT_SECRET ?? 'noderax-local-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10),
  secretsEncryptionKey:
    process.env.SECRETS_ENCRYPTION_KEY ?? 'noderax-local-secrets-key-change-me',
}));
