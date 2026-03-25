import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DEFAULT_TIMEZONE } from '../../../common/utils/timezone.util';

@Injectable()
export class UserPreferencesSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(UserPreferencesSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
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
}
