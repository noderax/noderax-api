import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { UsersService } from '../users.service';

@Injectable()
export class DefaultAdminBootstrap implements OnApplicationBootstrap {
  constructor(private readonly usersService: UsersService) {}

  async onApplicationBootstrap() {
    await this.usersService.ensureDefaultAdmin();
  }
}
