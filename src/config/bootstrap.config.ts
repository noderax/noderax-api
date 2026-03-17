import { registerAs } from '@nestjs/config';

export const BOOTSTRAP_CONFIG_KEY = 'bootstrap';

export const bootstrapConfig = registerAs(BOOTSTRAP_CONFIG_KEY, () => ({
  seedDefaultAdmin: process.env.SEED_DEFAULT_ADMIN === 'true',
  adminName: process.env.ADMIN_NAME ?? 'Noderax Admin',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@example.com',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'ChangeMe123!',
}));
