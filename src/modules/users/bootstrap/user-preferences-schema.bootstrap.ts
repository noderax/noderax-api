import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DEFAULT_TIMEZONE } from '../../../common/utils/timezone.util';

@Injectable()
export class UserPreferencesSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(UserPreferencesSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (!(await this.hasTable('users'))) {
      this.logger.warn(
        'Skipping user timezone preference bootstrap because the users table does not exist yet',
      );
      return;
    }

    await this.dataSource.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "timezone" varchar(80) NOT NULL DEFAULT '${DEFAULT_TIMEZONE}'
    `);

    await this.dataSource.query(`
      ALTER TABLE "users"
      ALTER COLUMN "timezone" TYPE varchar(80)
    `);

    this.logger.log('Ensured user timezone preference schema exists');
  }

  private async hasTable(tableName: string): Promise<boolean> {
    const result = (await this.dataSource.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = $1
        ) AS "exists"
      `,
      [tableName],
    )) as Array<{ exists: boolean }>;

    return Boolean(result[0]?.exists);
  }
}
