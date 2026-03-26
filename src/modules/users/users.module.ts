import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DefaultAdminBootstrap } from './bootstrap/default-admin.bootstrap';
import { UserPreferencesSchemaBootstrap } from './bootstrap/user-preferences-schema.bootstrap';
import { UserEntity } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  controllers: [UsersController],
  providers: [
    UsersService,
    DefaultAdminBootstrap,
    UserPreferencesSchemaBootstrap,
  ],
  exports: [UsersService],
})
export class UsersModule {}
