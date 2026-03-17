import { registerAs } from '@nestjs/config';

export const bootstrapConfig = registerAs('bootstrap', () => ({
  seedDefaultAdmin: process.env.SEED_DEFAULT_ADMIN !== 'false',
  adminName: process.env.ADMIN_NAME ?? 'Noderax Admin',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@noderax.local',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'ChangeMe123!',
}));
