import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class TaskSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(TaskSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "result" jsonb NULL,
      ADD COLUMN IF NOT EXISTS "output" text NULL,
      ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMPTZ NULL
    `);

    this.logger.log('Ensured task schema columns exist');
  }
}
